#!/usr/bin/env node

/**
 * vinuxt CLI -- drop-in replacement for the `nuxt` command
 *
 *   vinuxt dev     Start development server (Vite)
 *   vinuxt build   Build for production
 *   vinuxt start   Start production server
 *   vinuxt deploy  Deploy to Cloudflare Workers
 *   vinuxt lint    Run linter (delegates to eslint/oxlint)
 *
 * Automatically configures Vite with the vinuxt plugin -- no vite.config.ts
 * needed for most Nuxt apps.
 */

import vinuxt, { clientOutputConfig, clientTreeshakeConfig } from "./index.js";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { loadDotenv } from "./config/dotenv.js";

// --- Resolve Vite from the project root -----------------------------------------
//
// When vinuxt is installed via `pnpm link` or symlinked, Node follows the
// symlink back to the monorepo and resolves `vite` from the monorepo's
// node_modules -- not the project's. This causes dual Vite instances, dual
// Vue copies, and plugin resolution failures.
//
// To fix this, we resolve Vite dynamically from `process.cwd()` at runtime
// using `createRequire`. This ensures we always use the project's Vite.

interface ViteModule {
  createServer: typeof import("vite").createServer;
  build: typeof import("vite").build;
  version: string;
}

let _viteModule: ViteModule | null = null;

/**
 * Dynamically load Vite from the project root. Falls back to the bundled
 * copy if the project doesn't have its own Vite installation.
 */
async function loadVite(): Promise<ViteModule> {
  if (_viteModule) return _viteModule;

  const projectRoot = process.cwd();
  let vitePath: string;

  try {
    // Resolve "vite" from the project root, not from vinuxt's location
    const require = createRequire(path.join(projectRoot, "package.json"));
    vitePath = require.resolve("vite");
  } catch {
    // Fallback: use the Vite that ships with vinuxt (works for non-linked installs)
    vitePath = "vite";
  }

  // On Windows, absolute paths must be file:// URLs for ESM import().
  // The fallback ("vite") is a bare specifier and works as-is.
  const viteUrl = vitePath === "vite" ? vitePath : pathToFileURL(vitePath).href;
  const vite = (await import(/* @vite-ignore */ viteUrl)) as ViteModule;
  _viteModule = vite;
  return vite;
}

/**
 * Get the Vite version string. Returns "unknown" before loadVite() is called.
 */
function getViteVersion(): string {
  return _viteModule?.version ?? "unknown";
}

const VERSION = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
).version as string;

// --- CLI Argument Parsing -------------------------------------------------------

const command = process.argv[2];
const rawArgs = process.argv.slice(3);

interface ParsedArgs {
  port?: number;
  hostname?: string;
  help?: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--port" || arg === "-p") {
      result.port = parseInt(args[++i], 10);
    } else if (arg.startsWith("--port=")) {
      result.port = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--hostname" || arg === "-H") {
      result.hostname = args[++i];
    } else if (arg.startsWith("--hostname=")) {
      result.hostname = arg.split("=")[1];
    }
  }
  return result;
}

// --- Auto-configuration --------------------------------------------------------

/**
 * Build the Vite config automatically. If a vite.config.ts exists in the
 * project, Vite will merge our config with it (theirs takes precedence).
 * If there's no vite.config, this provides everything needed.
 */
function hasViteConfig(): boolean {
  return (
    fs.existsSync(path.join(process.cwd(), "vite.config.ts")) ||
    fs.existsSync(path.join(process.cwd(), "vite.config.js")) ||
    fs.existsSync(path.join(process.cwd(), "vite.config.mjs"))
  );
}

