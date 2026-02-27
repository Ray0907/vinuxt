import type { Plugin, ViteDevServer } from "vite";
import {
  scanRoutes,
  invalidateRouteCache,
  type Route,
} from "./routing/router.js";
import { loadVinuxtConfig, type VinuxtConfig } from "./config/vinuxt-config.js";
import { createSSRHandler } from "./server/dev-server.js";
import vue from "@vitejs/plugin-vue";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createAutoImportsPlugin } from "./plugins/auto-imports.js";
import { createComponentsPlugin } from "./plugins/components.js";
import { createLayoutsPlugin } from "./plugins/layouts.js";
import { createPageMetaPlugin } from "./plugins/page-meta.js";
import { scanApiRoutes, matchApiRoute } from "./server/api-handler.js";
import { scanMiddleware, scanServerMiddleware } from "./server/middleware.js";

/**
 * require() function anchored to vinuxt's own location.
 * Used to resolve packages from vinuxt's node_modules regardless of CWD.
 */
const _require = createRequire(import.meta.url);

/**
 * Resolve a package's root directory from vinuxt's own node_modules.
 * Uses _require.resolve to find the main entry, then walks up to the
 * directory containing package.json.
 */
function resolvePackageDir(pkg: string): string {
  const entry = _require.resolve(pkg);
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return path.dirname(entry);
}

// ---------------------------------------------------------------------------
// Virtual module IDs
// ---------------------------------------------------------------------------

const VIRTUAL_IDS = [
  "virtual:vinuxt-client-entry",
  "virtual:vinuxt-server-entry",
  "virtual:vinuxt-app",
  "virtual:vinuxt-routes",
  "virtual:vinuxt-imports",
  "virtual:vinuxt-middleware",
] as const;

const RESOLVED_PREFIX = "\0";

// ---------------------------------------------------------------------------
// Route code generation
// ---------------------------------------------------------------------------

/**
 * Generate a JavaScript module string that exports vue-router route
 * definitions from the scanned route tree.
 *
 * Produces code like:
 *   const routes = [
 *     { path: "/", component: () => import("/abs/path/pages/index.vue") },
 *     ...
 *   ];
 *   export { routes };
 */
function generateRouteCode(routes: Route[]): string {
  const lines: string[] = [];
  lines.push("const routes = [");

  for (const route of routes) {
    lines.push(generateRouteLiteral(route, 1));
  }

  lines.push("];");
  lines.push("export { routes };");
  return lines.join("\n");
}

function generateRouteLiteral(route: Route, depth: number): string {
  const indent = "\t".repeat(depth);
  const path_vue_router = routePatternToVueRouter(route.pattern);
  const file_path = route.filePath.replace(/\\/g, "/");

  let code = `${indent}{\n`;
  code += `${indent}\tpath: ${JSON.stringify(path_vue_router)},\n`;
  code += `${indent}\tcomponent: () => import(${JSON.stringify(file_path)}),\n`;

  if (route.children.length > 0) {
    code += `${indent}\tchildren: [\n`;
    for (const child of route.children) {
      code += generateRouteLiteral(child, depth + 2);
    }
    code += `${indent}\t],\n`;
  }

  code += `${indent}},\n`;
  return code;
}

/**
 * Convert internal route pattern (e.g. "/:id", "/:slug+") to vue-router
 * path syntax (e.g. "/:id", "/:slug+").
 *
 * Our internal patterns already closely match vue-router syntax:
 * - :param  -> :param
 * - :param+ -> :param+  (catch-all, one or more)
 * - :param* -> :param*  (optional catch-all, zero or more)
 *
 * Vue-router uses :param(.*)* for catch-all, but the + and * suffixes
 * also work as shorthand with vue-router 4.5+.
 */
function routePatternToVueRouter(pattern: string): string {
  return pattern;
}

// ---------------------------------------------------------------------------
// Client output / treeshake config (used by cli.ts for production builds)
// ---------------------------------------------------------------------------

/**
 * manualChunks function for client builds.
 *
 * Splits the client bundle into:
 * - "framework" -- Vue, Vue Router, and @vue runtime packages
 * - "vinuxt"    -- vinuxt runtime code
 *
 * Other vendor code is left to Rollup's default chunk-splitting algorithm.
 */
export const clientOutputConfig = {
  manualChunks(id: string): string | undefined {
    if (
      id.includes("node_modules/vue") ||
      id.includes("node_modules/@vue") ||
      id.includes("node_modules/vue-router")
    ) {
      return "framework";
    }
    if (id.includes("packages/vinuxt/")) {
      return "vinuxt";
    }
    return undefined;
  },
};

/**
 * Rollup treeshake configuration for production client builds.
 */
