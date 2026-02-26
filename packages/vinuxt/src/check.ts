/**
 * vinuxt check -- compatibility scanner for Nuxt apps
 *
 * Scans an existing Nuxt app and produces a compatibility report
 * showing what will work, what needs changes, and an overall score.
 */

import fs from "node:fs";
import path from "node:path";

// -- Support status definitions -----------------------------------------------

type Status = "supported" | "partial" | "unsupported";

interface CheckItem {
	name: string;
	status: Status;
	detail?: string;
	files?: string[];
}

export interface CheckResult {
	imports: CheckItem[];
	config: CheckItem[];
	modules: CheckItem[];
	conventions: CheckItem[];
	summary: {
		supported: number;
		partial: number;
		unsupported: number;
		total: number;
		score: number;
	};
}

// -- Import support map -------------------------------------------------------

const IMPORT_SUPPORT: Record<string, { status: Status; detail?: string }> = {
	"#imports": { status: "supported", detail: "auto-imports shimmed by vinuxt" },
	"#app": { status: "supported", detail: "core Nuxt runtime shimmed" },
	"#components": { status: "supported", detail: "auto-registered components" },
	"#head": { status: "partial", detail: "uses @unhead/vue" },
	"nuxt/app": { status: "supported" },
	"nuxt": { status: "partial", detail: "type-only exports supported, runtime imports may need changes" },
	"@nuxt/kit": { status: "unsupported", detail: "build-time module kit not supported at runtime" },
	"@nuxt/schema": { status: "unsupported", detail: "Nuxt schema types not compatible" },
	"h3": { status: "unsupported", detail: "h3 server framework not used -- vinuxt uses Vite server" },
	"nitropack": { status: "unsupported", detail: "Nitro server engine not used -- vinuxt uses Vite SSR" },
	"~/server/utils": { status: "unsupported", detail: "Nitro server utils not available" },
	"~~/server/utils": { status: "unsupported", detail: "Nitro server utils not available" },
};

// -- Config support map -------------------------------------------------------

const CONFIG_SUPPORT: Record<string, { status: Status; detail?: string }> = {
	modules: { status: "partial", detail: "Nuxt modules not compatible -- check individual modules below" },
	buildModules: { status: "unsupported", detail: "deprecated in Nuxt 3, remove and use modules instead" },
	css: { status: "supported", detail: "global CSS imports work via Vite" },
	plugins: { status: "supported", detail: "Nuxt plugins auto-loaded" },
	app: { status: "supported", detail: "app config (head, transitions, etc.)" },
	runtimeConfig: { status: "supported", detail: "runtime config via useRuntimeConfig()" },
	routeRules: { status: "partial", detail: "basic route rules supported, Nitro-specific rules ignored" },
	nitro: { status: "unsupported", detail: "Nitro config not used -- vinuxt uses Vite server" },
	vite: { status: "supported", detail: "Vite config passed through" },
	typescript: { status: "supported", detail: "TypeScript handled by Vite" },
	components: { status: "supported", detail: "auto-component registration" },
	imports: { status: "supported", detail: "auto-imports configuration" },
	pages: { status: "supported", detail: "file-based routing" },
	srcDir: { status: "supported" },
	alias: { status: "supported", detail: "path aliases resolved by Vite" },
	devtools: { status: "unsupported", detail: "Nuxt DevTools not compatible -- use Vite DevTools instead" },
	experimental: { status: "partial", detail: "some experimental features may not be supported" },
	hooks: { status: "unsupported", detail: "Nuxt build hooks not supported" },
	webpack: { status: "unsupported", detail: "Vite replaces webpack" },
	ssr: { status: "supported", detail: "SSR enabled by default in vinuxt" },
};

// -- Module support map -------------------------------------------------------

