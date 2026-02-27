/**
 * Benchmark: vinuxt dev server cold start + SSR render performance
 *
 * Cold start -- spawn process, poll until first 200, measure wall time
 * SSR render -- after server is warm, bench individual route fetches
 */
import { describe, bench, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/basic-app");
const CLI_PATH = path.resolve(
	FIXTURE_DIR,
	"../../../packages/vinuxt/src/cli.ts",
);

// Separate ports to avoid collisions with tests and between suites
const PORT_COLD = 3488;
const PORT_WARM = 3489;

async function waitForServer(url: string, timeout_ms = 30_000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout_ms) {
		try {
			const res = await fetch(url);
			if (res.ok || res.status === 500) return;
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`Server did not start within ${timeout_ms}ms`);
}

function spawnDevServer(port: number): ChildProcess {
	return spawn("npx", ["tsx", CLI_PATH, "dev", "--port", String(port)], {
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

describe("cold start", () => {
	bench(
		"dev server startup",
		async () => {
			const proc = spawnDevServer(PORT_COLD);
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

describe("SSR render (warm)", () => {
	let server_process: ChildProcess;

	beforeAll(async () => {
		server_process = spawnDevServer(PORT_WARM);
		await waitForServer(`http://localhost:${PORT_WARM}`);
	}, 30_000);

	afterAll(async () => {
		if (server_process) await killAndWait(server_process);
	});

	bench("GET /", async () => {
		const res = await fetch(`http://localhost:${PORT_WARM}/`);
		await res.text();
	});

	bench("GET /about", async () => {
		const res = await fetch(`http://localhost:${PORT_WARM}/about`);
		await res.text();
	});

	bench("GET /posts/1", async () => {
		const res = await fetch(`http://localhost:${PORT_WARM}/posts/1`);
		await res.text();
	});
});
