/**
 * vinuxt deploy -- one-command Cloudflare Workers deployment.
 *
 * Takes any Nuxt/vinuxt app and deploys it to Cloudflare Workers:
 *
 *   1. Builds production output (client + server SSR)
 *   2. Auto-generates wrangler.toml and worker entry if missing
 *   3. Ensures wrangler is installed
 *   4. Runs `wrangler deploy`
 *
 * Design: Everything is auto-generated into the project root only when
 * the config files don't already exist. If the user already has these
 * files, we use theirs.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync, type ExecSyncOptions } from "node:child_process";
import { parseArgs as nodeParseArgs } from "node:util";
import { runTPR } from "./cloudflare/tpr.js";
import { loadDotenv } from "./config/dotenv.js";

// --- Types -------------------------------------------------------------------

export interface DeployOptions {
	/** Project root directory */
	root: string;
	/** Deploy to preview environment (default: production) */
	preview?: boolean;
	/** Wrangler environment name from wrangler.toml env.<name> */
	env?: string;
	/** Custom project name for the Worker */
	name?: string;
	/** Skip the build step (assume already built) */
	skipBuild?: boolean;
	/** Dry run -- generate config files but don't build or deploy */
	dryRun?: boolean;
	/** Enable experimental TPR (Traffic-aware Pre-Rendering) */
	experimentalTPR?: boolean;
	/** TPR: traffic coverage percentage target (0-100, default: 90) */
	tprCoverage?: number;
	/** TPR: hard cap on number of pages to pre-render (default: 1000) */
	tprLimit?: number;
	/** TPR: analytics lookback window in hours (default: 24) */
	tprWindow?: number;
}

// --- CLI arg parsing ---------------------------------------------------------

/** Deploy command flag definitions for util.parseArgs. */
const deploy_arg_options = {
	help:               { type: "boolean", short: "h", default: false },
	preview:            { type: "boolean", default: false },
	env:                { type: "string" },
	name:               { type: "string" },
	"skip-build":       { type: "boolean", default: false },
	"dry-run":          { type: "boolean", default: false },
	"experimental-tpr": { type: "boolean", default: false },
	"tpr-coverage":     { type: "string" },
	"tpr-limit":        { type: "string" },
	"tpr-window":       { type: "string" },
} as const;

export function parseDeployArgs(args: string[]) {
	const { values } = nodeParseArgs({ args, options: deploy_arg_options, strict: true });
	return {
		help: values.help,
		preview: values.preview,
		env: values.env?.trim() || undefined,
		name: values.name?.trim() || undefined,
		skipBuild: values["skip-build"],
		dryRun: values["dry-run"],
		experimentalTPR: values["experimental-tpr"],
		tprCoverage: values["tpr-coverage"] ? parseInt(values["tpr-coverage"], 10) : undefined,
		tprLimit: values["tpr-limit"] ? parseInt(values["tpr-limit"], 10) : undefined,
		tprWindow: values["tpr-window"] ? parseInt(values["tpr-window"], 10) : undefined,
	};
}

// --- Project Detection -------------------------------------------------------

interface ProjectInfo {
	root: string;
	has_pages_dir: boolean;
	has_vite_config: boolean;
	has_wrangler_config: boolean;
	has_worker_entry: boolean;
	has_wrangler: boolean;
	project_name: string;
	/** Pages that use ISR-style caching */
	has_isr: boolean;
}

// --- Detection ---------------------------------------------------------------

