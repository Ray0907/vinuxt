import { glob } from "node:fs/promises";
import path from "node:path";

export interface Route {
  /** URL pattern, e.g. "/" or "/about" or "/users/:id" */
  pattern: string;
  /** Absolute file path to the page component */
  filePath: string;
  /** Whether this route has dynamic segments */
  isDynamic: boolean;
  /** Parameter names for dynamic segments */
  params: string[];
  /** Nested child routes (Nuxt nested routing) */
  children: Route[];
}

// Route cache -- invalidated when pages directory changes
const routeCache = new Map<
  string,
  { routes: Route[]; promise: Promise<Route[]> }
>();

/**
 * Invalidate cached routes for a given pages directory.
 * Called by the file watcher when pages are added/removed.
 */
export function invalidateRouteCache(pagesDir: string): void {
  routeCache.delete(pagesDir);
}

/**
 * Scan the pages/ directory and return a route tree.
 * Results are cached -- call invalidateRouteCache() when files change.
 *
 * Follows Nuxt conventions:
 * - pages/index.vue -> /
 * - pages/about.vue -> /about
 * - pages/posts/[id].vue -> /posts/:id
 * - pages/[...slug].vue -> /:slug+
 * - Ignores files starting with _ or .
 * - When pages/users.vue and pages/users/ both exist, files inside users/
 *   become children of the users.vue route (Nuxt nested routing).
 */
export async function scanRoutes(pagesDir: string): Promise<Route[]> {
  const cached = routeCache.get(pagesDir);
  if (cached) return cached.promise;

  const promise = scanPageRoutes(pagesDir);
  routeCache.set(pagesDir, { routes: [], promise });
  const routes = await promise;
  routeCache.set(pagesDir, { routes, promise });
  return routes;
}

async function scanPageRoutes(pagesDir: string): Promise<Route[]> {
  const flat_routes: Route[] = [];

  for await (const file of glob("**/*.{vue,tsx,ts,jsx,js}", {
    cwd: pagesDir,
  })) {
    // Skip files/directories starting with _ (e.g., _layout.vue, _components/)
    if (file.split(path.sep).some((segment) => segment.startsWith("_")))
      continue;
    const route = fileToRoute(file, pagesDir);
    if (route) flat_routes.push(route);
  }

  // Build nested route tree
  const routes = buildRouteTree(flat_routes);

  return routes;
}

/**
 * Convert a file path relative to pages/ into a flat Route.
 */
function fileToRoute(file: string, pagesDir: string): Route | null {
  // Remove extension
  const ext_without = file.replace(/\.(vue|tsx?|jsx?)$/, "");

  // Convert to URL segments
  const segments = ext_without.split(path.sep);

  // Handle index files: pages/index.vue -> /
  const segment_last = segments[segments.length - 1];
  if (segment_last === "index") {
    segments.pop();
  }

  const params: string[] = [];
  let is_dynamic = false;

  // Convert Nuxt dynamic segments to URL patterns
  const segments_url = segments.map((segment) => {
    // Catch-all: [...slug] -> :slug+
    const match_catch_all = segment.match(/^\[\.\.\.(\w+)\]$/);
    if (match_catch_all) {
      is_dynamic = true;
      params.push(match_catch_all[1]);
      return `:${match_catch_all[1]}+`;
    }

    // Optional catch-all: [[...slug]] -> :slug*
    const match_optional_catch_all = segment.match(/^\[\[\.\.\.(\w+)\]\]$/);
    if (match_optional_catch_all) {
      is_dynamic = true;
      params.push(match_optional_catch_all[1]);
      return `:${match_optional_catch_all[1]}*`;
    }

    // Dynamic segment: [id] -> :id
    const match_dynamic = segment.match(/^\[(\w+)\]$/);
    if (match_dynamic) {
      is_dynamic = true;
      params.push(match_dynamic[1]);
      return `:${match_dynamic[1]}`;
    }

    return segment;
  });

  const pattern = "/" + segments_url.join("/");

  return {
    pattern: pattern === "/" ? "/" : pattern,
    filePath: path.join(pagesDir, file),
    isDynamic: is_dynamic,
    params,
    children: [],
  };
}

/**
 * Build nested route tree from flat routes.
 *
 * When pages/users.vue and pages/users/ directory both exist,
 * the files inside users/ become children of the users.vue route.
 * Child patterns are relative (parent prefix stripped).
 */
