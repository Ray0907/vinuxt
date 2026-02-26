import { describe, it, expect } from "vitest";
import vinuxt from "../../packages/vinuxt/src/index.js";

function findCorePlugin(plugins: any[]) {
	return plugins.find((p: any) => p.name === "vinuxt:core");
}

describe("server entry virtual module", () => {
	it("generates code that exports createApp", async () => {
		const plugins = vinuxt();
		const core = findCorePlugin(plugins) as any;
		const code = await core.load("\0virtual:vinuxt-server-entry");
		expect(code).toContain("createApp");
		expect(code).toContain("createSSRApp");
		expect(code).toContain("createMemoryHistory");
		expect(code).toContain("virtual:vinuxt-routes");
	});
});

describe("client entry virtual module", () => {
	it("generates code that mounts app", async () => {
		const plugins = vinuxt();
		const core = findCorePlugin(plugins) as any;
		const code = await core.load("\0virtual:vinuxt-client-entry");
		expect(code).toContain("createSSRApp");
		expect(code).toContain("createWebHistory");
		expect(code).toContain("__VINUXT_DATA__");
		expect(code).toContain('mount("#__nuxt")');
	});
});
