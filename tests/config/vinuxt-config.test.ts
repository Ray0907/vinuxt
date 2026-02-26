import { describe, it, expect } from "vitest";
import { loadVinuxtConfig, defineVinuxtConfig, defineNuxtConfig } from "../../packages/vinuxt/src/config/vinuxt-config.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "vinuxt-cfg-"));
}

describe("defineVinuxtConfig", () => {
	it("is an identity function", () => {
		const input = { ssr: false };
		expect(defineVinuxtConfig(input)).toBe(input);
	});
});

describe("defineNuxtConfig", () => {
	it("is an alias for defineVinuxtConfig", () => {
		const input = { ssr: false };
		expect(defineNuxtConfig(input)).toBe(input);
	});
});

describe("loadVinuxtConfig", () => {
	it("returns defaults when no config file exists", async () => {
		const tmp = makeTmpDir();
		const config = await loadVinuxtConfig(tmp);
		expect(config.ssr).toBe(true);
		expect(config.runtimeConfig).toEqual({ public: {} });
		expect(config.routeRules).toEqual({});
		expect(config.app.baseURL).toBe("/");
		expect(config.imports.dirs).toEqual(["composables", "utils"]);
		expect(config.components.dirs).toEqual(["components"]);
		fs.rmSync(tmp, { recursive: true });
	});

	it("loads vinuxt.config.ts with export default", async () => {
		const tmp = makeTmpDir();
		fs.writeFileSync(
			path.join(tmp, "vinuxt.config.ts"),
			"export default { ssr: false, runtimeConfig: { public: { apiBase: '/api' } } };",
		);
		const config = await loadVinuxtConfig(tmp);
		expect(config.ssr).toBe(false);
		expect(config.runtimeConfig.public.apiBase).toBe("/api");
		fs.rmSync(tmp, { recursive: true });
	});

	it("falls back to nuxt.config.ts for migration", async () => {
		const tmp = makeTmpDir();
		fs.writeFileSync(
			path.join(tmp, "nuxt.config.ts"),
			"export default { ssr: false };",
		);
		const config = await loadVinuxtConfig(tmp);
		expect(config.ssr).toBe(false);
		fs.rmSync(tmp, { recursive: true });
	});

	it("prefers vinuxt.config.ts over nuxt.config.ts", async () => {
		const tmp = makeTmpDir();
		fs.writeFileSync(path.join(tmp, "vinuxt.config.ts"), "export default { app: { baseURL: '/vinuxt' } };");
		fs.writeFileSync(path.join(tmp, "nuxt.config.ts"), "export default { app: { baseURL: '/nuxt' } };");
		const config = await loadVinuxtConfig(tmp);
		expect(config.app.baseURL).toBe("/vinuxt");
		fs.rmSync(tmp, { recursive: true });
	});

	it("deep merges runtimeConfig.public with defaults", async () => {
		const tmp = makeTmpDir();
		fs.writeFileSync(
			path.join(tmp, "vinuxt.config.ts"),
			"export default { runtimeConfig: { secret: 'xxx', public: { apiBase: '/api' } } };",
		);
		const config = await loadVinuxtConfig(tmp);
		expect(config.runtimeConfig.secret).toBe("xxx");
		expect(config.runtimeConfig.public.apiBase).toBe("/api");
		fs.rmSync(tmp, { recursive: true });
	});
});