export function detectProject(root: string): ProjectInfo {
	const has_pages_dir =
		fs.existsSync(path.join(root, "pages")) ||
		fs.existsSync(path.join(root, "src", "pages"));

	const has_vite_config =
		fs.existsSync(path.join(root, "vite.config.ts")) ||
		fs.existsSync(path.join(root, "vite.config.js")) ||
		fs.existsSync(path.join(root, "vite.config.mjs"));

	const has_wrangler_config =
		fs.existsSync(path.join(root, "wrangler.toml")) ||
		fs.existsSync(path.join(root, "wrangler.jsonc")) ||
		fs.existsSync(path.join(root, "wrangler.json"));

	const has_worker_entry =
		fs.existsSync(path.join(root, "worker", "index.ts")) ||
		fs.existsSync(path.join(root, "worker", "index.js"));

	const has_wrangler = fs.existsSync(
		path.join(root, "node_modules", ".bin", "wrangler"),
	);

	// Derive project name from package.json or directory name
	let project_name = path.basename(root);
	const path_pkg = path.join(root, "package.json");
	if (fs.existsSync(path_pkg)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path_pkg, "utf-8"));
			if (pkg.name) {
				// Sanitize: Workers names must be lowercase alphanumeric + hyphens
				project_name = pkg.name
					.replace(/^@[^/]+\//, "") // strip npm scope
					.replace(/[^a-z0-9-]/g, "-")
					.replace(/-+/g, "-")
					.replace(/^-|-$/g, "");
			}
		} catch {
			// ignore parse errors
		}
	}

	// Detect ISR usage (rough heuristic: search for defineRouteRules with cache)
	const has_isr = detectISR(root);

	return {
		root,
		has_pages_dir,
		has_vite_config,
		has_wrangler_config,
		has_worker_entry,
		has_wrangler,
		project_name,
		has_isr,
	};
}

function detectISR(root: string): boolean {
	try {
		// Check pages/ or app/ directories for cache/ISR patterns
		const dirs_to_check = [
			path.join(root, "pages"),
			path.join(root, "src", "pages"),
			path.join(root, "app"),
			path.join(root, "src", "app"),
		];

		for (const dir of dirs_to_check) {
			if (fs.existsSync(dir)) {
				if (scanDirForPattern(dir, /defineRouteRules|swr|isr|cache/)) {
					return true;
				}
			}
		}

		// Also check nuxt.config for routeRules with swr/isr
		const config_files = [
			"nuxt.config.ts",
			"nuxt.config.js",
			"nuxt.config.mjs",
		];
		for (const f of config_files) {
			const p = path.join(root, f);
			if (fs.existsSync(p)) {
				try {
					const content = fs.readFileSync(p, "utf-8");
					if (/routeRules.*swr|routeRules.*isr|cache/i.test(content)) {
						return true;
					}
				} catch {
					// ignore
				}
			}
		}

		return false;
	} catch {
		return false;
	}
}

function scanDirForPattern(dir: string, pattern: RegExp): boolean {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full_path = path.join(dir, entry.name);
		if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
			if (scanDirForPattern(full_path, pattern)) return true;
		} else if (entry.isFile() && /\.(ts|tsx|js|jsx|vue)$/.test(entry.name)) {
			try {
				const content = fs.readFileSync(full_path, "utf-8");
				if (pattern.test(content)) return true;
			} catch {
				// skip unreadable files
			}
		}
	}
	return false;
}

// --- File Generation ---------------------------------------------------------

/** Generate wrangler.toml content */
export function generateWranglerConfig(info: ProjectInfo): string {
	const today = new Date().toISOString().split("T")[0];

	let toml = `# Generated by vinuxt deploy -- edit freely or delete to regenerate.
name = "${info.project_name}"
compatibility_date = "${today}"
compatibility_flags = ["nodejs_compat"]
main = "worker/index.ts"

[assets]
not_found_handling = "none"
binding = "ASSETS"
`;

	if (info.has_isr) {
		toml += `
[[kv_namespaces]]
binding = "VINUXT_CACHE"
id = "<your-kv-namespace-id>"
`;
	}

	return toml;
}

