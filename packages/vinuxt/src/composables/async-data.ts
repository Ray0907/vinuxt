/**
 * SSR payload system and async data composables.
 *
 * Provides:
 * - createPayload / hydratePayload -- serialization layer for SSR data transfer
 * - useAsyncData -- reactive data fetching with SSR hydration support
 * - useFetch -- convenience wrapper around useAsyncData using native fetch
 */

import { ref, shallowRef } from "vue";

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface Payload {
	/** Store a value by key. */
	set(key: string, value: unknown): void;
	/** Retrieve a value by key. Returns undefined if not found. */
	get(key: string): unknown;
	/** Serialize the entire payload to a JSON string. */
	serialize(): string;
}

/**
 * Create a new empty payload store.
 *
 * The payload is a Map-like container that holds SSR data keyed by string.
 * On the server, composables populate it during rendering. The result is
 * serialized into the HTML as `window.__VINUXT_DATA__` so the client can
 * hydrate without re-fetching.
 */
export function createPayload(): Payload {
	const store = new Map<string, unknown>();

	return {
		set(key: string, value: unknown): void {
			store.set(key, value);
		},

		get(key: string): unknown {
			return store.get(key);
		},

		serialize(): string {
			const obj: Record<string, unknown> = {};
			for (const [key, value] of store) {
				obj[key] = value;
			}
			return JSON.stringify(obj);
		},
	};
}

/**
 * Hydrate a payload from a serialized JSON string.
 *
 * Used on the client to restore the data the server wrote into
 * `window.__VINUXT_DATA__`.
 */
export function hydratePayload(json: string): Payload {
	const parsed: Record<string, unknown> = JSON.parse(json);
	const payload = createPayload();

	for (const [key, value] of Object.entries(parsed)) {
		payload.set(key, value);
	}

	return payload;
}

// ---------------------------------------------------------------------------
// useAsyncData
// ---------------------------------------------------------------------------

/** Reactive refs returned by useAsyncData / useFetch. */
export interface AsyncDataResult<T> {
	/** The fetched data, or null if not yet resolved / on error. */
	data: { value: T | null };
	/** Whether a fetch is currently in progress. */
	pending: { value: boolean };
	/** The error thrown by the handler, or null on success. */
	error: { value: Error | null };
	/** Re-execute the handler and update all refs. */
	refresh: () => Promise<void>;
}

export interface AsyncDataOptions {
	/**
	 * Payload instance for SSR data transfer.
	 * - On hydration: if the payload contains data for this key, the handler
	 *   is skipped and data is read directly from the payload.
	 * - On server: when `server` is true, handler results are stored in the
	 *   payload for serialization.
	 */
	payload?: Payload;
	/**
	 * When true, stores the handler result in the payload after execution.
	 * Used during SSR to populate `window.__VINUXT_DATA__`.
	 */
	server?: boolean;
}

/**
 * Fetch data reactively with SSR hydration support.
 *
 * Behaviour depends on context:
 * - **Server-side render**: executes handler, stores result in payload
 * - **Client hydration**: reads from payload, skips handler entirely
 * - **Client navigation**: executes handler normally
 *
 * @param key   Unique string key for payload serialization.
 * @param handler Async function that returns the data.
 * @param options Optional payload and SSR configuration.
 */
export function useAsyncData<T = unknown>(
	key: string,
	handler: () => Promise<T>,
	options?: AsyncDataOptions,
): AsyncDataResult<T> {
	const payload = options?.payload;
	const is_server = options?.server ?? false;

	// Check if we have hydration data available
	const data_hydrated = payload?.get(key);
	const has_hydration = data_hydrated !== undefined;

	// If hydration data exists, use it directly without calling handler
	if (has_hydration) {
		const data_ref = shallowRef<T | null>(data_hydrated as T);
		const is_pending = ref(false);
		const error_ref = ref<Error | null>(null);

		const refresh = async (): Promise<void> => {
			is_pending.value = true;
			try {
				const result = await handler();
				data_ref.value = result;
				error_ref.value = null;
			} catch (err) {
				error_ref.value = err instanceof Error ? err : new Error(String(err));
			} finally {
				is_pending.value = false;
			}
		};

		return { data: data_ref, pending: is_pending, error: error_ref, refresh };
	}

	// No hydration data -- set up fresh reactive state
	const data_ref = shallowRef<T | null>(null);
	const is_pending = ref(true);
	const error_ref = ref<Error | null>(null);

	const refresh = async (): Promise<void> => {
		is_pending.value = true;
		try {
			const result = await handler();
			data_ref.value = result;
			error_ref.value = null;

			// Store in payload for client hydration when running on server
			if (is_server && payload) {
				payload.set(key, result);
			}
		} catch (err) {
			data_ref.value = null;
			error_ref.value = err instanceof Error ? err : new Error(String(err));
		} finally {
			is_pending.value = false;
		}
	};

	return { data: data_ref, pending: is_pending, error: error_ref, refresh };
}

// ---------------------------------------------------------------------------
// useFetch
// ---------------------------------------------------------------------------

export interface UseFetchOptions extends AsyncDataOptions {
	/** Options passed directly to the native fetch() call. */
	fetchOptions?: RequestInit;
}

/**
 * Convenience wrapper around useAsyncData that uses native fetch.
 *
 * Generates a deterministic key from the URL and delegates to useAsyncData.
 * Response is expected to be JSON; non-ok responses become Error objects.
 *
 * @param url   The URL to fetch.
 * @param options Optional fetch and payload configuration.
 */
export function useFetch<T = unknown>(
	url: string,
	options?: UseFetchOptions,
): AsyncDataResult<T> {
	const key_fetch = `$fetch:${url}`;
	const opts_fetch = options?.fetchOptions;

	const handler = async (): Promise<T> => {
		const response = await fetch(url, opts_fetch);

		if (!response.ok) {
			throw new Error(
				`Fetch failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<T>;
	};

	return useAsyncData<T>(key_fetch, handler, options);
}
