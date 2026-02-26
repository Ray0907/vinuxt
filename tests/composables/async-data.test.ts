import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	createPayload,
	hydratePayload,
	useAsyncData,
	useFetch,
} from "../../packages/vinuxt/src/composables/async-data.js";

// ---------------------------------------------------------------------------
// Payload serialization (pure functions, no Vue dependency)
// ---------------------------------------------------------------------------

describe("payload serialization", () => {
	it("stores and retrieves data by key", () => {
		const payload = createPayload();
		payload.set("key1", { name: "test", count: 42 });
		expect(payload.get("key1")).toEqual({ name: "test", count: 42 });
	});

	it("serializes to JSON and hydrates back", () => {
		const payload = createPayload();
		payload.set("users", [{ id: 1, name: "Alice" }]);
		const json = payload.serialize();
		const restored = hydratePayload(json);
		expect(restored.get("users")).toEqual([{ id: 1, name: "Alice" }]);
	});

	it("returns undefined for missing keys", () => {
		const payload = createPayload();
		expect(payload.get("nope")).toBeUndefined();
	});

	it("overwrites existing keys", () => {
		const payload = createPayload();
		payload.set("x", 1);
		payload.set("x", 2);
		expect(payload.get("x")).toBe(2);
	});

	it("handles multiple keys", () => {
		const payload = createPayload();
		payload.set("a", "alpha");
		payload.set("b", "beta");
		payload.set("c", "gamma");
		expect(payload.get("a")).toBe("alpha");
		expect(payload.get("b")).toBe("beta");
		expect(payload.get("c")).toBe("gamma");
	});

	it("serializes complex nested data", () => {
		const payload = createPayload();
		const data_complex = {
			users: [{ id: 1, roles: ["admin", "user"] }],
			meta: { total: 100, nested: { deep: true } },
		};
		payload.set("complex", data_complex);
		const json = payload.serialize();
		const restored = hydratePayload(json);
		expect(restored.get("complex")).toEqual(data_complex);
	});

	it("serializes null and empty values", () => {
		const payload = createPayload();
		payload.set("empty_array", []);
		payload.set("empty_object", {});
		payload.set("null_value", null);
		payload.set("zero", 0);
		payload.set("empty_string", "");

		const json = payload.serialize();
		const restored = hydratePayload(json);

		expect(restored.get("empty_array")).toEqual([]);
		expect(restored.get("empty_object")).toEqual({});
		expect(restored.get("null_value")).toBeNull();
		expect(restored.get("zero")).toBe(0);
		expect(restored.get("empty_string")).toBe("");
	});

	it("hydrates from an empty payload", () => {
		const payload = createPayload();
		const json = payload.serialize();
		const restored = hydratePayload(json);
		expect(restored.get("anything")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// useAsyncData
// ---------------------------------------------------------------------------

// Mock Vue reactivity primitives for testing outside a Vue app context.
// We use vi.mock to replace vue imports with simple reactive-like wrappers.
vi.mock("vue", () => {
	return {
		ref: <T>(value: T) => ({ value }),
		shallowRef: <T>(value: T) => ({ value }),
	};
});

describe("useAsyncData", () => {
	beforeEach(() => {
		// Reset any global state between tests
		vi.restoreAllMocks();
	});

	it("executes handler and returns data on client navigation", async () => {
		const handler = vi.fn().mockResolvedValue({ id: 1, name: "Alice" });

		const result = useAsyncData("user-1", handler);

		expect(result.data).toBeDefined();
		expect(result.pending).toBeDefined();
		expect(result.error).toBeDefined();
		expect(result.refresh).toBeTypeOf("function");

		// pending should start as true
		expect(result.pending.value).toBe(true);

		// Wait for handler to resolve
		await result.refresh();

		expect(handler).toHaveBeenCalled();
		expect(result.data.value).toEqual({ id: 1, name: "Alice" });
		expect(result.pending.value).toBe(false);
		expect(result.error.value).toBeNull();
	});

	it("captures handler errors in error ref", async () => {
		const error_expected = new Error("fetch failed");
		const handler = vi.fn().mockRejectedValue(error_expected);

		const result = useAsyncData("failing", handler);
		await result.refresh();

		expect(result.data.value).toBeNull();
		expect(result.error.value).toBe(error_expected);
		expect(result.pending.value).toBe(false);
	});

	it("refresh re-executes handler", async () => {
		let count_call = 0;
		const handler = vi.fn().mockImplementation(async () => {
			count_call++;
			return { count: count_call };
		});

		const result = useAsyncData("counter", handler);
		await result.refresh();
		expect(result.data.value).toEqual({ count: 1 });

		await result.refresh();
		expect(result.data.value).toEqual({ count: 2 });
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it("uses payload data during hydration and skips handler", async () => {
		const data_hydrated = { id: 99, name: "Hydrated" };
		const payload = createPayload();
		payload.set("hydrate-key", data_hydrated);

		const handler = vi.fn().mockResolvedValue({ id: 1, name: "Fresh" });

		const result = useAsyncData("hydrate-key", handler, { payload });

		// Should immediately have data from payload
		expect(result.data.value).toEqual(data_hydrated);
		expect(result.pending.value).toBe(false);
		// Handler should NOT have been called (hydration skips fetch)
		expect(handler).not.toHaveBeenCalled();
	});

	it("falls through to handler when payload has no matching key", async () => {
		const payload = createPayload();
		// payload has no key "missing-key"

		const handler = vi.fn().mockResolvedValue({ fresh: true });

		const result = useAsyncData("missing-key", handler, { payload });
		await result.refresh();

		expect(handler).toHaveBeenCalled();
		expect(result.data.value).toEqual({ fresh: true });
	});

	it("stores result in payload when server option is set", async () => {
		const payload = createPayload();
		const handler = vi.fn().mockResolvedValue({ ssr: true });

		const result = useAsyncData("ssr-key", handler, {
			payload,
			server: true,
		});
		await result.refresh();

		expect(result.data.value).toEqual({ ssr: true });
		// Data should be stored in payload for client hydration
		expect(payload.get("ssr-key")).toEqual({ ssr: true });
	});
});

// ---------------------------------------------------------------------------
// useFetch
// ---------------------------------------------------------------------------

describe("useFetch", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("wraps useAsyncData with a fetch handler", async () => {
		// Mock globalThis.fetch for useFetch
		const data_mock = { message: "hello" };
		const fetch_mock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(data_mock),
		});
		vi.stubGlobal("fetch", fetch_mock);

		const result = useFetch("/api/hello");
		await result.refresh();

		expect(fetch_mock).toHaveBeenCalledWith("/api/hello", undefined);
		expect(result.data.value).toEqual(data_mock);
		expect(result.pending.value).toBe(false);
		expect(result.error.value).toBeNull();

		vi.unstubAllGlobals();
	});

	it("passes fetch options through", async () => {
		const fetch_mock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({}),
		});
		vi.stubGlobal("fetch", fetch_mock);

		const opts_fetch = { method: "POST", body: JSON.stringify({ x: 1 }) };
		const result = useFetch("/api/data", { fetchOptions: opts_fetch });
		await result.refresh();

		expect(fetch_mock).toHaveBeenCalledWith("/api/data", opts_fetch);

		vi.unstubAllGlobals();
	});

	it("captures non-ok responses as errors", async () => {
		const fetch_mock = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
		});
		vi.stubGlobal("fetch", fetch_mock);

		const result = useFetch("/api/missing");
		await result.refresh();

		expect(result.data.value).toBeNull();
		expect(result.error.value).toBeInstanceOf(Error);
		expect(result.error.value!.message).toContain("404");

		vi.unstubAllGlobals();
	});

	it("generates a deterministic key from URL", async () => {
		const fetch_mock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ ok: true }),
		});
		vi.stubGlobal("fetch", fetch_mock);

		// Two calls with same URL should use same underlying key
		const result_a = useFetch("/api/same");
		const result_b = useFetch("/api/same");

		await result_a.refresh();
		await result_b.refresh();

		// Both should succeed independently
		expect(result_a.data.value).toEqual({ ok: true });
		expect(result_b.data.value).toEqual({ ok: true });

		vi.unstubAllGlobals();
	});
});