const MODULE_SUPPORT: Record<string, { status: Status; detail?: string }> = {
	"@nuxtjs/tailwindcss": { status: "supported", detail: "use tailwindcss directly with Vite" },
	"@nuxt/content": { status: "unsupported", detail: "Nuxt Content depends on Nitro internals" },
	"@nuxt/image": { status: "supported", detail: "vinuxt provides <NuxtImg> via @unpic/vue" },
	"@nuxt/fonts": { status: "unsupported", detail: "font optimization module not compatible" },
	"@nuxt/icon": { status: "partial", detail: "use iconify/vue directly instead" },
	"@nuxt/ui": { status: "unsupported", detail: "Nuxt UI depends on Nuxt module system" },
	"@nuxt/eslint": { status: "supported", detail: "ESLint works independently of vinuxt" },
	"@nuxt/devtools": { status: "unsupported", detail: "use Vite DevTools instead" },
	"@nuxt/test-utils": { status: "unsupported", detail: "use vitest directly" },
	"@pinia/nuxt": { status: "partial", detail: "use pinia directly with Vue plugin" },
	"@vueuse/nuxt": { status: "partial", detail: "use @vueuse/core directly" },
	"nuxt-icon": { status: "partial", detail: "use iconify/vue directly instead" },
	"@nuxtjs/i18n": { status: "unsupported", detail: "use vue-i18n directly" },
	"@nuxtjs/color-mode": { status: "partial", detail: "use @vueuse/core useDark() instead" },
	"@nuxtjs/google-fonts": { status: "unsupported", detail: "use CSS @import or vite-plugin-webfont" },
	"@sidebase/nuxt-auth": { status: "unsupported", detail: "depends on Nuxt server routes" },
};

// -- Scanning functions -------------------------------------------------------

/**
 * Recursively find all source files in a directory.
 */
function findSourceFiles(
	dir: string,
	extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue"],
): string[] {
	const results: string[] = [];
	if (!fs.existsSync(dir)) return results;

	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const path_full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (
				entry.name === "node_modules" ||
				entry.name === ".nuxt" ||
				entry.name === ".output" ||
				entry.name === "dist" ||
				entry.name === ".git"
			) continue;
			results.push(...findSourceFiles(path_full, extensions));
		} else if (extensions.some(ext => entry.name.endsWith(ext))) {
			results.push(path_full);
		}
	}
	return results;
}

/**
 * Scan source files for Nuxt-specific import statements.
 */
export function scanImports(root: string): CheckItem[] {
	const files = findSourceFiles(root);
	const map_usage = new Map<string, string[]>();

	const regex_import = /(?:import\s+(?:[\w{},\s*]+\s+from\s+)?|require\s*\()['"]([^'"]+)['"]\)?/g;
	const regex_type_only = /import\s+type\s+/;

	for (const file of files) {
		const content = fs.readFileSync(file, "utf-8");
		let match;
		while ((match = regex_import.exec(content)) !== null) {
			const mod = match[1];
			// Skip type-only imports
			const line_start = content.lastIndexOf("\n", match.index) + 1;
			const line = content.slice(line_start, match.index + match[0].length);
			if (regex_type_only.test(line)) continue;

			// Track Nuxt-specific imports
			const is_nuxt_import =
				mod.startsWith("#") ||
				mod.startsWith("nuxt") ||
				mod.startsWith("@nuxt/") ||
				mod === "h3" ||
				mod === "nitropack" ||
				mod.startsWith("~/server/") ||
				mod.startsWith("~~/server/");

			if (is_nuxt_import) {
				if (!map_usage.has(mod)) map_usage.set(mod, []);
				const path_rel = path.relative(root, file);
				if (!map_usage.get(mod)!.includes(path_rel)) {
					map_usage.get(mod)!.push(path_rel);
				}
			}
		}
	}

	const items: CheckItem[] = [];
	for (const [mod, files_used] of map_usage) {
		const support = IMPORT_SUPPORT[mod];
		if (support) {
			items.push({
				name: mod,
				status: support.status,
				detail: support.detail,
				files: files_used,
			});
		} else {
			items.push({
				name: mod,
				status: "unsupported",
				detail: "not recognized by vinuxt",
				files: files_used,
			});
		}
	}

	// Sort: unsupported first, then partial, then supported
	items.sort((a, b) => {
		const order: Record<Status, number> = { unsupported: 0, partial: 1, supported: 2 };
		return order[a.status] - order[b.status];
	});

	return items;
}

/**
 * Analyze nuxt.config.ts/js for supported and unsupported options.
 */
