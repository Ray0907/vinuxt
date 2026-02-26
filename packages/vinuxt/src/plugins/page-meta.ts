import type { Plugin } from "vite";
import MagicString from "magic-string";

export interface PageMetaOptions {
	root: string;
}

/**
 * Regex to match `definePageMeta({ ... })` calls.
 *
 * Captures the object literal argument (including braces) in group 1.
 * Uses a non-greedy match for the content between braces, which works
 * for typical flat meta objects. Deeply nested objects are not expected.
 */
const RE_DEFINE_PAGE_META = /definePageMeta\s*\(\s*(\{[\s\S]*?\})\s*\)/;

/**
 * Create the definePageMeta macro transform Vite plugin.
 *
 * Processes `.vue` files inside `pages/` and:
 * 1. Detects `definePageMeta({ ... })` calls
 * 2. Removes the call from runtime code (it's a compile-time macro)
 * 3. Appends a `__pageMetaRaw` export containing the extracted meta object
 */
export function createPageMetaPlugin(options: PageMetaOptions): Plugin {
	const dir_pages = options.root + "/pages/";

	return {
		name: "vinuxt:page-meta",

		transform(code: string, id: string) {
			// Only process .vue files inside pages/
			if (!id.endsWith(".vue")) return null;

			const path_normalized = id.replace(/\\/g, "/");
			if (!path_normalized.startsWith(dir_pages.replace(/\\/g, "/"))) {
				return null;
			}

			// Check if definePageMeta is used
			const match = code.match(RE_DEFINE_PAGE_META);
			if (!match) return null;

			const meta_object = match[1];
			const s = new MagicString(code);

			// Remove the definePageMeta call (replace with empty comment)
			const idx_start = match.index!;
			const idx_end = idx_start + match[0].length;
			s.overwrite(idx_start, idx_end, "/* definePageMeta extracted */");

			// Append the __pageMetaRaw export as a script block addition
			const export_code = `\n<script>\nexport const __pageMetaRaw = ${meta_object};\n</script>\n`;
			s.append(export_code);

			return {
				code: s.toString(),
				map: s.generateMap({ hires: true }),
			};
		},
	};
}
