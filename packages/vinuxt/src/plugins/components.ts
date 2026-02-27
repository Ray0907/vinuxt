import type { Plugin } from "vite";
import path from "node:path";
import fs from "node:fs";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VIRTUAL_ID = "virtual:vinuxt-components";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

export interface ComponentsOptions {
  root: string;
}

/**
 * Convert a component file path relative to `components/` into a PascalCase
 * component name.
 *
 * Examples:
 *   "Button.vue"           -> "Button"
 *   "ui/Button.vue"        -> "UiButton"
 *   "form/TextInput.vue"   -> "FormTextInput"
 */
function toComponentName(relative_path: string): string {
  const parts = relative_path
    .replace(/\.vue$/, "")
    .split(/[\\/]/)
    .filter(Boolean);

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Scan the components/ directory and return a map of component name to
 * absolute file path.
 */
async function scanComponents(
  dir_components: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (!fs.existsSync(dir_components)) {
    return result;
  }

  const pattern = "**/*.vue";
  for await (const entry of glob(pattern, { cwd: dir_components })) {
    const name_component = toComponentName(entry);
    const path_abs = path.join(dir_components, entry);
    result.set(name_component, path_abs);
  }

  return result;
}

/**
 * Built-in vinuxt components that are always globally registered.
 */
const BUILTIN_COMPONENTS: Record<string, string> = {
  NuxtLink: path
    .join(__dirname, "..", "components", "nuxt-link.ts")
    .replace(/\\/g, "/"),
  NuxtImg: path
    .join(__dirname, "..", "components", "nuxt-img.ts")
    .replace(/\\/g, "/"),
  NuxtLoadingIndicator: path
    .join(__dirname, "..", "components", "nuxt-loading.ts")
    .replace(/\\/g, "/"),
};

/**
 * Generate the virtual module code that globally registers all scanned
 * components plus vinuxt built-in components.
 */
function generateComponentsModule(components: Map<string, string>): string {
  const lines: string[] = [];
  lines.push('import { defineAsyncComponent } from "vue";');

  // Import built-in components eagerly
  const builtin_entries = Object.entries(BUILTIN_COMPONENTS);
  for (let i = 0; i < builtin_entries.length; i++) {
    const [, file_path] = builtin_entries[i];
    lines.push(`import Builtin_${i} from ${JSON.stringify(file_path)};`);
  }

  lines.push("");
  lines.push("export function registerComponents(app) {");

  // Register built-in components
  for (let i = 0; i < builtin_entries.length; i++) {
    const [name] = builtin_entries[i];
    lines.push(`\tapp.component(${JSON.stringify(name)}, Builtin_${i});`);
  }

  // Register user components (lazy)
  for (const [name, file_path] of components) {
    const path_escaped = file_path.replace(/\\/g, "/");
    lines.push(
      `\tapp.component(${JSON.stringify(name)}, defineAsyncComponent(() => import(${JSON.stringify(path_escaped)})));`,
    );
  }

  lines.push("}");
  lines.push("");
  lines.push("export const components = {");

  for (const [name, file_path] of builtin_entries) {
    lines.push(
      `\t${JSON.stringify(name)}: () => import(${JSON.stringify(file_path)}),`,
    );
  }

  for (const [name, file_path] of components) {
    const path_escaped = file_path.replace(/\\/g, "/");
    lines.push(
      `\t${JSON.stringify(name)}: () => import(${JSON.stringify(path_escaped)}),`,
    );
  }

  lines.push("};");

  return lines.join("\n");
}

/**
 * Create the components auto-registration Vite plugin.
 *
 * Scans `components/` for `.vue` files and generates a virtual module
 * `virtual:vinuxt-components` that can register them globally on a Vue app.
 */
export function createComponentsPlugin(options: ComponentsOptions): Plugin {
  const dir_components = path.join(options.root, "components");
  let cache_components: Map<string, string> | null = null;

  return {
    name: "vinuxt:components",

    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return undefined;
    },

    async load(id: string) {
      if (id !== RESOLVED_ID) return undefined;

      cache_components = await scanComponents(dir_components);
      return generateComponentsModule(cache_components);
    },

    configureServer(server) {
      // Watch for new/removed component files
      server.watcher.on("all", (event: string, file_path: string) => {
        if (
          file_path.startsWith(dir_components) &&
          file_path.endsWith(".vue") &&
          (event === "add" || event === "unlink")
        ) {
          cache_components = null;
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
      });
    },
  };
}