export function analyzeConfig(root: string): CheckItem[] {
	const config_files = [
		"nuxt.config.ts",
		"nuxt.config.js",
		"nuxt.config.mjs",
	];
	let path_config: string | null = null;
	for (const f of config_files) {
		const p = path.join(root, f);
		if (fs.existsSync(p)) { path_config = p; break; }
	}

	if (!path_config) {
		return [{
			name: "nuxt.config",
			status: "supported",
			detail: "no config file found (defaults are fine)",
		}];
	}

	const content = fs.readFileSync(path_config, "utf-8");
	const items: CheckItem[] = [];

	const config_options = [
		"modules", "buildModules", "css", "plugins", "app",
		"runtimeConfig", "routeRules", "nitro", "vite", "typescript",
		"components", "imports", "pages", "srcDir", "alias",
		"devtools", "experimental", "hooks", "webpack", "ssr",
	];

	for (const opt of config_options) {
		const regex = new RegExp(`\\b${opt}\\b`);
		if (regex.test(content)) {
			const support = CONFIG_SUPPORT[opt];
			if (support) {
				items.push({ name: opt, status: support.status, detail: support.detail });
			} else {
				items.push({ name: opt, status: "unsupported", detail: "not recognized" });
			}
		}
	}

	// Sort: unsupported first
	items.sort((a, b) => {
		const order: Record<Status, number> = { unsupported: 0, partial: 1, supported: 2 };
		return order[a.status] - order[b.status];
	});

	return items;
}

/**
 * Check nuxt.config for modules and report their compatibility.
 */
export function checkModules(root: string): CheckItem[] {
	const config_files = [
		"nuxt.config.ts",
		"nuxt.config.js",
		"nuxt.config.mjs",
	];
	let path_config: string | null = null;
	for (const f of config_files) {
		const p = path.join(root, f);
		if (fs.existsSync(p)) { path_config = p; break; }
	}

	if (!path_config) return [];

	const content = fs.readFileSync(path_config, "utf-8");
	const items: CheckItem[] = [];

	// Also check package.json for module dependencies
	const path_pkg = path.join(root, "package.json");
	let deps_all: Record<string, string> = {};
	if (fs.existsSync(path_pkg)) {
		const pkg = JSON.parse(fs.readFileSync(path_pkg, "utf-8"));
		deps_all = { ...pkg.dependencies, ...pkg.devDependencies };
	}

	for (const [mod, support] of Object.entries(MODULE_SUPPORT)) {
		// Check if module appears in config or is installed
		const regex = new RegExp(`['"]${mod.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}['"]`);
		if (regex.test(content) || deps_all[mod]) {
			items.push({
				name: mod,
				status: support.status,
				detail: support.detail,
			});
		}
	}

	// Sort: unsupported first
	items.sort((a, b) => {
		const order: Record<Status, number> = { unsupported: 0, partial: 1, supported: 2 };
		return order[a.status] - order[b.status];
	});

	return items;
}

/**
 * Check file conventions (pages, composables, layouts, etc.)
 */
