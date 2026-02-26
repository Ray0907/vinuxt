import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Vue reactivity primitives for testing outside a Vue app context.
vi.mock("vue", () => {
	return {
		ref: <T>(value: T) => ({ value }),
		shallowRef: <T>(value: T) => ({ value }),
	};
});

import { useState, resetStateMap } from "../../packages/vinuxt/src/composables/state.js";

describe("useState", () => {
	beforeEach(() => {
		// Clear the global state map between tests
		resetStateMap();
	});

	it("returns a ref with init value", () => {
		const state = useState("counter", () => 42);
		expect(state.value).toBe(42);
	});

	it("returns same ref for same key (singleton)", () => {
		const state_a = useState("shared", () => "hello");
		const state_b = useState("shared", () => "world");

		// Both should point to the same ref; second init is ignored
		expect(state_a).toBe(state_b);
		expect(state_a.value).toBe("hello");
		expect(state_b.value).toBe("hello");
	});

	it("returns undefined ref if no init and key missing", () => {
		const state = useState("missing");
		expect(state.value).toBeUndefined();
	});

	it("multiple keys are independent", () => {
		const state_name = useState("name", () => "Alice");
		const state_count = useState("count", () => 0);

		expect(state_name.value).toBe("Alice");
		expect(state_count.value).toBe(0);

		state_name.value = "Bob";
		expect(state_name.value).toBe("Bob");
		expect(state_count.value).toBe(0);
	});
});