function buildViteConfig(overrides: Record<string, unknown> = {}) {
  const hasConfig = hasViteConfig();

  // If a vite.config exists, let Vite load it -- only set root and overrides.
  // The user's config already has vinuxt() plugins configured.
  // Adding them here too would duplicate transforms.
  if (hasConfig) {
    return {
      root: process.cwd(),
      ...overrides,
    };
  }

  // No vite.config -- auto-configure everything.
  const config: Record<string, unknown> = {
    root: process.cwd(),
    configFile: false,
    plugins: [vinuxt()],
    // Deduplicate Vue packages to prevent issues when vinuxt is symlinked
    // (pnpm link) and both vinuxt's and the project's node_modules
    // contain Vue.
    resolve: {
      dedupe: ["vue", "vue-router", "@vue/runtime-core"],
    },
    ...overrides,
  };

  return config;
}

// --- Commands ------------------------------------------------------------------

async function dev() {
  const parsed = parseArgs(rawArgs);
  if (parsed.help) return printHelp("dev");

  loadDotenv({
    root: process.cwd(),
    mode: "development",
  });

  const vite = await loadVite();

  const port = parsed.port ?? 3000;
  const host = parsed.hostname ?? "localhost";

  console.log(`\n  vinuxt dev  (Vite ${getViteVersion()})\n`);

  const config = buildViteConfig({
    server: { port, host },
  });

  const server = await vite.createServer(config);
  await server.listen();
  server.printUrls();
}

async function buildApp() {
  const parsed = parseArgs(rawArgs);
  if (parsed.help) return printHelp("build");

  loadDotenv({
    root: process.cwd(),
    mode: "production",
  });

  const vite = await loadVite();

  console.log(`\n  vinuxt build  (Vite ${getViteVersion()})\n`);

  const time_start = performance.now();
  const app_root = process.cwd();

  // --- Pass 1: Client build -------------------------------------------
  console.log("  Building client...");
  const time_client_start = performance.now();

  await vite.build(
    buildViteConfig({
      build: {
        outDir: "dist/client",
        manifest: true,
        ssrManifest: true,
        emptyOutDir: true,
        rollupOptions: {
          input: "virtual:vinuxt-client-entry",
          output: clientOutputConfig,
          treeshake: clientTreeshakeConfig,
        },
      },
    }),
  );

  const time_client = performance.now() - time_client_start;

  // --- Pass 2: Server SSR build ---------------------------------------
  console.log("  Building server...");
  const time_server_start = performance.now();

  await vite.build(
    buildViteConfig({
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
    }),
  );

  const time_server = performance.now() - time_server_start;

  // --- Summary --------------------------------------------------------
  const time_total = performance.now() - time_start;

  const size_client = measureDirSize(path.join(app_root, "dist", "client"));
  const size_server = measureDirSize(path.join(app_root, "dist", "server"));

  console.log("");
  console.log(
    `  Client:  ${formatBytes(size_client)}  (${(time_client / 1000).toFixed(1)}s)`,
  );
  console.log(
    `  Server:  ${formatBytes(size_server)}  (${(time_server / 1000).toFixed(1)}s)`,
  );
  console.log(`  Total:   ${(time_total / 1000).toFixed(1)}s`);
  console.log("");
  console.log(
    "  Build complete. Run `vinuxt start` to start the production server.\n",
  );
}

/**
 * Recursively measure the total size (in bytes) of all files in a directory.
 * Returns 0 if the directory does not exist.
 */
function measureDirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;

  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entry_path = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += measureDirSize(entry_path);
    } else if (entry.isFile()) {
      total += fs.statSync(entry_path).size;
    }
  }
  return total;
}

/**
 * Format a byte count into a human-readable string (e.g. "142.3 kB").
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function start() {
  const parsed = parseArgs(rawArgs);
  if (parsed.help) return printHelp("start");

  loadDotenv({
    root: process.cwd(),
    mode: "production",
  });

  const port = parsed.port ?? parseInt(process.env.PORT ?? "3000", 10);
  const host = parsed.hostname ?? "0.0.0.0";

  console.log(`\n  vinuxt start  (port ${port})\n`);

  const { startProdServer } = (await import(
    /* @vite-ignore */ "./server/prod-server.js"
  )) as {
    startProdServer: (opts: {
      port: number;
      host: string;
      outDir: string;
    }) => Promise<unknown>;
  };

  await startProdServer({
    port,
    host,
    outDir: path.resolve(process.cwd(), "dist"),
  });
}

