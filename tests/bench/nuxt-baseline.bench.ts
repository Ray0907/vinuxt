/**
 * Benchmark: Nuxt baseline -- cold start, SSR render, and production build
 *
 * Identical routes and pages as the vinuxt benchmarks so the numbers are
 * directly comparable. Spawns stock `npx nuxt dev` / `npx nuxt build`.
 */
import { describe, bench } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";

const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/basic-app-nuxt");

const PORT_COLD = 3490;
const PORT_WARM = 3491;

async function waitForServer(url: string, timeout_ms = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout_ms) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Nuxt server did not start within ${timeout_ms}ms`);
}

function spawnNuxtDev(port: number): ChildProcess {
  return spawn("npx", ["nuxt", "dev", "--port", String(port)], {
    cwd: FIXTURE_DIR,
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "development" },
  });
}

async function killAndWait(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve();
      return;
    }
    proc.on("exit", () => resolve());
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }, 5_000);
  });
}

// --- Cold start: spawn -> first 200 -> kill --------------------------------

describe("nuxt cold start", () => {
  bench(
    "dev server startup",
    async () => {
      const proc = spawnNuxtDev(PORT_COLD);
      try {
        await waitForServer(`http://localhost:${PORT_COLD}`);
      } finally {
        await killAndWait(proc);
      }
    },
    { iterations: 3, warmupIterations: 0, time: 0 },
  );
});

// --- SSR render on warm server ---------------------------------------------
// NOTE: vitest bench beforeAll doesn't work reliably with Nuxt's async startup,
// so we use a lazy module-level server that starts on first bench iteration.

let warm_server: ChildProcess | null = null;
let warm_ready = false;

async function ensureWarmServer(): Promise<void> {
  if (warm_ready) return;
  warm_server = spawnNuxtDev(PORT_WARM);
  await waitForServer(`http://localhost:${PORT_WARM}`);
  warm_ready = true;
}

process.on("beforeExit", async () => {
  if (warm_server) await killAndWait(warm_server);
});

describe("nuxt SSR render (warm)", () => {
  bench("GET /", async () => {
    await ensureWarmServer();
    const res = await fetch(`http://localhost:${PORT_WARM}/`);
    await res.text();
  });

  bench("GET /about", async () => {
    await ensureWarmServer();
    const res = await fetch(`http://localhost:${PORT_WARM}/about`);
    await res.text();
  });

  bench("GET /posts/1", async () => {
    await ensureWarmServer();
    const res = await fetch(`http://localhost:${PORT_WARM}/posts/1`);
    await res.text();
  });
});

// --- Production build ------------------------------------------------------

describe("nuxt production build", () => {
  bench(
    "full build",
    () => {
      const result = spawnSync("npx", ["nuxt", "build"], {
        cwd: FIXTURE_DIR,
        encoding: "utf-8",
        env: { ...process.env, NODE_ENV: "production" },
        timeout: 120_000,
      });

      const output = (result.stdout ?? "") + (result.stderr ?? "");

      // Nuxt/Nitro prints timing info -- capture what we can
      const match_total = output.match(
        /Nitro built in (\d+[\.,]?\d*)\s*(ms|s)/i,
      );
      if (match_total) {
        console.log(`  Nitro build: ${match_total[1]}${match_total[2]}`);
      }
    },
    { iterations: 3, warmupIterations: 0, time: 0 },
  );
});