export const clientTreeshakeConfig = {
  preset: "recommended" as const,
  moduleSideEffects: "no-external" as const,
};

// ---------------------------------------------------------------------------
// Core plugin
// ---------------------------------------------------------------------------

export default function vinuxt(): Plugin[] {
  let root: string;
  let dir_pages: string;
  let config_vinuxt: VinuxtConfig;

  const corePlugin: Plugin = {
    name: "vinuxt:core",

    // ------------------------------------------------------------------
    // config -- inject Vite configuration
    // ------------------------------------------------------------------
    async config(_, env) {
      root = process.cwd();
      dir_pages = path.join(root, "pages");

      // Load vinuxt.config.ts (or nuxt.config.ts)
      config_vinuxt = await loadVinuxtConfig(root);

      // Build define map for runtimeConfig.public keys
      const define: Record<string, string> = {
        __VINUXT_SSR__: String(env.isSsrBuild ?? false),
      };

      for (const [key, value] of Object.entries(
        config_vinuxt.runtimeConfig.public,
      )) {
        const name_env = `NUXT_PUBLIC_${camelToScreamingSnake(key)}`;
        define[`import.meta.env.${name_env}`] = JSON.stringify(value);
      }

      return {
        resolve: {
          alias: {
            "#imports": "virtual:vinuxt-imports",
            "#app": "virtual:vinuxt-app",
            // Point Vite to vinuxt's own copies of these packages so
            // they resolve even when the user's project doesn't have
            // them installed (pnpm strict isolation).
            "vue-router": resolvePackageDir("vue-router"),
          },
          dedupe: ["vue", "vue-router", "@vue/runtime-core"],
        },
        ssr: {
          noExternal: ["vue-router", "@unhead/vue", "@unpic/vue"],
        },
        define,
      };
    },

    // ------------------------------------------------------------------
    // resolveId -- resolve virtual module IDs (prefix with \0)
    // ------------------------------------------------------------------
    resolveId(id: string) {
      for (const vid of VIRTUAL_IDS) {
        if (id === vid) return RESOLVED_PREFIX + vid;
      }
      return undefined;
    },

    // ------------------------------------------------------------------
    // load -- generate code for virtual modules
    // ------------------------------------------------------------------
    async load(id: string) {
      if (!id.startsWith(RESOLVED_PREFIX)) return undefined;

      const virtual_id = id.slice(RESOLVED_PREFIX.length);

      switch (virtual_id) {
        case "virtual:vinuxt-client-entry":
          return generateClientEntry();

        case "virtual:vinuxt-server-entry":
          return generateServerEntry();

        case "virtual:vinuxt-app": {
          const path_nuxt_page = resolveVinuxtSrcPath(
            "components/nuxt-page.ts",
          );
          return generateAppModule(path_nuxt_page, root ?? process.cwd());
        }

        case "virtual:vinuxt-routes": {
          const pages_dir = dir_pages ?? path.join(process.cwd(), "pages");
          if (!fs.existsSync(pages_dir)) {
            return "const routes = [];\nexport { routes };\n";
          }
          const routes = await scanRoutes(pages_dir);
          return generateRouteCode(routes);
        }

        case "virtual:vinuxt-imports":
          return "// auto-import declarations placeholder\n";

        case "virtual:vinuxt-middleware": {
          const root_mw = root ?? process.cwd();
          return generateMiddlewareModule(root_mw);
        }

        default:
          return undefined;
      }
    },

    // ------------------------------------------------------------------
    // configureServer -- SSR middleware slot + file watcher
    // ------------------------------------------------------------------
    configureServer(server: ViteDevServer) {
      const pages_dir = dir_pages ?? path.join(process.cwd(), "pages");

      // Watch pages/ directory for route changes
      server.watcher.on("all", (event: string, filePath: string) => {
        if (
          filePath.includes("/pages/") &&
          (event === "add" || event === "unlink")
        ) {
          invalidateRouteCache(pages_dir);
          // Invalidate the virtual:vinuxt-routes module
          const mod = server.moduleGraph.getModuleById(
            "\0virtual:vinuxt-routes",
          );
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
      });

      // Return a function to add middleware AFTER Vite's built-in middleware
      return () => {
        const root_server = root ?? process.cwd();

        // Layer 1: Server middleware (server/middleware/)
        server.middlewares.use(async (req, res, next) => {
          try {
            const entries = await scanServerMiddleware(root_server);
            for (const entry of entries) {
              const mod = await server.ssrLoadModule(entry.file_path);
              const handler = mod.default ?? mod;
              if (typeof handler === "function") {
                await handler(req, res);
                if (res.writableEnded) return;
              }
            }
            next();
          } catch (err) {
            next(err);
          }
        });

        // Layer 2: API routes (server/api/ + server/routes/)
        server.middlewares.use(async (req, res, next) => {
          const url = req.originalUrl || req.url || "/";
          const pathname = new URL(url, "http://localhost").pathname;
          const method = req.method || "GET";

          try {
            const routes = await scanApiRoutes(root_server);
            const match = matchApiRoute(pathname, method, routes);

            if (!match) return next();

            const mod = await server.ssrLoadModule(match.route.file_path);
            const handler = mod.default ?? mod;

            if (typeof handler !== "function") return next();

            const result = await handler({ params: match.params, req, res });

            if (!res.writableEnded) {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify(result));
            }
          } catch (err) {
            next(err);
          }
        });

        // Layer 3: SSR handler (catch-all)
        server.middlewares.use(createSSRHandler(server));
      };
    },
  };

  const root_cwd = process.cwd();
  const plugin_page_meta = createPageMetaPlugin({ root: root_cwd });
  const plugin_auto_imports = createAutoImportsPlugin({ root: root_cwd });
  const plugin_components = createComponentsPlugin({ root: root_cwd });
  const plugin_layouts = createLayoutsPlugin({ root: root_cwd });

  return [
    plugin_page_meta as unknown as Plugin,
    vue() as unknown as Plugin,
    corePlugin,
    plugin_auto_imports as unknown as Plugin,
    plugin_components as unknown as Plugin,
    plugin_layouts as unknown as Plugin,
    tsconfigPaths() as unknown as Plugin,
  ];
}