async function lint() {
  const parsed = parseArgs(rawArgs);
  if (parsed.help) return printHelp("lint");

  console.log(`\n  vinuxt lint\n`);

  // Try oxlint first (fast), fall back to eslint
  const cwd = process.cwd();
  const hasOxlint = fs.existsSync(
    path.join(cwd, "node_modules", ".bin", "oxlint"),
  );
  const hasEslint = fs.existsSync(
    path.join(cwd, "node_modules", ".bin", "eslint"),
  );

  // Check for eslint config
  const hasLintConfig =
    fs.existsSync(path.join(cwd, ".eslintrc.json")) ||
    fs.existsSync(path.join(cwd, ".eslintrc.js")) ||
    fs.existsSync(path.join(cwd, ".eslintrc.cjs")) ||
    fs.existsSync(path.join(cwd, "eslint.config.js")) ||
    fs.existsSync(path.join(cwd, "eslint.config.mjs"));

  try {
    if (hasEslint && hasLintConfig) {
      console.log("  Using eslint (with existing config)\n");
      execFileSync("npx", ["eslint", "."], { cwd, stdio: "inherit" });
    } else if (hasOxlint) {
      console.log("  Using oxlint\n");
      execFileSync("npx", ["oxlint", "."], { cwd, stdio: "inherit" });
    } else if (hasEslint) {
      console.log("  Using eslint\n");
      execFileSync("npx", ["eslint", "."], { cwd, stdio: "inherit" });
    } else {
      console.log(
        "  No linter found. Install eslint or oxlint:\n\n" +
          "    pnpm add -D eslint\n" +
          "    # or\n" +
          "    pnpm add -D oxlint\n",
      );
      process.exit(1);
    }
    console.log("\n  Lint passed.\n");
  } catch {
    process.exit(1);
  }
}

async function deployCommand() {
  const parsed = parseArgs(rawArgs);
  if (parsed.help) return printHelp("deploy");

  // TODO: implement deploy -- requires ./deploy.js
  console.log("\n  vinuxt deploy is not yet implemented.\n");
  process.exit(1);
}

async function check() {
  const parsed = parseArgs(rawArgs);
  if (parsed.help) return printHelp("check");

  // TODO: implement check -- requires ./check.js
  console.log("\n  vinuxt check is not yet implemented.\n");
  process.exit(1);
}

async function initCommand() {
  const parsed = parseArgs(rawArgs);
  if (parsed.help) return printHelp("init");

  // TODO: implement init -- requires ./init.js
  console.log("\n  vinuxt init is not yet implemented.\n");
  process.exit(1);
}

// --- Help ----------------------------------------------------------------------

