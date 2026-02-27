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

  it("imports registerComponents from virtual:vinuxt-components", async () => {
    const plugins = vinuxt();
    const core = findCorePlugin(plugins) as any;
    const code = await core.load("\0virtual:vinuxt-server-entry");
    expect(code).toContain("registerComponents");
    expect(code).toContain("virtual:vinuxt-components");
  });

  it("creates and provides payload, returns it from createApp", async () => {
    const plugins = vinuxt();
    const core = findCorePlugin(plugins) as any;
    const code = await core.load("\0virtual:vinuxt-server-entry");
    expect(code).toContain("createPayload");
    expect(code).toContain("__vinuxt_payload__");
    expect(code).toContain("return { app, router, payload }");
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

  it("imports registerComponents from virtual:vinuxt-components", async () => {
    const plugins = vinuxt();
    const core = findCorePlugin(plugins) as any;
    const code = await core.load("\0virtual:vinuxt-client-entry");
    expect(code).toContain("registerComponents");
    expect(code).toContain("virtual:vinuxt-components");
  });

  it("imports middleware and installs router.beforeEach", async () => {
    const plugins = vinuxt();
    const core = findCorePlugin(plugins) as any;
    const code = await core.load("\0virtual:vinuxt-client-entry");
    expect(code).toContain("virtual:vinuxt-middleware");
    expect(code).toContain("middlewareMap");
    expect(code).toContain("globalMiddleware");
    expect(code).toContain("beforeEach");
  });

  it("hydrates payload from window.__VINUXT_DATA__", async () => {
    const plugins = vinuxt();
    const core = findCorePlugin(plugins) as any;
    const code = await core.load("\0virtual:vinuxt-client-entry");
    expect(code).toContain("hydratePayload");
    expect(code).toContain("__VINUXT_DATA__");
    expect(code).toContain("__vinuxt_payload__");
  });
});

describe("middleware virtual module", () => {
  it("generates empty middleware map when no middleware/ dir exists", async () => {
    const plugins = vinuxt();
    const core = findCorePlugin(plugins) as any;
    const code = await core.load("\0virtual:vinuxt-middleware");
    expect(code).toContain("middlewareMap");
    expect(code).toContain("globalMiddleware");
  });

  it("resolves virtual:vinuxt-middleware ID", () => {
    const plugins = vinuxt();
    const core = findCorePlugin(plugins) as any;
    expect(core.resolveId("virtual:vinuxt-middleware")).toBe(
      "\0virtual:vinuxt-middleware",
    );
  });
});
