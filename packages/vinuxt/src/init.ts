/**
 * vinuxt init -- one-command project migration for Nuxt apps.
 *
 * Automates the steps needed to run a Nuxt app under vinuxt:
 *
 *   1. Detect if nuxt.config.ts (or .js) exists in the project
 *   2. Install vinuxt + vite dependencies via pnpm
 *   3. Add "type": "module" to package.json if not present
 *   4. Generate vite.config.ts with vinuxt() plugin
 *   5. Add scripts to package.json: dev:vinuxt, build:vinuxt, start:vinuxt
 *   6. Print summary of what was changed
 *
 * Non-destructive: does NOT modify nuxt.config, tsconfig, or source files.
 * The project should work with both Nuxt and vinuxt simultaneously.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runCheck, formatReport } from "./check.js";

// -- Types --------------------------------------------------------------------

export interface InitOptions {
  /** Project root directory */
  root: string;
  /** Dev server port (default: 3001) */
  port?: number;
  /** Skip the compatibility check step */
  skip_check?: boolean;
  /** Force overwrite even if vite.config.ts exists */
  force?: boolean;
  /**
   * @internal -- override exec for testing.
   * Uses execFileSync (array args) to prevent shell injection.
   */
  _exec?: (
    cmd: string,
    args: string[],
    opts: { cwd: string; stdio: string },
  ) => void;
}

export interface InitResult {
  /** Dependencies that were installed */
  installed_deps: string[];
  /** Whether "type": "module" was added */
  added_type_module: boolean;
  /** Scripts added to package.json */
  added_scripts: string[];
  /** Whether vite.config.ts was generated */
  generated_vite_config: boolean;
  /** Whether vite.config.ts generation was skipped (already exists) */
  skipped_vite_config: boolean;
}

// -- Vite Config Generation ---------------------------------------------------

export function generateViteConfig(): string {
  return `import vinuxt from "@raytien/vinuxt";
import { defineConfig } from "vite";

export default defineConfig({
\tplugins: [vinuxt()],
});
`;
}

// -- Script Addition ----------------------------------------------------------

/**
 * Add vinuxt scripts to package.json without overwriting existing scripts.
 * Returns the list of script names that were added.
 */
