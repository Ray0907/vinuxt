/**
 * Error handling composables.
 *
 * Provides structured error creation and a global error state:
 * - `createError(opts)` -- create a structured error with HTTP semantics
 * - `showError(error)` -- set the global error state
 * - `clearError(opts?)` -- clear the global error state
 * - `useError()` -- access the current error ref
 */

import { ref, type Ref } from "vue";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateErrorOptions {
	/** HTTP status code. Defaults to 500. */
	statusCode?: number;
	/** HTTP status message. Defaults to "Internal Server Error". */
	statusMessage?: string;
	/** Arbitrary data attached to the error. */
	data?: unknown;
	/** Whether the error is fatal (app cannot recover). Defaults to false. */
	fatal?: boolean;
}

export interface VinuxtError extends Error {
	statusCode: number;
	statusMessage: string;
	data?: unknown;
	fatal: boolean;
}

// ---------------------------------------------------------------------------
// Global error state
// ---------------------------------------------------------------------------

const error_global: Ref<VinuxtError | null> = ref(null) as Ref<VinuxtError | null>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a structured error object with HTTP semantics.
 *
 * The returned object is a real `Error` instance (has `.stack`) augmented
 * with `statusCode`, `statusMessage`, `data`, and `fatal` properties.
 *
 * @param opts Error options (statusCode, statusMessage, data, fatal).
 */
export function createError(opts: CreateErrorOptions): VinuxtError {
	const status_code = opts.statusCode ?? 500;
	const status_message = opts.statusMessage ?? "Internal Server Error";
	const is_fatal = opts.fatal ?? false;

	const error = new Error(status_message) as VinuxtError;
	error.statusCode = status_code;
	error.statusMessage = status_message;
	error.data = opts.data;
	error.fatal = is_fatal;

	return error;
}

/**
 * Set the global error state. Typically called when an unrecoverable
 * error occurs that should be displayed by the error page/component.
 *
 * @param error The error to display globally.
 */
export function showError(error: VinuxtError): void {
	error_global.value = error;
}

/**
 * Clear the global error state, resetting it to null.
 */
export function clearError(): void {
	error_global.value = null;
}

/**
 * Access the global error ref. Returns a ref that may hold a `VinuxtError`
 * or `null` if no error is active.
 */
export function useError(): Ref<VinuxtError | null> {
	return error_global;
}
