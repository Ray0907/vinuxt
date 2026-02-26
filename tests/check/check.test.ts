import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	runCheck,
	formatReport,
	scanImports,
	analyzeConfig,
	checkModules,
	checkConventions,
} from "../../packages/vinuxt/src/check.js";

let tmp_dir: string;

beforeEach(() => {
	tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "vinuxt-check-test-"));
});

afterEach(() => {
	fs.rmSync(tmp_dir, { recursive: true, force: true });
});

describe("scanImports", () => {
	it("detects #imports usage", () => {
		fs.mkdirSync(path.join(tmp_dir, "composables"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp_dir, "composables", "use-data.ts"),
			`import { ref } from 'vue'\nimport { useAsyncData } from '#imports'\n`,
		);

		const items = scanImports(tmp_dir);
		const item_imports = items.find(i => i.name === "#imports");
		expect(item_imports).toBeDefined();
		expect(item_imports!.status).toBe("supported");
	});

	it("detects h3 as unsupported", () => {
		fs.mkdirSync(path.join(tmp_dir, "server", "api"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp_dir, "server", "api", "hello.ts"),
			`import { defineEventHandler } from 'h3'\n`,
		);

		const items = scanImports(tmp_dir);
		const item_h3 = items.find(i => i.name === "h3");
		expect(item_h3).toBeDefined();
		expect(item_h3!.status).toBe("unsupported");
	});

	it("detects @nuxt/kit as unsupported", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "module.ts"),
			`import { defineNuxtModule } from '@nuxt/kit'\n`,
		);

		const items = scanImports(tmp_dir);
		const item_kit = items.find(i => i.name === "@nuxt/kit");
		expect(item_kit).toBeDefined();
		expect(item_kit!.status).toBe("unsupported");
	});

	it("skips type-only imports", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "types.ts"),
			`import type { NuxtConfig } from 'nuxt'\n`,
		);

		const items = scanImports(tmp_dir);
		expect(items).toHaveLength(0);
	});

	it("skips node_modules", () => {
		fs.mkdirSync(path.join(tmp_dir, "node_modules", "some-pkg"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp_dir, "node_modules", "some-pkg", "index.ts"),
			`import { defineEventHandler } from 'h3'\n`,
		);

		const items = scanImports(tmp_dir);
		expect(items).toHaveLength(0);
	});

	it("returns empty for empty project", () => {
		const items = scanImports(tmp_dir);
		expect(items).toEqual([]);
	});
});

describe("analyzeConfig", () => {
	it("reports no config as supported", () => {
		const items = analyzeConfig(tmp_dir);
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe("nuxt.config");
		expect(items[0].status).toBe("supported");
	});

	it("detects supported config options", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "nuxt.config.ts"),
			`export default defineNuxtConfig({\n\tcss: ['~/assets/main.css'],\n\tssr: true,\n})\n`,
		);

		const items = analyzeConfig(tmp_dir);
		const item_css = items.find(i => i.name === "css");
		const item_ssr = items.find(i => i.name === "ssr");
		expect(item_css).toBeDefined();
		expect(item_css!.status).toBe("supported");
		expect(item_ssr).toBeDefined();
		expect(item_ssr!.status).toBe("supported");
	});

	it("detects unsupported config options", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "nuxt.config.ts"),
			`export default defineNuxtConfig({\n\tnitro: { preset: 'cloudflare' },\n\twebpack: {},\n})\n`,
		);

		const items = analyzeConfig(tmp_dir);
		const item_nitro = items.find(i => i.name === "nitro");
		const item_webpack = items.find(i => i.name === "webpack");
		expect(item_nitro).toBeDefined();
		expect(item_nitro!.status).toBe("unsupported");
		expect(item_webpack).toBeDefined();
		expect(item_webpack!.status).toBe("unsupported");
	});

	it("detects buildModules as unsupported", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "nuxt.config.ts"),
			`export default defineNuxtConfig({\n\tbuildModules: ['some-module'],\n})\n`,
		);

		const items = analyzeConfig(tmp_dir);
		const item = items.find(i => i.name === "buildModules");
		expect(item).toBeDefined();
		expect(item!.status).toBe("unsupported");
	});
});

describe("checkModules", () => {
	it("returns empty when no config", () => {
		const items = checkModules(tmp_dir);
		expect(items).toEqual([]);
	});

	it("detects supported modules", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "nuxt.config.ts"),
			`export default defineNuxtConfig({\n\tmodules: ['@nuxtjs/tailwindcss'],\n})\n`,
		);

		const items = checkModules(tmp_dir);
		const item = items.find(i => i.name === "@nuxtjs/tailwindcss");
		expect(item).toBeDefined();
		expect(item!.status).toBe("supported");
	});

	it("detects unsupported modules", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "nuxt.config.ts"),
			`export default defineNuxtConfig({\n\tmodules: ['@nuxt/content'],\n})\n`,
		);

		const items = checkModules(tmp_dir);
		const item = items.find(i => i.name === "@nuxt/content");
		expect(item).toBeDefined();
		expect(item!.status).toBe("unsupported");
	});

	it("detects modules from package.json dependencies", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "nuxt.config.ts"),
			`export default defineNuxtConfig({})\n`,
		);
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({
				dependencies: { "@pinia/nuxt": "^0.5.0" },
			}),
		);

		const items = checkModules(tmp_dir);
		const item = items.find(i => i.name === "@pinia/nuxt");
		expect(item).toBeDefined();
		expect(item!.status).toBe("partial");
	});
});