function printHelp(cmd?: string) {
  if (cmd === "dev") {
    console.log(`
  vinuxt dev - Start development server

  Usage: vinuxt dev [options]

  Options:
    -p, --port <port>        Port to listen on (default: 3000)
    -H, --hostname <host>    Hostname to bind to (default: localhost)
    -h, --help               Show this help
`);
    return;
  }

  if (cmd === "build") {
    console.log(`
  vinuxt build - Build for production

  Usage: vinuxt build [options]

  Runs a client + server SSR build via Vite.

  Options:
    -h, --help    Show this help
`);
    return;
  }

  if (cmd === "start") {
    console.log(`
  vinuxt start - Start production server

  Usage: vinuxt start [options]

  Serves the output from \`vinuxt build\`. Supports SSR, static files,
  compression, and all middleware.

  Options:
    -p, --port <port>        Port to listen on (default: 3000, or PORT env)
    -H, --hostname <host>    Hostname to bind to (default: 0.0.0.0)
    -h, --help               Show this help
`);
    return;
  }

  if (cmd === "deploy") {
    console.log(`
  vinuxt deploy - Deploy to Cloudflare Workers

  Usage: vinuxt deploy [options]

  One-command deployment to Cloudflare Workers. Automatically:
    - Generates wrangler.jsonc, worker/index.ts, vite.config.ts if missing
    - Installs @cloudflare/vite-plugin and wrangler if needed
    - Builds the project with Vite
    - Deploys via wrangler

  Options:
    --preview                Deploy to preview environment (same as --env preview)
    --env <name>             Deploy using wrangler env.<name>
    --name <name>            Custom Worker name (default: from package.json)
    --skip-build             Skip the build step (use existing dist/)
    --dry-run                Generate config files without building or deploying
    -h, --help               Show this help

  Examples:
    vinuxt deploy                              Build and deploy to production
    vinuxt deploy --preview                    Deploy to a preview URL
    vinuxt deploy --env staging                Deploy using wrangler env.staging
    vinuxt deploy --dry-run                    See what files would be generated
    vinuxt deploy --name my-app                Deploy with a custom Worker name
`);
    return;
  }

  if (cmd === "check") {
    console.log(`
  vinuxt check - Scan Nuxt app for compatibility

  Usage: vinuxt check [options]

  Scans your Nuxt project and produces a compatibility report showing
  which imports, config options, libraries, and conventions are supported,
  partially supported, or unsupported by vinuxt.

  Options:
    -h, --help    Show this help
`);
    return;
  }

  if (cmd === "init") {
    console.log(`
  vinuxt init - Migrate a Nuxt project to run under vinuxt

  Usage: vinuxt init [options]

  One-command migration: installs dependencies, configures ESM,
  generates vite.config.ts, and adds scripts. Your Nuxt setup
  continues to work alongside vinuxt.

  Options:
    -p, --port <port>    Dev server port for the vinuxt script (default: 3001)
    --skip-check         Skip the compatibility check step
    --force              Overwrite existing vite.config.ts
    -h, --help           Show this help

  Examples:
    vinuxt init                   Migrate with defaults
    vinuxt init -p 4000           Use port 4000 for dev:vinuxt
    vinuxt init --force           Overwrite existing vite.config.ts
    vinuxt init --skip-check      Skip the compatibility report
`);
    return;
  }

  if (cmd === "lint") {
    console.log(`
  vinuxt lint - Run linter

  Usage: vinuxt lint [options]

  Delegates to your project's eslint or oxlint.
  If neither is installed, suggests how to add one.

  Options:
    -h, --help    Show this help
`);
    return;
  }

  console.log(`
  vinuxt v${VERSION} - Run Nuxt apps on Vite

  Usage: vinuxt <command> [options]

  Commands:
    dev      Start development server
    build    Build for production
    start    Start production server
    deploy   Deploy to Cloudflare Workers
    init     Migrate a Nuxt project to vinuxt
    check    Scan Nuxt app for compatibility
    lint     Run linter

  Options:
    -h, --help     Show this help
    --version      Show version

  Examples:
    vinuxt dev                  Start dev server on port 3000
    vinuxt dev -p 4000          Start dev server on port 4000
    vinuxt build                Build for production
    vinuxt start                Start production server
    vinuxt deploy               Deploy to Cloudflare Workers
    vinuxt init                 Migrate a Nuxt project
    vinuxt check                Check compatibility
    vinuxt lint                 Run linter

  vinuxt is a drop-in replacement for the \`nuxt\` CLI.
  No vite.config.ts needed -- just run \`vinuxt dev\` in your Nuxt project.
`);
}

// --- Entry ---------------------------------------------------------------------

if (command === "--version" || command === "-v") {
  console.log(`vinuxt v${VERSION}`);
  process.exit(0);
}

if (command === "--help" || command === "-h" || !command) {
  printHelp();
  process.exit(0);
}

switch (command) {
  case "dev":
    dev().catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;

  case "build":
    buildApp().catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;

  case "start":
    start().catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;

  case "deploy":
    deployCommand().catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;

  case "init":
    initCommand().catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;

  case "check":
    check().catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;

  case "lint":
    lint().catch((e) => {
      console.error(e);
      process.exit(1);
    });
    break;

  default:
    console.error(`\n  Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
}