// ---------------------------------------------------------------------------
// Virtual module code generators
// ---------------------------------------------------------------------------

/**
 * Generate the virtual:vinuxt-app module.
 *
 * Scans layouts/ for .vue files and produces an App component that:
 * - Eagerly imports all discovered layouts
 * - Determines the active layout from route.meta.layout (default: "default")
 * - Renders the layout with NuxtPage as the default slot content
 * - Falls back to bare NuxtPage if no layouts exist
 */
function generateAppModule(path_nuxt_page: string, root_dir: string): string {
  const dir_layouts = path.join(root_dir, "layouts");
  const layout_entries: Array<{ name: string; file_path: string }> = [];

  if (fs.existsSync(dir_layouts)) {
    const files = fs.readdirSync(dir_layouts).filter((f) => f.endsWith(".vue"));
    for (const file of files) {
      const name = file.replace(/\.vue$/, "");
      layout_entries.push({
        name,
        file_path: path.join(dir_layouts, file).replace(/\\/g, "/"),
      });
    }
  }

  const lines: string[] = [];

  // Imports
  lines.push(
    `import { defineComponent, h } from "vue";`,
    `import { useRoute } from "vue-router";`,
    `import NuxtPage from ${JSON.stringify(path_nuxt_page)};`,
  );

  for (let i = 0; i < layout_entries.length; i++) {
    lines.push(
      `import Layout_${i} from ${JSON.stringify(layout_entries[i].file_path)};`,
    );
  }

  // Layout map
  lines.push("", "const layoutMap = {");
  for (let i = 0; i < layout_entries.length; i++) {
    lines.push(`  ${JSON.stringify(layout_entries[i].name)}: Layout_${i},`);
  }
  lines.push("};", "");

  // App component
  lines.push(
    `export default defineComponent({`,
    `  name: "VinuxtApp",`,
    `  setup() {`,
    `    const route = useRoute();`,
    `    return () => {`,
    `      const name_layout = route.meta?.layout ?? "default";`,
    `      const Layout = layoutMap[name_layout];`,
    `      if (Layout) {`,
    `        return h(Layout, null, { default: () => h(NuxtPage) });`,
    `      }`,
    `      return h(NuxtPage);`,
    `    };`,
    `  },`,
    `});`,
  );

  return lines.join("\n");
}

/**
 * Generate the server entry module code.
 *
 * Exports a `createApp(url)` function that:
 * - Creates a Vue SSR app with createSSRApp
 * - Creates a router with createMemoryHistory (server-side)
 * - Pushes the requested URL and returns { app, router }
 */