describe("checkConventions", () => {
	it("reports pages/ as supported", () => {
		fs.mkdirSync(path.join(tmp_dir, "pages"), { recursive: true });
		fs.writeFileSync(path.join(tmp_dir, "pages", "index.vue"), "<template><div>Hello</div></template>");

		const items = checkConventions(tmp_dir);
		const item = items.find(i => i.name.includes("Pages"));
		expect(item).toBeDefined();
		expect(item!.status).toBe("supported");
	});

	it("reports composables/ as supported", () => {
		fs.mkdirSync(path.join(tmp_dir, "composables"), { recursive: true });
		fs.writeFileSync(path.join(tmp_dir, "composables", "use-data.ts"), "export const useData = () => {}");

		const items = checkConventions(tmp_dir);
		const item = items.find(i => i.name.includes("Composables"));
		expect(item).toBeDefined();
		expect(item!.status).toBe("supported");
	});

	it("reports layouts/ as supported", () => {
		fs.mkdirSync(path.join(tmp_dir, "layouts"), { recursive: true });
		fs.writeFileSync(path.join(tmp_dir, "layouts", "default.vue"), "<template><slot /></template>");

		const items = checkConventions(tmp_dir);
		const item = items.find(i => i.name.includes("Layouts"));
		expect(item).toBeDefined();
		expect(item!.status).toBe("supported");
	});

	it("reports missing pages/ as unsupported", () => {
		const items = checkConventions(tmp_dir);
		const item = items.find(i => i.name.includes("No pages/"));
		expect(item).toBeDefined();
		expect(item!.status).toBe("unsupported");
	});

	it("reports missing type:module as unsupported", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test-app" }),
		);

		const items = checkConventions(tmp_dir);
		const item = items.find(i => i.name.includes('"type": "module"'));
		expect(item).toBeDefined();
		expect(item!.status).toBe("unsupported");
	});

	it("does not flag type:module when already present", () => {
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test-app", type: "module" }),
		);

		const items = checkConventions(tmp_dir);
		const item = items.find(i => i.name.includes('"type": "module"'));
		expect(item).toBeUndefined();
	});

	it("detects server/api routes", () => {
		fs.mkdirSync(path.join(tmp_dir, "server", "api"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp_dir, "server", "api", "hello.ts"),
			`export default defineEventHandler(() => 'Hello')`,
		);

		const items = checkConventions(tmp_dir);
		const item = items.find(i => i.name.includes("Server API"));
		expect(item).toBeDefined();
		expect(item!.status).toBe("supported");
	});

	it("detects server/utils as partial", () => {
		fs.mkdirSync(path.join(tmp_dir, "server", "utils"), { recursive: true });
		fs.writeFileSync(
			path.join(tmp_dir, "server", "utils", "db.ts"),
			`export const db = {}`,
		);

		const items = checkConventions(tmp_dir);
		const item = items.find(i => i.name.includes("Server utils"));
		expect(item).toBeDefined();
		expect(item!.status).toBe("partial");
	});
});

describe("runCheck", () => {
	it("produces a summary with scores", () => {
		fs.mkdirSync(path.join(tmp_dir, "pages"), { recursive: true });
		fs.writeFileSync(path.join(tmp_dir, "pages", "index.vue"), "<template><div /></template>");
		fs.writeFileSync(
			path.join(tmp_dir, "nuxt.config.ts"),
			`export default defineNuxtConfig({ css: ['~/main.css'] })\n`,
		);
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test", type: "module" }),
		);

		const result = runCheck(tmp_dir);
		expect(result.summary.total).toBeGreaterThan(0);
		expect(result.summary.score).toBeGreaterThanOrEqual(0);
		expect(result.summary.score).toBeLessThanOrEqual(100);
	});

	it("returns 100% for a perfectly compatible project", () => {
		fs.mkdirSync(path.join(tmp_dir, "pages"), { recursive: true });
		fs.writeFileSync(path.join(tmp_dir, "pages", "index.vue"), "<template><div /></template>");
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test", type: "module" }),
		);
		// No config file = defaults = fine

		const result = runCheck(tmp_dir);
		expect(result.summary.unsupported).toBe(0);
		expect(result.summary.score).toBe(100);
	});
});

describe("formatReport", () => {
	it("produces non-empty string", () => {
		fs.mkdirSync(path.join(tmp_dir, "pages"), { recursive: true });
		fs.writeFileSync(path.join(tmp_dir, "pages", "index.vue"), "<template><div /></template>");
		fs.writeFileSync(
			path.join(tmp_dir, "package.json"),
			JSON.stringify({ name: "test", type: "module" }),
		);

		const result = runCheck(tmp_dir);
		const report = formatReport(result);
		expect(report).toContain("vinuxt compatibility report");
		expect(report).toContain("Overall");
	});

	it("omits next-steps when called_from_init", () => {
		const result = runCheck(tmp_dir);
		const report = formatReport(result, { called_from_init: true });
		expect(report).not.toContain("Recommended next steps");
	});

	it("includes next-steps by default", () => {
		const result = runCheck(tmp_dir);
		const report = formatReport(result);
		expect(report).toContain("Recommended next steps");
	});
});
