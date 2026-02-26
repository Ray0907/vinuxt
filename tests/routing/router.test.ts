import { describe, it, expect } from "vitest";
import { scanRoutes, matchRoute, type Route } from "../../packages/vinuxt/src/routing/router.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function setupPages(pages: Record<string, string>): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vinuxt-routes-"));
	const dir_pages = path.join(tmp, "pages");
	for (const [fp, content] of Object.entries(pages)) {
		const full = path.join(dir_pages, fp);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content);
	}
	return dir_pages;
}

describe("scanRoutes - basic", () => {
	it("converts index.vue to /", async () => {
		const dir = setupPages({ "index.vue": "<template><div/></template>" });
		const routes = await scanRoutes(dir);
		expect(routes[0].pattern).toBe("/");
	});

	it("converts about.vue to /about", async () => {
		const dir = setupPages({ "about.vue": "<template><div/></template>" });
		const routes = await scanRoutes(dir);
		expect(routes[0].pattern).toBe("/about");
	});

	it("converts [id].vue to /:id (dynamic)", async () => {
		const dir = setupPages({ "posts/[id].vue": "<template><div/></template>" });
		const routes = await scanRoutes(dir);
		expect(routes[0].pattern).toBe("/posts/:id");
		expect(routes[0].isDynamic).toBe(true);
		expect(routes[0].params).toEqual(["id"]);
	});

	it("converts [...slug].vue to /:slug+ (catch-all)", async () => {
		const dir = setupPages({ "[...slug].vue": "<template><div/></template>" });
		const routes = await scanRoutes(dir);
		expect(routes[0].pattern).toBe("/:slug+");
	});

	it("sorts static > dynamic > catch-all", async () => {
		const dir = setupPages({
			"about.vue": "", "[id].vue": "", "[...slug].vue": "",
		});
		const routes = await scanRoutes(dir);
		expect(routes.map((r) => r.pattern)).toEqual(["/about", "/:id", "/:slug+"]);
	});
});

describe("scanRoutes - nested routing", () => {
	it("nests children when parent file and directory coexist", async () => {
		const dir = setupPages({
			"users.vue": "",
			"users/index.vue": "",
			"users/[id].vue": "",
		});
		const routes = await scanRoutes(dir);
		const usersRoute = routes.find((r) => r.pattern === "/users");
		expect(usersRoute).toBeDefined();
		expect(usersRoute!.children.length).toBe(2);
		// Children should have relative patterns (stripped of parent prefix)
		const childPatterns = usersRoute!.children.map((c) => c.pattern);
		expect(childPatterns).toContain("");       // users/index.vue -> ""
		expect(childPatterns).toContain(":id");    // users/[id].vue -> ":id"
	});

	it("flat routes have empty children array", async () => {
		const dir = setupPages({ "about.vue": "" });
		const routes = await scanRoutes(dir);
		expect(routes[0].children).toEqual([]);
	});

	it("does not nest when only directory exists (no parent file)", async () => {
		const dir = setupPages({
			"users/index.vue": "",
			"users/[id].vue": "",
		});
		const routes = await scanRoutes(dir);
		// Without users.vue, these are top-level routes
		expect(routes.find((r) => r.pattern === "/users")).toBeDefined();
		expect(routes.find((r) => r.pattern === "/users/:id")).toBeDefined();
		routes.forEach((r) => expect(r.children).toEqual([]));
	});
});

describe("matchRoute", () => {
	it("matches static route", () => {
		const routes: Route[] = [
			{ pattern: "/about", filePath: "/p/about.vue", isDynamic: false, params: [], children: [] },
		];
		const result = matchRoute("/about", routes);
		expect(result).not.toBeNull();
		expect(result!.route.pattern).toBe("/about");
	});

	it("extracts dynamic params", () => {
		const routes: Route[] = [
			{ pattern: "/posts/:id", filePath: "/p/posts/[id].vue", isDynamic: true, params: ["id"], children: [] },
		];
		const result = matchRoute("/posts/42", routes);
		expect(result!.params.id).toBe("42");
	});

	it("strips query string before matching", () => {
		const routes: Route[] = [
			{ pattern: "/about", filePath: "/p/about.vue", isDynamic: false, params: [], children: [] },
		];
		expect(matchRoute("/about?foo=bar", routes)).not.toBeNull();
	});

	it("returns null for no match", () => {
		const routes: Route[] = [
			{ pattern: "/about", filePath: "/p/about.vue", isDynamic: false, params: [], children: [] },
		];
		expect(matchRoute("/missing", routes)).toBeNull();
	});
});