function generateServerEntry(): string {
  const path_composables = resolveVinuxtSrcPath("composables/index.ts");
  return `
import { createSSRApp } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import App from "virtual:vinuxt-app";
import { routes } from "virtual:vinuxt-routes";
import { registerComponents } from "virtual:vinuxt-components";
import { middlewareMap, globalMiddleware } from "virtual:vinuxt-middleware";
import { createPayload } from ${JSON.stringify(path_composables)};

export async function createApp(url) {
	const app = createSSRApp(App);
	registerComponents(app);

	const payload = createPayload();
	app.provide("__vinuxt_payload__", payload);

	const router = createRouter({
		history: createMemoryHistory(),
		routes,
	});

	router.beforeEach(async (to, from) => {
		// Run global middleware first
		for (const mw of globalMiddleware) {
			const result = await mw(to, from);
			if (result === false || (result && typeof result === "object")) return result;
		}
		// Run per-page middleware from definePageMeta
		const matched = to.matched;
		for (const record of matched) {
			const comp = record.components?.default;
			const meta_raw = comp?.__pageMetaRaw ?? comp?.type?.__pageMetaRaw;
			const names = meta_raw?.middleware;
			if (!names) continue;
			const list = Array.isArray(names) ? names : [names];
			for (const name of list) {
				const mw = middlewareMap[name];
				if (mw) {
					const result = await mw(to, from);
					if (result === false || (result && typeof result === "object")) return result;
				}
			}
		}
	});

	app.use(router);
	await router.push(url);
	return { app, router, payload };
}
`;
}

/**
 * Generate the client entry module code.
 *
 * Creates a Vue SSR app in the browser, sets up vue-router with
 * createWebHistory, reads the __VINUXT_DATA__ payload from the
 * server, and hydrates onto #__nuxt once the router is ready.
 */
function generateClientEntry(): string {
  const path_composables = resolveVinuxtSrcPath("composables/index.ts");
  return `
import { createSSRApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "virtual:vinuxt-app";
import { routes } from "virtual:vinuxt-routes";
import { registerComponents } from "virtual:vinuxt-components";
import { middlewareMap, globalMiddleware } from "virtual:vinuxt-middleware";
import { hydratePayload, createPayload } from ${JSON.stringify(path_composables)};

const app = createSSRApp(App);
registerComponents(app);

// Hydrate payload from SSR or create empty for client-only navigation
const raw_payload = window.__VINUXT_DATA__;
const payload = raw_payload
	? hydratePayload(typeof raw_payload === "string" ? raw_payload : JSON.stringify(raw_payload))
	: createPayload();
app.provide("__vinuxt_payload__", payload);

const router = createRouter({
	history: createWebHistory(),
	routes,
});

router.beforeEach(async (to, from) => {
	// Run global middleware first
	for (const mw of globalMiddleware) {
		const result = await mw(to, from);
		if (result === false || (result && typeof result === "object")) return result;
	}
	// Run per-page middleware from definePageMeta
	const matched = to.matched;
	for (const record of matched) {
		const comp = record.components?.default;
		const meta_raw = comp?.__pageMetaRaw ?? comp?.type?.__pageMetaRaw;
		const names = meta_raw?.middleware;
		if (!names) continue;
		const list = Array.isArray(names) ? names : [names];
		for (const name of list) {
			const mw = middlewareMap[name];
			if (mw) {
				const result = await mw(to, from);
				if (result === false || (result && typeof result === "object")) return result;
			}
		}
	}
});

app.use(router);

router.isReady().then(() => {
	app.mount("#__nuxt");
});
`;
}

/**
 * Generate the virtual:vinuxt-middleware module.
 *
 * Scans middleware/ directory and produces a module exporting:
 * - middlewareMap: { [name]: handler } for named middleware
 * - globalMiddleware: handler[] for global middleware
 */
async function generateMiddlewareModule(root: string): Promise<string> {
  const entries = await scanMiddleware(root);
  const lines: string[] = [];

  // Import each middleware
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const path_escaped = entry.file_path.replace(/\\/g, "/");
    lines.push(`import mw_${i} from ${JSON.stringify(path_escaped)};`);
  }

  lines.push("");

  // Build middleware map (named middleware)
  lines.push("export const middlewareMap = {");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    lines.push(`\t${JSON.stringify(entry.name)}: mw_${i},`);
  }
  lines.push("};");

  lines.push("");

  // Build global middleware list
  const globals = entries
    .map((e, i) => ({ ...e, idx: i }))
    .filter((e) => e.global);

  lines.push("export const globalMiddleware = [");
  for (const g of globals) {
    lines.push(`\tmw_${g.idx},`);
  }
  lines.push("];");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a path relative to vinuxt's src/ directory.
 * Returns a forward-slash absolute path suitable for use in generated import statements.
 */
function resolveVinuxtSrcPath(relative: string): string {
  return path
    .join(path.dirname(new URL(import.meta.url).pathname), relative)
    .replace(/\\/g, "/");
}

/**
 * Convert a camelCase key to SCREAMING_SNAKE_CASE for env variable naming.
 * e.g. "apiBase" -> "API_BASE"
 */
function camelToScreamingSnake(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}