function buildRouteTree(flat_routes: Route[]): Route[] {
  // Identify parent routes: routes whose pattern matches another route's prefix
  // A parent is a route like "/users" that has a corresponding directory with child files.
  // We detect this by checking if any other route starts with "/users/" as prefix.
  const map_parent = new Map<string, Route>();
  const set_child_indices = new Set<number>();

  // First pass: index parent candidates.
  // Only routes from a direct layout file (e.g., users.vue) can be nesting parents,
  // NOT routes from index files (e.g., users/index.vue).
  for (const route of flat_routes) {
    if (route.pattern === "/") continue;
    const basename = path.basename(route.filePath);
    const is_index_file = basename.match(/^index\.(vue|tsx?|jsx?)$/);
    if (is_index_file) continue;
    map_parent.set(route.pattern, route);
  }

  // Second pass: find children for each parent
  for (let i = 0; i < flat_routes.length; i++) {
    const route = flat_routes[i];

    // For each route, check if there's a parent route that is a prefix
    // e.g., route.pattern = "/users/:id" -> check if "/users" exists as a parent
    for (const [pattern_parent, route_parent] of map_parent) {
      if (route === route_parent) continue;

      // Check if this route's pattern starts with the parent's pattern + "/"
      // or if this route is the index child (pattern === parent pattern, from index.vue)
      const prefix = pattern_parent + "/";
      const is_direct_child =
        route.pattern.startsWith(prefix) &&
        !route.pattern.slice(prefix.length).includes("/");
      const is_index_child =
        route.pattern === pattern_parent && route !== route_parent;

      if (is_direct_child || is_index_child) {
        // Strip parent prefix to get relative child pattern
        let pattern_child: string;
        if (is_index_child) {
          pattern_child = "";
        } else {
          pattern_child = route.pattern.slice(prefix.length);
        }

        route_parent.children.push({
          ...route,
          pattern: pattern_child,
        });
        set_child_indices.add(i);
      }
    }
  }

  // Remove routes that became children, and remove parents with no actual children
  // (a parent needs at least one child to remain a nested route)
  const routes_top: Route[] = [];
  for (let i = 0; i < flat_routes.length; i++) {
    if (set_child_indices.has(i)) continue;
    const route = flat_routes[i];
    // Sort children: static > dynamic > catch-all
    if (route.children.length > 0) {
      route.children.sort((a, b) => {
        const diff = routePrecedence(a.pattern) - routePrecedence(b.pattern);
        return diff !== 0 ? diff : a.pattern.localeCompare(b.pattern);
      });
    }
    routes_top.push(route);
  }

  // Sort top-level: static > dynamic > catch-all
  routes_top.sort((a, b) => {
    const diff = routePrecedence(a.pattern) - routePrecedence(b.pattern);
    return diff !== 0 ? diff : a.pattern.localeCompare(b.pattern);
  });

  return routes_top;
}

/**
 * Route precedence -- lower score is higher priority.
 * 1. Static routes first
 * 2. Dynamic segments penalized by position
 * 3. Catch-all comes after dynamic
 * 4. Optional catch-all last
 * 5. Lexicographic tiebreaker for determinism
 */
function routePrecedence(pattern: string): number {
  const parts = pattern.split("/").filter(Boolean);
  let score = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.endsWith("+")) {
      score += 10000 + i; // catch-all: high penalty
    } else if (p.endsWith("*")) {
      score += 20000 + i; // optional catch-all: highest penalty
    } else if (p.startsWith(":")) {
      score += 100 + i; // dynamic: moderate penalty by position
    }
    // static segments contribute nothing (better specificity)
  }
  return score;
}

/**
 * Match a URL path against a route tree.
 * Returns the matched route and extracted params, or null if no match.
 * Handles nested routes by checking children of matched parent routes.
 */
export function matchRoute(
  url: string,
  routes: Route[],
): { route: Route; params: Record<string, string | string[]> } | null {
  // Normalize: strip query string and trailing slash
  const pathname = url.split("?")[0];
  let url_normalized = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
  try {
    url_normalized = decodeURIComponent(url_normalized);
  } catch {
    /* malformed percent-encoding -- match as-is */
  }

  for (const route of routes) {
    // For routes with children, try matching children first
    if (route.children.length > 0) {
      const params_parent = matchPattern(url_normalized, route.pattern);
      if (params_parent !== null) {
        // Exact match on parent -- could be the index child
        const result_child = matchChildren(url_normalized, route);
        if (result_child) return result_child;
        // If no child matched, the parent itself matches
        return { route, params: params_parent };
      }

      // Check if URL could match parent prefix + child
      const prefix = route.pattern === "/" ? "/" : route.pattern + "/";
      if (
        url_normalized.startsWith(prefix) ||
        url_normalized === route.pattern
      ) {
        const result_child = matchChildren(url_normalized, route);
        if (result_child) return result_child;
      }
    }

    const params = matchPattern(url_normalized, route.pattern);
    if (params !== null) {
      return { route, params };
    }
  }

  return null;
}

function matchChildren(
  url: string,
  parent: Route,
): { route: Route; params: Record<string, string | string[]> } | null {
  for (const child of parent.children) {
    // Build full child pattern for matching
    const pattern_full =
      parent.pattern === "/"
        ? "/" + child.pattern
        : child.pattern === ""
          ? parent.pattern
          : parent.pattern + "/" + child.pattern;

    const params = matchPattern(url, pattern_full);
    if (params !== null) {
      return { route: child, params };
    }
  }
  return null;
}

function matchPattern(
  url: string,
  pattern: string,
): Record<string, string | string[]> | null {
  const parts_url = url.split("/").filter(Boolean);
  const parts_pattern = pattern.split("/").filter(Boolean);

  const params: Record<string, string | string[]> = Object.create(null);

  for (let i = 0; i < parts_pattern.length; i++) {
    const pp = parts_pattern[i];

    // Catch-all: :slug+
    if (pp.endsWith("+")) {
      const name_param = pp.slice(1, -1);
      const remaining = parts_url.slice(i);
      if (remaining.length === 0) return null;
      params[name_param] = remaining;
      return params;
    }

    // Optional catch-all: :slug*
    if (pp.endsWith("*")) {
      const name_param = pp.slice(1, -1);
      const remaining = parts_url.slice(i);
      params[name_param] = remaining;
      return params;
    }

    // Dynamic segment: :id
    if (pp.startsWith(":")) {
      const name_param = pp.slice(1);
      if (i >= parts_url.length) return null;
      params[name_param] = parts_url[i];
      continue;
    }

    // Static segment
    if (i >= parts_url.length || parts_url[i] !== pp) return null;
  }

  // All pattern parts matched -- check url doesn't have extra segments
  if (parts_url.length !== parts_pattern.length) return null;

  return params;
}
