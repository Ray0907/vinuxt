import { describe, it, expect } from "vitest";
import {
	parseCookies,
	serializeCookie,
} from "../../packages/vinuxt/src/composables/cookie.js";

// ---------------------------------------------------------------------------
// parseCookies
// ---------------------------------------------------------------------------

describe("parseCookies", () => {
	it("parses basic cookies: 'a=1; b=2'", () => {
		const result = parseCookies("a=1; b=2");
		expect(result).toEqual({ a: "1", b: "2" });
	});

	it("parses encoded values", () => {
		const result = parseCookies("name=hello%20world; path=%2Ffoo");
		expect(result).toEqual({ name: "hello world", path: "/foo" });
	});

	it("handles empty cookie header", () => {
		const result = parseCookies("");
		expect(result).toEqual({});
	});

	it("handles missing cookie header (undefined-like)", () => {
		const result = parseCookies(undefined as unknown as string);
		expect(result).toEqual({});
	});

	it("trims whitespace around names and values", () => {
		const result = parseCookies("  foo = bar ;  baz = qux  ");
		expect(result).toEqual({ foo: "bar", baz: "qux" });
	});

	it("handles cookie with no value", () => {
		const result = parseCookies("empty=; present=yes");
		expect(result).toEqual({ empty: "", present: "yes" });
	});

	it("handles cookie value containing equals sign", () => {
		const result = parseCookies("token=abc=def=ghi");
		expect(result).toEqual({ token: "abc=def=ghi" });
	});
});

// ---------------------------------------------------------------------------
// serializeCookie
// ---------------------------------------------------------------------------

describe("serializeCookie", () => {
	it("serializes a simple name=value pair", () => {
		const result = serializeCookie("name", "Alice");
		expect(result).toBe("name=Alice");
	});

	it("serializes with path option", () => {
		const result = serializeCookie("session", "abc", { path: "/" });
		expect(result).toBe("session=abc; Path=/");
	});

	it("serializes with maxAge option", () => {
		const result = serializeCookie("token", "xyz", { maxAge: 3600 });
		expect(result).toBe("token=xyz; Max-Age=3600");
	});

	it("serializes with domain option", () => {
		const result = serializeCookie("id", "1", { domain: ".example.com" });
		expect(result).toBe("id=1; Domain=.example.com");
	});

	it("serializes with secure flag", () => {
		const result = serializeCookie("s", "val", { secure: true });
		expect(result).toBe("s=val; Secure");
	});

	it("serializes with httpOnly flag", () => {
		const result = serializeCookie("h", "val", { httpOnly: true });
		expect(result).toBe("h=val; HttpOnly");
	});

	it("serializes with sameSite option", () => {
		const result = serializeCookie("c", "v", { sameSite: "Lax" });
		expect(result).toBe("c=v; SameSite=Lax");
	});

	it("serializes with multiple options combined", () => {
		const result = serializeCookie("session", "abc123", {
			path: "/",
			maxAge: 86400,
			secure: true,
			httpOnly: true,
			sameSite: "Strict",
		});
		expect(result).toBe(
			"session=abc123; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Strict",
		);
	});

	it("encodes special characters in values", () => {
		const result = serializeCookie("data", "hello world");
		expect(result).toBe("data=hello%20world");
	});
});
