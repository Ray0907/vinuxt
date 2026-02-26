import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	init,
	generateViteConfig,
	addScripts,
	ensureESModule,
	hasViteConfig,
	hasNuxtConfig,
	getInitDeps,
	isDepInstalled,
} from "../../packages/vinuxt/src/init.js";

let tmp_dir: string;

beforeEach(() => {
	tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "vinuxt-init-test-"));
});

afterEach(() => {
	fs.rmSync(tmp_dir, { recursive: true, force: true });
});

describe("generateViteConfig", () => {
	it("returns valid vite config with vinuxt plugin", () => {
		const config = generateViteConfig();
		expect(config).toContain('import vinuxt from "vinuxt"');
		expect(config).toContain('import { defineConfig } from "vite"');
		expect(config).toContain("plugins: [vinuxt()]");
	});

	it("uses tabs for indentation", () => {
		const config = generateViteConfig();
		expect(config).toContain("\tplugins:");
	});
});

describe("addScripts", () => {
	it("adds dev:vinuxt, build:vinuxt, start:vinuxt scripts", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test", scripts: {} }),
		);

		const added = addScripts(tmp_dir, 3001);
		expect(added).toContain("dev:vinuxt");
		expect(added).toContain("build:vinuxt");
		expect(added).toContain("start:vinuxt");

		const pkg = JSON.parse(fs.readFileSync(path.join(tmp_dir, "package.json"), "utf-8"));
		expect(pkg.scripts["dev:vinuxt"]).toBe("vinuxt dev --port 3001");
		expect(pkg.scripts["build:vinuxt"]).toBe("vinuxt build");
		expect(pkg.scripts["start:vinuxt"]).toBe("vinuxt start");
	});

	it("does not overwrite existing scripts", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({
				name: "test",
				scripts: { "dev:vinuxt": "custom command" },
			}),
		);

		const added = addScripts(tmp_dir, 3001);
		expect(added).not.toContain("dev:vinuxt");
		expect(added).toContain("build:vinuxt");

		const pkg = JSON.parse(fs.readFileSync(path.join(tmp_dir, "package.json"), "utf-8"));
		expect(pkg.scripts["dev:vinuxt"]).toBe("custom command");
	});

	it("creates scripts object if missing", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test" }),
		);

		const added = addScripts(tmp_dir, 4000);
		expect(added).toHaveLength(3);

		const pkg = JSON.parse(fs.readFileSync(path.join(tmp_dir, "package.json"), "utf-8"));
		expect(pkg.scripts["dev:vinuxt"]).toBe("vinuxt dev --port 4000");
	});

	it("returns empty array when no package.json", () => {
		const added = addScripts(tmp_dir, 3001);
		expect(added).toEqual([]);
	});

	it("uses custom port in dev script", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test", scripts: {} }),
		);

		addScripts(tmp_dir, 5000);
		const pkg = JSON.parse(fs.readFileSync(path.join(tmp_dir, "package.json"), "utf-8"));
		expect(pkg.scripts["dev:vinuxt"]).toBe("vinuxt dev --port 5000");
	});
});

describe("ensureESModule", () => {
	it("adds type:module when missing", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test" }),
		);

		const result = ensureESModule(tmp_dir);
		expect(result).toBe(true);

		const pkg = JSON.parse(fs.readFileSync(path.join(tmp_dir, "package.json"), "utf-8"));
		expect(pkg.type).toBe("module");
	});

	it("returns false when already present", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test", type: "module" }),
		);

		const result = ensureESModule(tmp_dir);
		expect(result).toBe(false);
	});

	it("returns false when no package.json", () => {
		const result = ensureESModule(tmp_dir);
		expect(result).toBe(false);
	});
});

describe("hasViteConfig", () => {
	it("returns false when no config exists", () => {
		expect(hasViteConfig(tmp_dir)).toBe(false);
	});

	it("detects vite.config.ts", () => {
		fs.writeFileSync(path.join(tmp_dir, "vite.config.ts"), "");
		expect(hasViteConfig(tmp_dir)).toBe(true);
	});

	it("detects vite.config.js", () => {
		fs.writeFileSync(path.join(tmp_dir, "vite.config.js"), "");
		expect(hasViteConfig(tmp_dir)).toBe(true);
	});
});

describe("hasNuxtConfig", () => {
	it("returns false when no config exists", () => {
		expect(hasNuxtConfig(tmp_dir)).toBe(false);
	});

	it("detects nuxt.config.ts", () => {
		fs.writeFileSync(path.join(tmp_dir, "nuxt.config.ts"), "");
		expect(hasNuxtConfig(tmp_dir)).toBe(true);
	});

	it("detects nuxt.config.js", () => {
		fs.writeFileSync(path.join(tmp_dir, "nuxt.config.js"), "");
		expect(hasNuxtConfig(tmp_dir)).toBe(true);
	});
});

describe("getInitDeps", () => {
	it("returns vinuxt and vite", () => {
		const deps = getInitDeps();
		expect(deps).toContain("vinuxt");
		expect(deps).toContain("vite");
	});
});

