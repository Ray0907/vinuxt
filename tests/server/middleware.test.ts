import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	scanMiddleware,
	scanServerMiddleware,
	type MiddlewareEntry,
} from "../../packages/vinuxt/src/server/middleware.js";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

describe("scanMiddleware (route middleware)", () => {
	let dir_tmp: string;

	beforeEach(async () => {
		dir_tmp = await fs.mkdtemp(
			path.join(os.tmpdir(), "vinuxt-middleware-test-"),
		);
	});

	afterEach(async () => {
		await fs.rm(dir_tmp, { recursive: true, force: true });
	});

	it("scans middleware/ directory and returns named entries", async () => {
		const dir_middleware = path.join(dir_tmp, "middleware");
		await fs.mkdir(dir_middleware, { recursive: true });
		await fs.writeFile(
			path.join(dir_middleware, "auth.ts"),
			"export default () => {}",
		);

		const entries = await scanMiddleware(dir_tmp);
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe("auth");
		expect(entries[0].global).toBe(false);
		expect(entries[0].file_path).toBe(
			path.join(dir_middleware, "auth.ts"),
		);
	});

	it("detects global middleware via .global.ts suffix", async () => {
		const dir_middleware = path.join(dir_tmp, "middleware");
		await fs.mkdir(dir_middleware, { recursive: true });
		await fs.writeFile(
			path.join(dir_middleware, "auth.global.ts"),
			"export default () => {}",
		);

		const entries = await scanMiddleware(dir_tmp);
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe("auth");
		expect(entries[0].global).toBe(true);
	});

	it("handles multiple middleware files", async () => {
		const dir_middleware = path.join(dir_tmp, "middleware");
		await fs.mkdir(dir_middleware, { recursive: true });
		await fs.writeFile(
			path.join(dir_middleware, "auth.ts"),
			"export default () => {}",
		);
		await fs.writeFile(
			path.join(dir_middleware, "log.global.ts"),
			"export default () => {}",
		);
		await fs.writeFile(
			path.join(dir_middleware, "admin.ts"),
			"export default () => {}",
		);

		const entries = await scanMiddleware(dir_tmp);
		expect(entries).toHaveLength(3);

		const entry_auth = entries.find((e) => e.name === "auth");
		const entry_log = entries.find((e) => e.name === "log");
		const entry_admin = entries.find((e) => e.name === "admin");

		expect(entry_auth).toBeDefined();
		expect(entry_auth!.global).toBe(false);
		expect(entry_log).toBeDefined();
		expect(entry_log!.global).toBe(true);
		expect(entry_admin).toBeDefined();
		expect(entry_admin!.global).toBe(false);
	});

	it("returns empty array when middleware/ does not exist", async () => {
		const entries = await scanMiddleware(dir_tmp);
		expect(entries).toEqual([]);
	});

	it("handles .js extensions", async () => {
		const dir_middleware = path.join(dir_tmp, "middleware");
		await fs.mkdir(dir_middleware, { recursive: true });
		await fs.writeFile(
			path.join(dir_middleware, "auth.global.js"),
			"export default () => {}",
		);

		const entries = await scanMiddleware(dir_tmp);
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe("auth");
		expect(entries[0].global).toBe(true);
	});

	it("ignores non ts/js files", async () => {
		const dir_middleware = path.join(dir_tmp, "middleware");
		await fs.mkdir(dir_middleware, { recursive: true });
		await fs.writeFile(
			path.join(dir_middleware, "auth.ts"),
			"export default () => {}",
		);
		await fs.writeFile(
			path.join(dir_middleware, "README.md"),
			"# Middleware docs",
		);

		const entries = await scanMiddleware(dir_tmp);
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe("auth");
	});
});

describe("scanServerMiddleware", () => {
	let dir_tmp: string;

	beforeEach(async () => {
		dir_tmp = await fs.mkdtemp(
			path.join(os.tmpdir(), "vinuxt-server-mw-test-"),
		);
	});

	afterEach(async () => {
		await fs.rm(dir_tmp, { recursive: true, force: true });
	});

	it("scans server/middleware/ directory", async () => {
		const dir_server_mw = path.join(dir_tmp, "server", "middleware");
		await fs.mkdir(dir_server_mw, { recursive: true });
		await fs.writeFile(
			path.join(dir_server_mw, "cors.ts"),
			"export default () => {}",
		);

		const entries = await scanServerMiddleware(dir_tmp);
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe("cors");
		expect(entries[0].global).toBe(false);
		expect(entries[0].file_path).toBe(
			path.join(dir_server_mw, "cors.ts"),
		);
	});

	it("detects global server middleware via .global.ts suffix", async () => {
		const dir_server_mw = path.join(dir_tmp, "server", "middleware");
		await fs.mkdir(dir_server_mw, { recursive: true });
		await fs.writeFile(
			path.join(dir_server_mw, "log.global.ts"),
			"export default () => {}",
		);

		const entries = await scanServerMiddleware(dir_tmp);
		expect(entries).toHaveLength(1);
		expect(entries[0].name).toBe("log");
		expect(entries[0].global).toBe(true);
	});

	it("returns empty array when server/middleware/ does not exist", async () => {
		const entries = await scanServerMiddleware(dir_tmp);
		expect(entries).toEqual([]);
	});

	it("handles multiple server middleware files", async () => {
		const dir_server_mw = path.join(dir_tmp, "server", "middleware");
		await fs.mkdir(dir_server_mw, { recursive: true });
		await fs.writeFile(
			path.join(dir_server_mw, "cors.ts"),
			"export default () => {}",
		);
		await fs.writeFile(
			path.join(dir_server_mw, "log.global.ts"),
			"export default () => {}",
		);

		const entries = await scanServerMiddleware(dir_tmp);
		expect(entries).toHaveLength(2);

		const entry_cors = entries.find((e) => e.name === "cors");
		const entry_log = entries.find((e) => e.name === "log");

		expect(entry_cors).toBeDefined();
		expect(entry_cors!.global).toBe(false);
		expect(entry_log).toBeDefined();
		expect(entry_log!.global).toBe(true);
	});
});