export function checkConventions(root: string): CheckItem[] {
	const items: CheckItem[] = [];

	// Detect pages/
	const path_pages = fs.existsSync(path.join(root, "pages"))
		? path.join(root, "pages")
		: fs.existsSync(path.join(root, "src", "pages"))
			? path.join(root, "src", "pages")
			: null;

	// Detect composables/
	const path_composables = fs.existsSync(path.join(root, "composables"))
		? path.join(root, "composables")
		: fs.existsSync(path.join(root, "src", "composables"))
			? path.join(root, "src", "composables")
			: null;

	// Detect layouts/
	const path_layouts = fs.existsSync(path.join(root, "layouts"))
		? path.join(root, "layouts")
		: fs.existsSync(path.join(root, "src", "layouts"))
			? path.join(root, "src", "layouts")
			: null;

	// Detect components/
	const path_components = fs.existsSync(path.join(root, "components"))
		? path.join(root, "components")
		: fs.existsSync(path.join(root, "src", "components"))
			? path.join(root, "src", "components")
			: null;

	// Detect server/
	const path_server = fs.existsSync(path.join(root, "server"))
		? path.join(root, "server")
		: null;

	// Detect middleware/
	const path_middleware = fs.existsSync(path.join(root, "middleware"))
		? path.join(root, "middleware")
		: null;

	if (path_pages) {
		const is_src = path_pages.includes(path.join("src", "pages"));
		const page_files = findSourceFiles(path_pages);
		items.push({
			name: is_src ? "Pages (src/pages/)" : "Pages (pages/)",
			status: "supported",
			detail: `${page_files.length} file(s) -- file-based routing`,
		});
	}

	if (path_composables) {
		const is_src = path_composables.includes(path.join("src", "composables"));
		const composable_files = findSourceFiles(path_composables);
		items.push({
			name: is_src ? "Composables (src/composables/)" : "Composables (composables/)",
			status: "supported",
			detail: `${composable_files.length} file(s) -- auto-imported`,
		});
	}

	if (path_layouts) {
		const is_src = path_layouts.includes(path.join("src", "layouts"));
		const layout_files = findSourceFiles(path_layouts);
		items.push({
			name: is_src ? "Layouts (src/layouts/)" : "Layouts (layouts/)",
			status: "supported",
			detail: `${layout_files.length} file(s)`,
		});
	}

	if (path_components) {
		const is_src = path_components.includes(path.join("src", "components"));
		const component_files = findSourceFiles(path_components);
		items.push({
			name: is_src ? "Components (src/components/)" : "Components (components/)",
			status: "supported",
			detail: `${component_files.length} file(s) -- auto-registered`,
		});
	}

	if (path_server) {
		const server_files = findSourceFiles(path_server);
		const api_files = server_files.filter(f => f.includes(path.join("server", "api")));
		const middleware_files = server_files.filter(f => f.includes(path.join("server", "middleware")));
		const utils_files = server_files.filter(f => f.includes(path.join("server", "utils")));

		if (api_files.length > 0) {
			items.push({
				name: `Server API (server/api/)`,
				status: "supported",
				detail: `${api_files.length} route(s)`,
			});
		}
		if (middleware_files.length > 0) {
			items.push({
				name: `Server middleware (server/middleware/)`,
				status: "supported",
				detail: `${middleware_files.length} file(s)`,
			});
		}
		if (utils_files.length > 0) {
			items.push({
				name: `Server utils (server/utils/)`,
				status: "partial",
				detail: `${utils_files.length} file(s) -- Nitro auto-imports not available, use explicit imports`,
			});
		}
	}

	if (path_middleware) {
		const mw_files = findSourceFiles(path_middleware);
		items.push({
			name: "Route middleware (middleware/)",
			status: "supported",
			detail: `${mw_files.length} file(s)`,
		});
	}

	if (!path_pages) {
		items.push({
			name: "No pages/ directory found",
			status: "unsupported",
			detail: "vinuxt requires a pages/ directory for file-based routing",
		});
	}

	// Check for "type": "module" in package.json
	const path_pkg = path.join(root, "package.json");
	if (fs.existsSync(path_pkg)) {
		const pkg = JSON.parse(fs.readFileSync(path_pkg, "utf-8"));
		if (pkg.type !== "module") {
			items.push({
				name: 'Missing "type": "module" in package.json',
				status: "unsupported",
				detail: "required for Vite -- vinuxt init will add it automatically",
			});
		}
	}

	return items;
}

/**
 * Run the full compatibility check.
 */
export function runCheck(root: string): CheckResult {
	const imports = scanImports(root);
	const config = analyzeConfig(root);
	const modules = checkModules(root);
	const conventions = checkConventions(root);

	const items_all = [...imports, ...config, ...modules, ...conventions];
	const supported = items_all.filter(i => i.status === "supported").length;
	const partial = items_all.filter(i => i.status === "partial").length;
	const unsupported = items_all.filter(i => i.status === "unsupported").length;
	const total = items_all.length;
	// Score: supported = 1, partial = 0.5, unsupported = 0
	const score = total > 0 ? Math.round(((supported + partial * 0.5) / total) * 100) : 100;

	return {
		imports,
		config,
		modules,
		conventions,
		summary: { supported, partial, unsupported, total, score },
	};
}

/**
 * Format the check result as a colored terminal report.
 */