export function addScripts(root: string, port: number): string[] {
  const path_pkg = path.join(root, "package.json");
  if (!fs.existsSync(path_pkg)) return [];

  try {
    const raw = fs.readFileSync(path_pkg, "utf-8");
    const pkg = JSON.parse(raw);

    if (!pkg.scripts) {
      pkg.scripts = {};
    }

    const added: string[] = [];

    if (!pkg.scripts["dev:vinuxt"]) {
      pkg.scripts["dev:vinuxt"] = `vinuxt dev --port ${port}`;
      added.push("dev:vinuxt");
    }

    if (!pkg.scripts["build:vinuxt"]) {
      pkg.scripts["build:vinuxt"] = "vinuxt build";
      added.push("build:vinuxt");
    }

    if (!pkg.scripts["start:vinuxt"]) {
      pkg.scripts["start:vinuxt"] = "vinuxt start";
      added.push("start:vinuxt");
    }

    if (added.length > 0) {
      fs.writeFileSync(path_pkg, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    }

    return added;
  } catch {
    return [];
  }
}

// -- ESM Helpers --------------------------------------------------------------

/**
 * Add "type": "module" to package.json if missing. Returns true if added.
 */
export function ensureESModule(root: string): boolean {
  const path_pkg = path.join(root, "package.json");
  if (!fs.existsSync(path_pkg)) return false;

  try {
    const raw = fs.readFileSync(path_pkg, "utf-8");
    const pkg = JSON.parse(raw);
    if (pkg.type === "module") return false;

    pkg.type = "module";
    fs.writeFileSync(path_pkg, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a vite.config file already exists.
 */
export function hasViteConfig(root: string): boolean {
  return (
    fs.existsSync(path.join(root, "vite.config.ts")) ||
    fs.existsSync(path.join(root, "vite.config.js")) ||
    fs.existsSync(path.join(root, "vite.config.mjs"))
  );
}

/**
 * Check if a nuxt.config file exists.
 */
export function hasNuxtConfig(root: string): boolean {
  return (
    fs.existsSync(path.join(root, "nuxt.config.ts")) ||
    fs.existsSync(path.join(root, "nuxt.config.js")) ||
    fs.existsSync(path.join(root, "nuxt.config.mjs"))
  );
}

// -- Dependency Installation --------------------------------------------------

export function getInitDeps(): string[] {
  return ["@raytien/vinuxt", "vite"];
}

export function isDepInstalled(root: string, dep: string): boolean {
  const path_pkg = path.join(root, "package.json");
  if (!fs.existsSync(path_pkg)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path_pkg, "utf-8"));
    const deps_all = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    return dep in deps_all;
  } catch {
    return false;
  }
}

/**
 * Install dependencies using execFileSync with array arguments
 * (safe from shell injection).
 */
function installDeps(
  root: string,
  deps: string[],
  exec: (
    cmd: string,
    args: string[],
    opts: { cwd: string; stdio: string },
  ) => void,
): void {
  if (deps.length === 0) return;
  exec("pnpm", ["add", "-D", ...deps], { cwd: root, stdio: "inherit" });
}

// -- Main Entry ---------------------------------------------------------------

export async function init(options: InitOptions): Promise<InitResult> {
  const root = path.resolve(options.root);
  const port = options.port ?? 3001;
  const exec =
    options._exec ??
    ((cmd: string, args: string[], opts: { cwd: string; stdio: string }) => {
      execFileSync(
        cmd,
        args,
        opts as Record<string, unknown> as Parameters<typeof execFileSync>[2],
      );
    });

  // -- Pre-flight checks ----------------------------------------------------

  const path_pkg = path.join(root, "package.json");
  if (!fs.existsSync(path_pkg)) {
    console.error("  Error: No package.json found in the current directory.");
    console.error("  Run this command from the root of a Nuxt project.\n");
    process.exit(1);
  }

  if (!hasNuxtConfig(root)) {
    console.log("  Warning: No nuxt.config.ts or nuxt.config.js found.");
    console.log(
      "  Proceeding anyway -- vinuxt can work without a Nuxt config.\n",
    );
  }

  const config_vite_exists = hasViteConfig(root);

  // -- Step 1: Compatibility check ------------------------------------------

  if (!options.skip_check) {
    console.log("  Running compatibility check...\n");
    const result_check = runCheck(root);
    console.log(formatReport(result_check, { called_from_init: true }));
    console.log(); // blank line before migration steps
  }

  // -- Step 2: Install dependencies -----------------------------------------

  const deps_needed = getInitDeps();
  const deps_missing = deps_needed.filter((dep) => !isDepInstalled(root, dep));

  if (deps_missing.length > 0) {
    console.log(`  Installing ${deps_missing.join(", ")}...`);
    installDeps(root, deps_missing, exec);
    console.log();
  }

  // -- Step 3: Add "type": "module" -----------------------------------------

  const added_type_module = ensureESModule(root);

  // -- Step 4: Add scripts --------------------------------------------------

  const added_scripts = addScripts(root, port);

  // -- Step 5: Generate vite.config.ts --------------------------------------

  let generated_vite_config = false;
  const skipped_vite_config = config_vite_exists && !options.force;
  if (!skipped_vite_config) {
    const config_content = generateViteConfig();
    fs.writeFileSync(
      path.join(root, "vite.config.ts"),
      config_content,
      "utf-8",
    );
    generated_vite_config = true;
  }

  // -- Step 6: Print summary ------------------------------------------------

  console.log("  vinuxt init complete!\n");

  if (deps_missing.length > 0) {
    console.log(
      `    \u2713 Added ${deps_missing.join(", ")} to devDependencies`,
    );
  }
  if (added_type_module) {
    console.log(`    \u2713 Added "type": "module" to package.json`);
  }
  for (const script of added_scripts) {
    console.log(`    \u2713 Added ${script} script`);
  }
  if (generated_vite_config) {
    console.log(`    \u2713 Generated vite.config.ts`);
  }
  if (skipped_vite_config) {
    console.log(
      `    - Skipped vite.config.ts (already exists, use --force to overwrite)`,
    );
  }

  console.log(`
  Next steps:
    pnpm run dev:vinuxt    Start the vinuxt dev server
    pnpm run dev           Start Nuxt (still works as before)
`);

  return {
    installed_deps: deps_missing,
    added_type_module,
    added_scripts,
    generated_vite_config,
    skipped_vite_config,
  };
}
