import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Vue reactivity primitives for testing outside a Vue app context.
vi.mock("vue", () => {
	return {
		ref: <T>(value: T) => ({ value }),
		shallowRef: <T>(value: T) => ({ value }),
	};
});

import {
	createError,
	showError,
	clearError,
	useError,
} from "../../packages/vinuxt/src/composables/error.js";

describe("createError", () => {
	it("creates error with statusCode and message", () => {
		const error = createError({
			statusCode: 404,
			statusMessage: "Not Found",
		});

		expect(error.statusCode).toBe(404);
		expect(error.statusMessage).toBe("Not Found");
	});

	it("uses defaults (500, 'Internal Server Error')", () => {
		const error = createError({});

		expect(error.statusCode).toBe(500);
		expect(error.statusMessage).toBe("Internal Server Error");
	});

	it("has correct shape (statusCode, statusMessage, data, fatal, stack)", () => {
		const error = createError({
			statusCode: 403,
			statusMessage: "Forbidden",
			data: { reason: "insufficient permissions" },
			fatal: true,
		});

		expect(error.statusCode).toBe(403);
		expect(error.statusMessage).toBe("Forbidden");
		expect(error.data).toEqual({ reason: "insufficient permissions" });
		expect(error.fatal).toBe(true);
		// Should be an Error instance with a stack trace
		expect(error).toBeInstanceOf(Error);
		expect(error.stack).toBeDefined();
	});

	it("defaults fatal to false", () => {
		const error = createError({ statusCode: 400 });
		expect(error.fatal).toBe(false);
	});

	it("message property equals statusMessage", () => {
		const error = createError({ statusMessage: "Bad Request" });
		expect(error.message).toBe("Bad Request");
	});
});

describe("showError / clearError / useError", () => {
	beforeEach(() => {
		// Clear error state between tests
		clearError();
	});

	it("useError returns null initially", () => {
		const error_ref = useError();
		expect(error_ref.value).toBeNull();
	});

	it("showError sets the global error state", () => {
		const error = createError({ statusCode: 500, statusMessage: "Server Error" });
		showError(error);

		const error_ref = useError();
		expect(error_ref.value).toBe(error);
	});

	it("clearError resets the global error state", () => {
		const error = createError({ statusCode: 404 });
		showError(error);

		const error_ref = useError();
		expect(error_ref.value).not.toBeNull();

		clearError();

		// useError should return the same ref, now cleared
		expect(error_ref.value).toBeNull();
	});
});
