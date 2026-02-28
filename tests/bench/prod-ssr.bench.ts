/**
 * Benchmark: production SSR throughput (vinuxt start vs nuxt preview)
 *
 * Builds both apps first, then measures req/s on the production servers.
 * This gives a fairer comparison than dev-mode benchmarks because it
 * removes dev-only overhead (HMR, module hot-reload, etc.).
 *
 * NOTE: vitest bench beforeAll doesn't work reliably with long async
 * setup, so we use lazy module-level servers that start on first iteration.
 */
import { describe, bench } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";

const FIXTURE_VINUXT = path.resolve(__dirname, "../fixtures/basic-app");
const FIXTURE_NUXT = path.resolve(__dirname, "../fixtures/basic-app-nuxt");
const CLI_PATH = path.resolve(
	FIXTURE_VINUXT,
	"../../../packages/vinuxt/src/cli.ts",
);

const PORT_VINUXT = 3492;
const PORT_NUXT = 3493;

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
	throw new Error(`Server did not start within ${timeout_ms}ms`);
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

// --- vinuxt production SSR ---------------------------------------------------

let vinuxt_server: ChildProcess | null = null;
let vinuxt_ready = false;

async function ensureVinuxtProdServer(): Promise<void> {
	if (vinuxt_ready) return;

	// Build
	spawnSync("npx", ["tsx", CLI_PATH, "build"], {
		cwd: FIXTURE_VINUXT,
		encoding: "utf-8",
		env: { ...process.env, NODE_ENV: "production" },
		timeout: 60_000,
	});

	// Start production server
	vinuxt_server = spawn(
		"npx",
		["tsx", CLI_PATH, "start", "--port", String(PORT_VINUXT)],
		{
			cwd: FIXTURE_VINUXT,
			stdio: "pipe",
			env: { ...process.env, NODE_ENV: "production" },
		},
	);
	await waitForServer(`http://localhost:${PORT_VINUXT}`);
	vinuxt_ready = true;
}

// --- Nuxt production SSR -----------------------------------------------------

let nuxt_server: ChildProcess | null = null;
let nuxt_ready = false;

async function ensureNuxtProdServer(): Promise<void> {
	if (nuxt_ready) return;

	// Build
	spawnSync("npx", ["nuxt", "build"], {
		cwd: FIXTURE_NUXT,
		encoding: "utf-8",
		env: { ...process.env, NODE_ENV: "production" },
		timeout: 120_000,
	});

	// Start production preview server
	nuxt_server = spawn(
		"npx",
		["nuxt", "preview", "--port", String(PORT_NUXT)],
		{
			cwd: FIXTURE_NUXT,
			stdio: "pipe",
			env: { ...process.env, NODE_ENV: "production" },
		},
	);
	await waitForServer(`http://localhost:${PORT_NUXT}`);
	nuxt_ready = true;
}

// Cleanup on exit
process.on("beforeExit", async () => {
	if (vinuxt_server) await killAndWait(vinuxt_server);
	if (nuxt_server) await killAndWait(nuxt_server);
});

// --- Benchmarks --------------------------------------------------------------

describe("vinuxt production SSR (warm)", () => {
	bench("GET /", async () => {
		await ensureVinuxtProdServer();
		const res = await fetch(`http://localhost:${PORT_VINUXT}/`);
		await res.text();
	});

	bench("GET /about", async () => {
		await ensureVinuxtProdServer();
		const res = await fetch(`http://localhost:${PORT_VINUXT}/about`);
		await res.text();
	});

	bench("GET /posts/1", async () => {
		await ensureVinuxtProdServer();
		const res = await fetch(`http://localhost:${PORT_VINUXT}/posts/1`);
		await res.text();
	});
});

describe("nuxt production SSR (warm)", () => {
	bench("GET /", async () => {
		await ensureNuxtProdServer();
		const res = await fetch(`http://localhost:${PORT_NUXT}/`);
		await res.text();
	});

	bench("GET /about", async () => {
		await ensureNuxtProdServer();
		const res = await fetch(`http://localhost:${PORT_NUXT}/about`);
		await res.text();
	});

	bench("GET /posts/1", async () => {
		await ensureNuxtProdServer();
		const res = await fetch(`http://localhost:${PORT_NUXT}/posts/1`);
		await res.text();
	});
});
