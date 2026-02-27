/**
 * Server API route handler utilities.
 *
 * Scans server/api/ and server/routes/ directories following Nuxt conventions
 * and maps file paths to URL patterns with optional HTTP method constraints.
 */

import { glob } from "node:fs/promises";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiRoute {
  /** URL pattern, e.g. "/api/users" or "/api/users/:id" */
  pattern: string;
  /** Absolute file path to the handler file */
  file_path: string;
  /** HTTP method constraint (lowercase), or null for all methods */
  method: string | null;
}

// ---------------------------------------------------------------------------
// Known HTTP methods for filename extraction
// ---------------------------------------------------------------------------

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Identity wrapper for event handlers -- mirrors Nuxt's h3 pattern.
 * Returns the handler function unchanged, serving as a type marker
 * and documentation convention.
 */
export function defineEventHandler<T extends (...args: any[]) => any>(
  handler: T,
): T {
  return handler;
}

/**
 * Extract the HTTP method from a filename, if present.
 *
 * Examples:
 * - "users.get.ts"    -> "get"
 * - "users.post.js"   -> "post"
 * - "users.ts"        -> null
 * - "index.ts"        -> null
 */
export function extractHttpMethod(filename: string): string | null {
  // Strip extension (.ts, .js)
  const name_without_ext = filename.replace(/\.(ts|js)$/, "");
  const parts = name_without_ext.split(".");

  if (parts.length < 2) return null;

  const method_candidate = parts[parts.length - 1].toLowerCase();
  if (HTTP_METHODS.has(method_candidate)) {
    return method_candidate;
  }

  return null;
}

/**
 * Convert a file path relative to the project root into a URL route pattern.
 *
 * @param file_relative - File path relative to the project root
 *                        (e.g. "server/api/users/[id].ts")
 * @param dir_type      - "api" or "routes" -- determines the URL prefix
 *
 * Mapping rules:
 * - server/api/users.ts          -> /api/users
 * - server/api/users/[id].ts     -> /api/users/:id
 * - server/api/users.get.ts      -> /api/users   (method extracted separately)
 * - server/api/[...slug].ts      -> /api/:slug+
 * - server/routes/health.ts      -> /health
 * - index.ts files map to parent -> server/api/users/index.ts -> /api/users
 */
export function filePathToRoutePattern(
  file_relative: string,
  dir_type: "api" | "routes",
): string {
  // Strip the "server/api/" or "server/routes/" prefix
  const prefix = `server/${dir_type}/`;
  const stripped = file_relative.startsWith(prefix)
    ? file_relative.slice(prefix.length)
    : file_relative;

  // Remove extension
  const without_ext = stripped.replace(/\.(ts|js)$/, "");

  // Split into segments
  const segments = without_ext.split(path.sep);

  // Remove method suffix from last segment (e.g. "users.get" -> "users")
  const segment_last = segments[segments.length - 1];
  const parts_last = segment_last.split(".");
  if (parts_last.length >= 2) {
    const method_candidate = parts_last[parts_last.length - 1].toLowerCase();
    if (HTTP_METHODS.has(method_candidate)) {
      segments[segments.length - 1] = parts_last.slice(0, -1).join(".");
    }
  }

  // Handle index files
  if (segments[segments.length - 1] === "index") {
    segments.pop();
  }

  // Convert bracket params to :param syntax
  const segments_url = segments.map((segment) => {
    // Catch-all: [...slug] -> :slug+
    const match_catch_all = segment.match(/^\[\.\.\.(\w+)\]$/);
    if (match_catch_all) {
      return `:${match_catch_all[1]}+`;
    }

    // Dynamic segment: [id] -> :id
    const match_dynamic = segment.match(/^\[(\w+)\]$/);
    if (match_dynamic) {
      return `:${match_dynamic[1]}`;
    }

    return segment;
  });

  // Build the pattern with appropriate prefix
  const route_path = segments_url.join("/");
  if (dir_type === "api") {
    return route_path ? `/api/${route_path}` : "/api";
  }
  return route_path ? `/${route_path}` : "/";
}

/**
 * Match a request pathname and method against scanned API routes.
 *
 * Returns the matched route or null. Supports dynamic segments (:param)
 * and catch-all segments (:param+).
 */
export function matchApiRoute(
  pathname: string,
  method: string,
  routes: ApiRoute[],
): { route: ApiRoute; params: Record<string, string> } | null {
  const method_lower = method.toLowerCase();

  for (const route of routes) {
    // Check method constraint
    if (route.method && route.method !== method_lower) continue;

    const params = matchPattern(route.pattern, pathname);
    if (params !== null) {
      return { route, params };
    }
  }

  return null;
}

/**
 * Match a URL pattern against a pathname, extracting dynamic params.
 * Returns null if no match.
 */
function matchPattern(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const segments_pattern = pattern.split("/").filter(Boolean);
  const segments_path = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};

  for (let i = 0; i < segments_pattern.length; i++) {
    const seg = segments_pattern[i];

    // Catch-all: :slug+
    if (seg.startsWith(":") && seg.endsWith("+")) {
      const name = seg.slice(1, -1);
      if (i >= segments_path.length) return null; // must match at least one
      params[name] = segments_path.slice(i).join("/");
      return params;
    }

    // Dynamic segment: :id
    if (seg.startsWith(":")) {
      if (i >= segments_path.length) return null;
      params[seg.slice(1)] = segments_path[i];
      continue;
    }

    // Static segment
    if (i >= segments_path.length || seg !== segments_path[i]) {
      return null;
    }
  }

  // Ensure all path segments were consumed
  if (segments_pattern.length !== segments_path.length) {
    // Unless last pattern segment was catch-all (already handled above)
    return null;
  }

  return params;
}

/**
 * Scan server/api/ and server/routes/ directories for route handler files.
 *
 * Returns a list of ApiRoute entries mapping URL patterns to file paths,
 * with optional HTTP method constraints extracted from filenames.
 */
export async function scanApiRoutes(root: string): Promise<ApiRoute[]> {
  const routes: ApiRoute[] = [];

  const dirs_to_scan: { dir: string; type: "api" | "routes" }[] = [
    { dir: path.join(root, "server", "api"), type: "api" },
    { dir: path.join(root, "server", "routes"), type: "routes" },
  ];

  for (const { dir, type } of dirs_to_scan) {
    if (!fs.existsSync(dir)) continue;

    for await (const file of glob("**/*.{ts,js}", { cwd: dir })) {
      const file_absolute = path.join(dir, file);
      const file_relative = `server/${type}/${file}`;
      const filename = path.basename(file);

      const pattern = filePathToRoutePattern(file_relative, type);
      const method = extractHttpMethod(filename);

      routes.push({
        pattern,
        file_path: file_absolute,
        method,
      });
    }
  }

  return routes;
}