/** Generate worker/index.ts -- Cloudflare Worker entry for vinuxt */
export function generateWorkerEntry(): string {
	return `/**
 * Cloudflare Worker entry point -- auto-generated by vinuxt deploy.
 * Edit freely or delete to regenerate on next deploy.
 */

// @ts-expect-error -- virtual module resolved by vinuxt at build time
import { createApp } from "virtual:vinuxt-server-entry";

interface Env {
	ASSETS: Fetcher;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		try {
			const url = new URL(request.url);
			const pathname = url.pathname;

			// Block protocol-relative URL open redirects (//evil.com/).
			const safe_path = pathname.replaceAll("\\\\", "/");
			if (safe_path.startsWith("//")) {
				return new Response("404 Not Found", { status: 404 });
			}

			// Try static assets first via the ASSETS binding.
			const asset_response = await env.ASSETS.fetch(
				new Request(new URL(pathname, request.url)),
			);
			if (asset_response.ok) {
				return asset_response;
			}

			// Fall back to SSR rendering via vinuxt server entry.
			const { renderToString } = await import("vue/server-renderer");
			const { app, router } = await createApp(url.pathname + url.search);

			if (!router.currentRoute.value.matched.length) {
				return new Response("404 Not Found", { status: 404 });
			}

			const html = await renderToString(app);
			return new Response(
				\\\`<!DOCTYPE html><html><head></head><body><div id="app">\\\${html}</div></body></html>\\\`,
				{
					status: 200,
					headers: { "Content-Type": "text/html; charset=utf-8" },
				},
			);
		} catch (error) {
			console.error("[vinuxt] Worker error:", error);
			return new Response("Internal Server Error", { status: 500 });
		}
	},
};
`;
}

// --- Dependency Management ---------------------------------------------------

interface MissingDep {
	name: string;
	version: string;
}

/**
 * Check if a package is resolvable from a given root directory using
 * Node's module resolution (createRequire).
 */
export function isPackageResolvable(root: string, package_name: string): boolean {
	try {
		const req = createRequire(path.join(root, "package.json"));
		req.resolve(package_name);
		return true;
	} catch {
		return false;
	}
}

export function getMissingDeps(info: ProjectInfo): MissingDep[] {
	const missing: MissingDep[] = [];

	if (!info.has_wrangler) {
		missing.push({ name: "wrangler", version: "latest" });
	}

	return missing;
}

function detectPackageManager(root: string): string {
	if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) {
		return "pnpm";
	}
	if (fs.existsSync(path.join(root, "yarn.lock"))) {
		return "yarn";
	}
	if (fs.existsSync(path.join(root, "bun.lockb")) || fs.existsSync(path.join(root, "bun.lock"))) {
		return "bun";
	}
	return "npm";
}

function installDeps(root: string, deps: MissingDep[]): void {
	if (deps.length === 0) return;

	const pm = detectPackageManager(root);
	const dep_args = deps.map((d) => `${d.name}@${d.version}`);

	console.log(`  Installing: ${deps.map((d) => d.name).join(", ")}`);

	// Use execFileSync to prevent shell injection.
	// Each package manager has a different flag for dev dependencies.
	const args = pm === "npm"
		? ["install", "-D", ...dep_args]
		: ["add", "-D", ...dep_args];

	execFileSync(pm, args, {
		cwd: root,
		stdio: "inherit",
	});
}

// --- File Writing ------------------------------------------------------------

interface GeneratedFile {
	path: string;
	content: string;
	description: string;
}

export function getFilesToGenerate(info: ProjectInfo): GeneratedFile[] {
	const files: GeneratedFile[] = [];

	if (!info.has_wrangler_config) {
		files.push({
			path: path.join(info.root, "wrangler.toml"),
			content: generateWranglerConfig(info),
			description: "wrangler.toml",
		});
	}

	if (!info.has_worker_entry) {
		files.push({
			path: path.join(info.root, "worker", "index.ts"),
			content: generateWorkerEntry(),
			description: "worker/index.ts",
		});
	}

	return files;
}

function writeGeneratedFiles(files: GeneratedFile[]): void {
	for (const file of files) {
		const dir = path.dirname(file.path);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.writeFileSync(file.path, file.content, "utf-8");
		console.log(`  Created ${file.description}`);
	}
}

// --- Build -------------------------------------------------------------------

async function runBuild(root: string): Promise<void> {
	console.log("\n  Building for Cloudflare Workers...\n");

	// Use Vite's JS API for the build. Performs the same two-pass build
	// (client + server SSR) that `vinuxt build` does in the CLI.
	const { pathToFileURL } = await import("node:url");

	const vite_path = path.join(root, "node_modules", "vite", "dist", "node", "index.js");
	const vite = await import(
		/* @vite-ignore */ pathToFileURL(vite_path).href
	) as typeof import("vite");

	// Client build
	console.log("  Building client...");
	await vite.build({
		root,
		build: {
			outDir: "dist/client",
			manifest: true,
			ssrManifest: true,
			emptyOutDir: true,
			rollupOptions: {
				input: "virtual:vinuxt-client-entry",
			},
		},
	});

	// Server SSR build
	console.log("  Building server...");
	await vite.build({
		root,
		build: {
			outDir: "dist/server",
			ssr: "virtual:vinuxt-server-entry",
			emptyOutDir: true,
			rollupOptions: {
				output: {
					entryFileNames: "entry.js",
				},
			},
		},
	});
}

