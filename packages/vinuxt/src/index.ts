import type { Plugin, ViteDevServer } from "vite";
import {
  scanRoutes,
  invalidateRouteCache,
  type Route,
} from "./routing/router.js";
import { loadVinuxtConfig, type VinuxtConfig } from "./config/vinuxt-config.js";
import { createSSRHandler } from "./server/dev-server.js";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Virtual module IDs
// ---------------------------------------------------------------------------

const VIRTUAL_IDS = [
  "virtual:vinuxt-client-entry",
  "virtual:vinuxt-server-entry",
  "virtual:vinuxt-app",
  "virtual:vinuxt-routes",
  "virtual:vinuxt-imports",
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
          },
          dedupe: ["vue", "vue-router", "@vue/runtime-core"],
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

        case "virtual:vinuxt-app":
          return [
            'import { defineComponent, h } from "vue";',
            'import { RouterView } from "vue-router";',
            "export default defineComponent({",
            "\trender() {",
            "\t\treturn h(RouterView);",
            "\t},",
            "});",
          ].join("\n");

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
        server.middlewares.use(createSSRHandler(server));
      };
    },
  };

  return [corePlugin, tsconfigPaths() as unknown as Plugin];
}

// ---------------------------------------------------------------------------
// Virtual module code generators
// ---------------------------------------------------------------------------

/**
 * Generate the server entry module code.
 *
 * Exports a `createApp(url)` function that:
 * - Creates a Vue SSR app with createSSRApp
 * - Creates a router with createMemoryHistory (server-side)
 * - Pushes the requested URL and returns { app, router }
 */
function generateServerEntry(): string {
  return `
import { createSSRApp } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import App from "virtual:vinuxt-app";
import { routes } from "virtual:vinuxt-routes";

export async function createApp(url) {
	const app = createSSRApp(App);
	const router = createRouter({
		history: createMemoryHistory(),
		routes,
	});
	app.use(router);
	await router.push(url);
	return { app, router };
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
  return `
import { createSSRApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "virtual:vinuxt-app";
import { routes } from "virtual:vinuxt-routes";

const app = createSSRApp(App);
const router = createRouter({
	history: createWebHistory(),
	routes,
});
app.use(router);

// Hydrate payload from SSR
const payload = window.__VINUXT_DATA__ || {};
// (composables will use this later)

router.isReady().then(() => {
	app.mount("#__nuxt");
	console.log("[vinuxt] hydrated");
});
`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
