/**
 * Shared reactive state composable.
 *
 * `useState` provides SSR-safe shared state across components within a single
 * request. Uses a module-level Map keyed by string. If the key already exists,
 * the existing ref is returned (singleton pattern). Otherwise, the init
 * function is called to create the initial value.
 *
 * ALS (AsyncLocalStorage) integration for per-request isolation comes later.
 */

import { ref, type Ref } from "vue";

const state_map = new Map<string, Ref<unknown>>();

/**
 * Return a reactive ref keyed by `key`. If the key already exists in the
 * global state map, the existing ref is returned. Otherwise, the `init`
 * function is called (if provided) and a new ref is created.
 *
 * @param key  Unique string identifier for this piece of state.
 * @param init Optional factory function that returns the initial value.
 */
export function useState<T>(key: string, init?: () => T): Ref<T> {
	if (state_map.has(key)) {
		return state_map.get(key) as Ref<T>;
	}

	const value_initial = init ? init() : undefined;
	const state_ref = ref(value_initial) as Ref<T>;
	state_map.set(key, state_ref as Ref<unknown>);
	return state_ref;
}

/**
 * Reset the global state map. Intended for testing only.
 */
export function resetStateMap(): void {
	state_map.clear();
}