describe("isDepInstalled", () => {
	it("returns true when dep is in dependencies", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ dependencies: { vite: "^7.0.0" } }),
		);
		expect(isDepInstalled(tmp_dir, "vite")).toBe(true);
	});

	it("returns true when dep is in devDependencies", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ devDependencies: { vinuxt: "^0.1.0" } }),
		);
		expect(isDepInstalled(tmp_dir, "vinuxt")).toBe(true);
	});

	it("returns false when dep is not installed", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ dependencies: {} }),
		);
		expect(isDepInstalled(tmp_dir, "vinuxt")).toBe(false);
	});

	it("returns false when no package.json", () => {
		expect(isDepInstalled(tmp_dir, "vite")).toBe(false);
	});
});

describe("init", () => {
	it("generates vite.config.ts", async () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({
				name: "test-nuxt-app",
				devDependencies: { vinuxt: "^0.1.0", vite: "^7.0.0" },
			}),
		);
		fs.writeFileSync(path.join(tmp_dir, "nuxt.config.ts"), "export default defineNuxtConfig({})");

		const mock_exec = vi.fn();
		const result = await init({
			root: tmp_dir,
			skip_check: true,
			_exec: mock_exec,
		});

		expect(result.generated_vite_config).toBe(true);
		expect(fs.existsSync(path.join(tmp_dir, "vite.config.ts"))).toBe(true);

		const config = fs.readFileSync(path.join(tmp_dir, "vite.config.ts"), "utf-8");
		expect(config).toContain("vinuxt()");
	});

	it("adds type:module to package.json", async () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({
				name: "test-nuxt-app",
				devDependencies: { vinuxt: "^0.1.0", vite: "^7.0.0" },
			}),
		);

		const mock_exec = vi.fn();
		const result = await init({
			root: tmp_dir,
			skip_check: true,
			_exec: mock_exec,
		});

		expect(result.added_type_module).toBe(true);
		const pkg = JSON.parse(fs.readFileSync(path.join(tmp_dir, "package.json"), "utf-8"));
		expect(pkg.type).toBe("module");
	});

	it("adds scripts to package.json", async () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({
				name: "test-nuxt-app",
				type: "module",
				devDependencies: { vinuxt: "^0.1.0", vite: "^7.0.0" },
			}),
		);

		const mock_exec = vi.fn();
		const result = await init({
			root: tmp_dir,
			skip_check: true,
			_exec: mock_exec,
		});

		expect(result.added_scripts).toContain("dev:vinuxt");
		expect(result.added_scripts).toContain("build:vinuxt");
		expect(result.added_scripts).toContain("start:vinuxt");
	});

	it("installs missing dependencies", async () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test-nuxt-app" }),
		);

		const mock_exec = vi.fn();
		const result = await init({
			root: tmp_dir,
			skip_check: true,
			_exec: mock_exec,
		});

		expect(result.installed_deps).toContain("vinuxt");
		expect(result.installed_deps).toContain("vite");
		expect(mock_exec).toHaveBeenCalledWith(
			"pnpm",
			["add", "-D", "vinuxt", "vite"],
			expect.objectContaining({ cwd: expect.any(String) }),
		);
	});

	it("skips already installed dependencies", async () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({
				name: "test-nuxt-app",
				devDependencies: { vinuxt: "^0.1.0", vite: "^7.0.0" },
			}),
		);

		const mock_exec = vi.fn();
		const result = await init({
			root: tmp_dir,
			skip_check: true,
			_exec: mock_exec,
		});

		expect(result.installed_deps).toHaveLength(0);
		expect(mock_exec).not.toHaveBeenCalled();
	});

	it("skips vite.config.ts when already exists", async () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({
				name: "test-nuxt-app",
				type: "module",
				devDependencies: { vinuxt: "^0.1.0", vite: "^7.0.0" },
			}),
		);
		fs.writeFileSync(path.join(tmp_dir, "vite.config.ts"), "// existing config\n");

		const mock_exec = vi.fn();
		const result = await init({
			root: tmp_dir,
			skip_check: true,
			_exec: mock_exec,
		});

		expect(result.skipped_vite_config).toBe(true);
		expect(result.generated_vite_config).toBe(false);

		const config = fs.readFileSync(path.join(tmp_dir, "vite.config.ts"), "utf-8");
		expect(config).toBe("// existing config\n");
	});

	it("overwrites vite.config.ts with --force", async () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({
				name: "test-nuxt-app",
				type: "module",
				devDependencies: { vinuxt: "^0.1.0", vite: "^7.0.0" },
			}),
		);
		fs.writeFileSync(path.join(tmp_dir, "vite.config.ts"), "// old config\n");

		const mock_exec = vi.fn();
		const result = await init({
			root: tmp_dir,
			skip_check: true,
			force: true,
			_exec: mock_exec,
		});

		expect(result.generated_vite_config).toBe(true);
		expect(result.skipped_vite_config).toBe(false);

		const config = fs.readFileSync(path.join(tmp_dir, "vite.config.ts"), "utf-8");
		expect(config).toContain("vinuxt()");
	});

	it("uses custom port", async () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({
				name: "test-nuxt-app",
				type: "module",
				devDependencies: { vinuxt: "^0.1.0", vite: "^7.0.0" },
			}),
		);

		const mock_exec = vi.fn();
		await init({
			root: tmp_dir,
			port: 4000,
			skip_check: true,
			_exec: mock_exec,
		});

		const pkg = JSON.parse(fs.readFileSync(path.join(tmp_dir, "package.json"), "utf-8"));
		expect(pkg.scripts["dev:vinuxt"]).toBe("vinuxt dev --port 4000");
	});
});
