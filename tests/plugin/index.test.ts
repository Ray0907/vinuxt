import { describe, it, expect } from "vitest";
import vinuxt, { clientOutputConfig, clientTreeshakeConfig } from "../../packages/vinuxt/src/index.js";

describe("vinuxt plugin", () => {
	it("returns an array of Vite plugins", () => {
		const plugins = vinuxt();
		expect(Array.isArray(plugins)).toBe(true);
		expect(plugins.length).toBeGreaterThan(0);
	});

	it("has vinuxt:core as first plugin", () => {
		const plugins = vinuxt();
		expect(plugins[0].name).toBe("vinuxt:core");
	});

	it("resolves virtual:vinuxt-* module IDs", () => {
		const plugins = vinuxt();
		const core = plugins[0] as any;

		expect(core.resolveId("virtual:vinuxt-client-entry"))
			.toBe("\0virtual:vinuxt-client-entry");
		expect(core.resolveId("virtual:vinuxt-server-entry"))
			.toBe("\0virtual:vinuxt-server-entry");
		expect(core.resolveId("virtual:vinuxt-app"))
			.toBe("\0virtual:vinuxt-app");
		expect(core.resolveId("virtual:vinuxt-routes"))
			.toBe("\0virtual:vinuxt-routes");
		expect(core.resolveId("virtual:vinuxt-imports"))
			.toBe("\0virtual:vinuxt-imports");
	});

	it("does not resolve non-vinuxt virtual modules", () => {
		const plugins = vinuxt();
		const core = plugins[0] as any;
		expect(core.resolveId("virtual:other-thing")).toBeUndefined();
		expect(core.resolveId("./some-file.ts")).toBeUndefined();
	});

	it("loads virtual modules with valid code", async () => {
		const plugins = vinuxt();
		const core = plugins[0] as any;

		const appCode = await core.load("\0virtual:vinuxt-app");
		expect(appCode).toContain("RouterView");

		const clientCode = await core.load("\0virtual:vinuxt-client-entry");
		expect(typeof clientCode).toBe("string");

		const serverCode = await core.load("\0virtual:vinuxt-server-entry");
		expect(typeof serverCode).toBe("string");
	});

	it("exports clientOutputConfig with manualChunks", () => {
		expect(typeof clientOutputConfig.manualChunks).toBe("function");
		expect(clientOutputConfig.manualChunks("node_modules/vue/dist/vue.js"))
			.toBe("framework");
		expect(clientOutputConfig.manualChunks("node_modules/vue-router/dist/index.js"))
			.toBe("framework");
		expect(clientOutputConfig.manualChunks("src/pages/index.vue"))
			.toBeUndefined();
	});

	it("exports clientTreeshakeConfig", () => {
		expect(clientTreeshakeConfig.preset).toBe("recommended");
	});
});
