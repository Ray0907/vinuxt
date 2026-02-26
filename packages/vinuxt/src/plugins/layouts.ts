import type { Plugin } from "vite";
import path from "node:path";
import fs from "node:fs";
import { glob } from "node:fs/promises";

const VIRTUAL_ID = "virtual:vinuxt-layouts";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

export interface LayoutsOptions {
	root: string;
}

/**
 * Scan the layouts/ directory and return a map of layout name to absolute
 * file path.
 *
 * Layout names are derived from the filename without extension:
 *   "default.vue" -> "default"
 *   "admin.vue"   -> "admin"
 */
async function scanLayouts(
	dir_layouts: string,
): Promise<Map<string, string>> {
	const result = new Map<string, string>();

	if (!fs.existsSync(dir_layouts)) {
		return result;
	}

	const pattern = "*.vue";
	for await (const entry of glob(pattern, { cwd: dir_layouts })) {
		const name_layout = entry.replace(/\.vue$/, "");
		const path_abs = path.join(dir_layouts, entry);
		result.set(name_layout, path_abs);
	}

	return result;
}

/**
 * Generate the virtual module code that exports a map of layout names to
 * lazy component imports.
 */
function generateLayoutsModule(layouts: Map<string, string>): string {
	const lines: string[] = [];
	lines.push("export const layouts = {");

	for (const [name, file_path] of layouts) {
		const path_escaped = file_path.replace(/\\/g, "/");
		lines.push(
			`\t${JSON.stringify(name)}: () => import(${JSON.stringify(path_escaped)}),`,
		);
	}

	lines.push("};");
	return lines.join("\n");
}

/**
 * Create the layouts Vite plugin.
 *
 * Scans `layouts/` for `.vue` files and generates a virtual module
 * `virtual:vinuxt-layouts` that maps layout names to lazy component imports.
 */
export function createLayoutsPlugin(options: LayoutsOptions): Plugin {
	const dir_layouts = path.join(options.root, "layouts");
	let cache_layouts: Map<string, string> | null = null;

	return {
		name: "vinuxt:layouts",

		resolveId(id: string) {
			if (id === VIRTUAL_ID) return RESOLVED_ID;
			return undefined;
		},

		async load(id: string) {
			if (id !== RESOLVED_ID) return undefined;

			cache_layouts = await scanLayouts(dir_layouts);
			return generateLayoutsModule(cache_layouts);
		},

		configureServer(server) {
			// Watch for new/removed layout files
			server.watcher.on("all", (event: string, file_path: string) => {
				if (
					file_path.startsWith(dir_layouts) &&
					file_path.endsWith(".vue") &&
					(event === "add" || event === "unlink")
				) {
					cache_layouts = null;
					const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
					if (mod) server.moduleGraph.invalidateModule(mod);
				}
			});
		},
	};
}
