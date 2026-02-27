/**
 * Integration test: start vinuxt dev server on the basic-app fixture
 * and verify SSR output for various routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/basic-app");
const PORT = 3477; // unusual port to avoid collisions
const BASE_URL = `http://localhost:${PORT}`;

let server_process: ChildProcess | null = null;

async function waitForServer(url: string, timeout_ms = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout_ms) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 500) return; // server is up
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not start within ${timeout_ms}ms`);
}

beforeAll(async () => {
  server_process = spawn(
    "npx",
    [
      "tsx",
      path.resolve(FIXTURE_DIR, "../../../packages/vinuxt/src/cli.ts"),
      "dev",
      "--port",
      String(PORT),
    ],
    {
      cwd: FIXTURE_DIR,
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "development" },
    },
  );

  // Log server errors for debugging
  server_process.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("Error") && !text.includes("ExperimentalWarning")) {
      console.error("[dev-server stderr]", text);
    }
  });

  await waitForServer(BASE_URL);
}, 20000);

afterAll(() => {
  if (server_process) {
    server_process.kill("SIGTERM");
    server_process = null;
  }
});

describe("vinuxt dev server integration", () => {
  it("serves the home page with SSR content", async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toMatch(/<h1[^>]*>Vinuxt Works!<\/h1>/);
    expect(html).toContain('id="__nuxt"');
    expect(html).toContain("__VINUXT_DATA__");
  });

  it("serves the about page", async () => {
    const res = await fetch(`${BASE_URL}/about`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toMatch(/<h1[^>]*>About Page<\/h1>/);
    expect(html).toContain("Built with Vinuxt");
  });

  it("serves dynamic route /posts/42", async () => {
    const res = await fetch(`${BASE_URL}/posts/42`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("Post");
    expect(html).toContain("dynamic route");
  });

  it("returns HTML with Vite HMR client script", async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();
    expect(html).toContain("/@vite/client");
  });

  it("returns proper DOCTYPE and structure", async () => {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("<body");
  });
});
