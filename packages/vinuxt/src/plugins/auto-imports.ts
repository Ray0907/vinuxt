import type { Plugin } from "vite";
import { createUnimport, type InlinePreset } from "unimport";
import path from "node:path";

/**
 * Preset of vinuxt composables to auto-import in user code.
 */
function buildVinuxtPreset(): InlinePreset {
	return {
		from: "vinuxt/composables",
		imports: [
			"useAsyncData",
			"useFetch",
			"useState",
			"useCookie",
			"useRuntimeConfig",
			"useRouter",
			"useRoute",
			"navigateTo",
			"useError",
			"createError",
			"showError",
			"clearError",
		],
	};
}

export interface AutoImportsOptions {
	root: string;
}

/**
 * Create the auto-imports Vite plugin.
 *
 * Uses `unimport` to provide automatic imports for:
 * - All vinuxt composables (useAsyncData, useFetch, etc.)
 * - User files in `composables/` and `utils/` directories
 */
export function createAutoImportsPlugin(options: AutoImportsOptions): Plugin & {
	_preset: InlinePreset;
	_scanDirs: string[];
} {
	const preset = buildVinuxtPreset();
	const dir_composables = path.join(options.root, "composables");
	const dir_utils = path.join(options.root, "utils");
	const scan_dirs = [dir_composables, dir_utils];

	const ctx = createUnimport({
		presets: [preset],
		dirs: scan_dirs,
	});

	return {
		name: "vinuxt:auto-imports",

		async transform(code, id) {
			// Skip virtual modules and node_modules
			if (id.startsWith("\0") || id.includes("node_modules")) {
				return undefined;
			}

			// Only transform JS/TS/Vue files
			if (!/\.(vue|ts|tsx|js|jsx|mjs)$/.test(id)) {
				return undefined;
			}

			const result = await ctx.injectImports(code, id);
			if (result && result.code !== code) {
				return {
					code: result.code,
					map: result.s?.generateMap({ hires: true }) ?? null,
				};
			}

			return undefined;
		},

		// Exposed for testing
		_preset: preset,
		_scanDirs: scan_dirs,
	} as Plugin & { _preset: InlinePreset; _scanDirs: string[] };
}
