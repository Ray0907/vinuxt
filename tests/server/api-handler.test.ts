import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	defineEventHandler,
	scanApiRoutes,
	filePathToRoutePattern,
	extractHttpMethod,
	type ApiRoute,
} from "../../packages/vinuxt/src/server/api-handler.js";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

describe("defineEventHandler", () => {
	it("returns the handler function as-is (identity wrapper)", () => {
		const handler = () => ({ message: "hello" });
		const wrapped = defineEventHandler(handler);
		expect(wrapped).toBe(handler);
	});

	it("works with async handlers", () => {
		const handler = async () => ({ message: "hello" });
		const wrapped = defineEventHandler(handler);
		expect(wrapped).toBe(handler);
	});
});

describe("extractHttpMethod", () => {
	it("extracts GET method from filename", () => {
		expect(extractHttpMethod("users.get.ts")).toBe("get");
	});

	it("extracts POST method from filename", () => {
		expect(extractHttpMethod("users.post.ts")).toBe("post");
	});

	it("extracts PUT method from filename", () => {
		expect(extractHttpMethod("users.put.ts")).toBe("put");
	});

	it("extracts DELETE method from filename", () => {
		expect(extractHttpMethod("users.delete.ts")).toBe("delete");
	});

	it("extracts PATCH method from filename", () => {
		expect(extractHttpMethod("users.patch.ts")).toBe("patch");
	});

	it("returns null for filenames without method suffix", () => {
		expect(extractHttpMethod("users.ts")).toBeNull();
	});

	it("returns null for index files", () => {
		expect(extractHttpMethod("index.ts")).toBeNull();
	});

	it("handles .js extensions", () => {
		expect(extractHttpMethod("users.get.js")).toBe("get");
	});
});

describe("filePathToRoutePattern", () => {
	it("maps api file to /api/ route", () => {
		expect(filePathToRoutePattern("server/api/users.ts", "api")).toBe(
			"/api/users",
		);
	});

	it("maps nested api file to nested route", () => {
		expect(
			filePathToRoutePattern("server/api/users/profile.ts", "api"),
		).toBe("/api/users/profile");
	});

	it("maps index file to parent route", () => {
		expect(filePathToRoutePattern("server/api/users/index.ts", "api")).toBe(
			"/api/users",
		);
	});

	it("converts bracket params to :param syntax", () => {
		expect(
			filePathToRoutePattern("server/api/users/[id].ts", "api"),
		).toBe("/api/users/:id");
	});

	it("converts nested bracket params", () => {
		expect(
			filePathToRoutePattern(
				"server/api/users/[id]/posts/[postId].ts",
				"api",
			),
		).toBe("/api/users/:id/posts/:postId");
	});

	it("converts catch-all params", () => {
		expect(
			filePathToRoutePattern("server/api/[...slug].ts", "api"),
		).toBe("/api/:slug+");
	});

	it("maps routes dir file without prefix", () => {
		expect(filePathToRoutePattern("server/routes/health.ts", "routes")).toBe(
			"/health",
		);
	});

	it("strips method suffix from pattern", () => {
		expect(filePathToRoutePattern("server/api/users.get.ts", "api")).toBe(
			"/api/users",
		);
	});

	it("maps root index.ts in api to /api", () => {
		expect(filePathToRoutePattern("server/api/index.ts", "api")).toBe(
			"/api",
		);
	});
});

describe("scanApiRoutes", () => {
	let dir_tmp: string;

	beforeEach(async () => {
		dir_tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vinuxt-api-test-"));
	});

	afterEach(async () => {
		await fs.rm(dir_tmp, { recursive: true, force: true });
	});

	it("scans server/api/ directory", async () => {
		const dir_api = path.join(dir_tmp, "server", "api");
		await fs.mkdir(dir_api, { recursive: true });
		await fs.writeFile(
			path.join(dir_api, "users.ts"),
			"export default defineEventHandler(() => [])",
		);

		const routes = await scanApiRoutes(dir_tmp);
		expect(routes).toHaveLength(1);
		expect(routes[0].pattern).toBe("/api/users");
		expect(routes[0].method).toBeNull();
		expect(routes[0].file_path).toBe(path.join(dir_api, "users.ts"));
	});

	it("scans server/routes/ directory", async () => {
		const dir_routes = path.join(dir_tmp, "server", "routes");
		await fs.mkdir(dir_routes, { recursive: true });
		await fs.writeFile(
			path.join(dir_routes, "health.ts"),
			"export default defineEventHandler(() => ({ ok: true }))",
		);

		const routes = await scanApiRoutes(dir_tmp);
		expect(routes).toHaveLength(1);
		expect(routes[0].pattern).toBe("/health");
	});

	it("scans both api and routes directories", async () => {
		const dir_api = path.join(dir_tmp, "server", "api");
		const dir_routes = path.join(dir_tmp, "server", "routes");
		await fs.mkdir(dir_api, { recursive: true });
		await fs.mkdir(dir_routes, { recursive: true });
		await fs.writeFile(path.join(dir_api, "users.ts"), "export default () => []");
		await fs.writeFile(
			path.join(dir_routes, "health.ts"),
			"export default () => true",
		);

		const routes = await scanApiRoutes(dir_tmp);
		expect(routes).toHaveLength(2);
		const patterns = routes.map((r) => r.pattern).sort();
		expect(patterns).toEqual(["/api/users", "/health"]);
	});

	it("extracts HTTP method from filename", async () => {
		const dir_api = path.join(dir_tmp, "server", "api");
		await fs.mkdir(dir_api, { recursive: true });
		await fs.writeFile(path.join(dir_api, "users.get.ts"), "export default () => []");
		await fs.writeFile(
			path.join(dir_api, "users.post.ts"),
			"export default () => ({})",
		);

		const routes = await scanApiRoutes(dir_tmp);
		expect(routes).toHaveLength(2);
		const route_get = routes.find((r) => r.method === "get");
		const route_post = routes.find((r) => r.method === "post");
		expect(route_get).toBeDefined();
		expect(route_get!.pattern).toBe("/api/users");
		expect(route_post).toBeDefined();
		expect(route_post!.pattern).toBe("/api/users");
	});

	it("handles dynamic segments", async () => {
		const dir_api = path.join(dir_tmp, "server", "api", "users");
		await fs.mkdir(dir_api, { recursive: true });
		await fs.writeFile(
			path.join(dir_api, "[id].ts"),
			"export default () => ({})",
		);

		const routes = await scanApiRoutes(dir_tmp);
		expect(routes).toHaveLength(1);
		expect(routes[0].pattern).toBe("/api/users/:id");
	});

	it("returns empty array when server directory does not exist", async () => {
		const routes = await scanApiRoutes(dir_tmp);
		expect(routes).toEqual([]);
	});

	it("ignores non ts/js files", async () => {
		const dir_api = path.join(dir_tmp, "server", "api");
		await fs.mkdir(dir_api, { recursive: true });
		await fs.writeFile(path.join(dir_api, "users.ts"), "export default () => []");
		await fs.writeFile(path.join(dir_api, "README.md"), "# API docs");

		const routes = await scanApiRoutes(dir_tmp);
		expect(routes).toHaveLength(1);
	});
});