export function formatReport(
	result: CheckResult,
	opts?: { called_from_init?: boolean },
): string {
	const lines: string[] = [];
	const statusIcon = (s: Status) =>
		s === "supported" ? "\x1b[32m\u2713\x1b[0m"
			: s === "partial" ? "\x1b[33m~\x1b[0m"
				: "\x1b[31m\u2717\x1b[0m";

	lines.push("");
	lines.push("  \x1b[1mvinuxt compatibility report\x1b[0m");
	lines.push("  " + "=".repeat(40));
	lines.push("");

	// Imports
	if (result.imports.length > 0) {
		const count_supported = result.imports.filter(i => i.status === "supported").length;
		lines.push(`  \x1b[1mImports\x1b[0m: ${count_supported}/${result.imports.length} fully supported`);
		for (const item of result.imports) {
			const suffix = item.detail ? ` \x1b[90m-- ${item.detail}\x1b[0m` : "";
			const count_files = item.files
				? ` \x1b[90m(${item.files.length} file${item.files.length === 1 ? "" : "s"})\x1b[0m`
				: "";
			lines.push(`    ${statusIcon(item.status)}  ${item.name}${count_files}${suffix}`);
		}
		lines.push("");
	}

	// Config
	if (result.config.length > 0) {
		const count_supported = result.config.filter(i => i.status === "supported").length;
		lines.push(`  \x1b[1mConfig\x1b[0m: ${count_supported}/${result.config.length} options supported`);
		for (const item of result.config) {
			const suffix = item.detail ? ` \x1b[90m-- ${item.detail}\x1b[0m` : "";
			lines.push(`    ${statusIcon(item.status)}  ${item.name}${suffix}`);
		}
		lines.push("");
	}

	// Modules
	if (result.modules.length > 0) {
		const count_supported = result.modules.filter(i => i.status === "supported").length;
		lines.push(`  \x1b[1mModules\x1b[0m: ${count_supported}/${result.modules.length} compatible`);
		for (const item of result.modules) {
			const suffix = item.detail ? ` \x1b[90m-- ${item.detail}\x1b[0m` : "";
			lines.push(`    ${statusIcon(item.status)}  ${item.name}${suffix}`);
		}
		lines.push("");
	}

	// Conventions
	if (result.conventions.length > 0) {
		lines.push(`  \x1b[1mProject structure\x1b[0m:`);
		for (const item of result.conventions) {
			const suffix = item.detail ? ` \x1b[90m-- ${item.detail}\x1b[0m` : "";
			lines.push(`    ${statusIcon(item.status)}  ${item.name}${suffix}`);
		}
		lines.push("");
	}

	// Summary
	const { score, supported, partial, unsupported } = result.summary;
	const color_score = score >= 90 ? "\x1b[32m" : score >= 70 ? "\x1b[33m" : "\x1b[31m";
	lines.push("  " + "-".repeat(40));
	lines.push(
		`  \x1b[1mOverall\x1b[0m: ${color_score}${score}% compatible\x1b[0m` +
		` (${supported} supported, ${partial} partial, ${unsupported} issues)`,
	);

	if (unsupported > 0) {
		lines.push("");
		lines.push("  \x1b[1mIssues to address:\x1b[0m");
		const items_all = [...result.imports, ...result.config, ...result.modules, ...result.conventions];
		for (const item of items_all) {
			if (item.status === "unsupported") {
				lines.push(`    \x1b[31m\u2717\x1b[0m  ${item.name}${item.detail ? ` -- ${item.detail}` : ""}`);
			}
		}
	}

	if (result.summary.partial > 0) {
		lines.push("");
		lines.push("  \x1b[1mPartial support (may need attention):\x1b[0m");
		const items_all = [...result.imports, ...result.config, ...result.modules, ...result.conventions];
		for (const item of items_all) {
			if (item.status === "partial") {
				lines.push(`    \x1b[33m~\x1b[0m  ${item.name}${item.detail ? ` -- ${item.detail}` : ""}`);
			}
		}
	}

	// Actionable next steps (skip when called from init)
	if (!opts?.called_from_init) {
		lines.push("");
		lines.push("  \x1b[1mRecommended next steps:\x1b[0m");
		lines.push(`    Run \x1b[36mvinuxt init\x1b[0m to set up your project automatically`);
		lines.push("");
		lines.push("  Or manually:");
		lines.push(`    1. Add \x1b[36m"type": "module"\x1b[0m to package.json`);
		lines.push(`    2. Install: \x1b[36mpnpm add -D vinuxt vite\x1b[0m`);
		lines.push(`    3. Create vite.config.ts with vinuxt() plugin`);
		lines.push(`    4. Run: \x1b[36mpnpm exec vinuxt dev\x1b[0m`);
	}

	lines.push("");
	return lines.join("\n");
}