// --- Deploy ------------------------------------------------------------------

export interface WranglerDeployArgs {
	args: string[];
	env: string | undefined;
}

export function buildWranglerDeployArgs(
	options: Pick<DeployOptions, "preview" | "env">,
): WranglerDeployArgs {
	const args = ["deploy"];
	const env = options.env || (options.preview ? "preview" : undefined);
	if (env) {
		args.push("--env", env);
	}
	return { args, env };
}

function runWranglerDeploy(
	root: string,
	options: Pick<DeployOptions, "preview" | "env">,
): string {
	const wrangler_bin = path.join(root, "node_modules", ".bin", "wrangler");

	const exec_opts: ExecSyncOptions = {
		cwd: root,
		stdio: "pipe",
		encoding: "utf-8",
	};

	const { args, env } = buildWranglerDeployArgs(options);

	if (env) {
		console.log(`\n  Deploying to env: ${env}...`);
	} else {
		console.log("\n  Deploying to production...");
	}

	// Use execFileSync to avoid shell injection -- args are passed as an array,
	// never interpolated into a shell command string.
	const output = execFileSync(wrangler_bin, args, exec_opts) as string;

	// Parse the deployed URL from wrangler output
	const url_match = output.match(/https:\/\/[^\s]+\.workers\.dev[^\s]*/);
	const deployed_url = url_match ? url_match[0] : null;

	// Print raw output for transparency
	if (output.trim()) {
		for (const line of output.trim().split("\n")) {
			console.log(`  ${line}`);
		}
	}

	return deployed_url ?? "(URL not detected in wrangler output)";
}

// --- Main Entry --------------------------------------------------------------

export async function deploy(options: DeployOptions): Promise<void> {
	const root = path.resolve(options.root);
	loadDotenv({ root, mode: "production" });

	console.log("\n  vinuxt deploy\n");

	// Step 1: Detect project structure
	const info = detectProject(root);

	if (options.name) {
		info.project_name = options.name;
	}

	console.log(`  Project: ${info.project_name}`);
	console.log(`  ISR:     ${info.has_isr ? "detected" : "none"}`);

	// Step 2: Check and install missing dependencies
	const missing_deps = getMissingDeps(info);
	if (missing_deps.length > 0) {
		console.log();
		installDeps(root, missing_deps);
		info.has_wrangler = true;
	}

	// Step 3: Generate missing config files
	const files_to_generate = getFilesToGenerate(info);
	if (files_to_generate.length > 0) {
		console.log();
		writeGeneratedFiles(files_to_generate);
	}

	if (options.dryRun) {
		console.log("\n  Dry run complete. Files generated but no build or deploy performed.\n");
		return;
	}

	// Step 4: Build
	if (!options.skipBuild) {
		await runBuild(root);
	} else {
		console.log("\n  Skipping build (--skip-build)");
	}

	// Step 5: TPR -- pre-render hot pages into KV cache (experimental, opt-in)
	if (options.experimentalTPR) {
		console.log();
		const tpr_result = await runTPR({
			root,
			coverage: Math.max(1, Math.min(100, options.tprCoverage ?? 90)),
			limit: Math.max(1, options.tprLimit ?? 1000),
			window: Math.max(1, options.tprWindow ?? 24),
		});

		if (tpr_result.skipped) {
			console.log(`  TPR: Skipped (${tpr_result.skipped})`);
		}
	}

	// Step 6: Deploy via wrangler
	const url = runWranglerDeploy(root, {
		preview: options.preview ?? false,
		env: options.env,
	});

	console.log("\n  ─────────────────────────────────────────");
	console.log(`  Deployed to: ${url}`);
	console.log("  ─────────────────────────────────────────\n");
}
