/**
 * Runtime configuration composable.
 *
 * Provides access to the application's runtime configuration:
 * - `public` keys are available everywhere (client + server)
 * - Private keys are server-only
 *
 * The config is set once during app initialization (via the Vite plugin or
 * manual `setRuntimeConfig` call) and is returned as a deeply frozen object
 * to prevent accidental mutation.
 *
 * Integration with `vinuxt.config.ts` comes via the plugin layer.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
	/** Public keys available on both client and server. */
	public: Record<string, unknown>;
	/** Any additional server-only keys. */
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config_current: Readonly<RuntimeConfig> = Object.freeze({
	public: Object.freeze({}),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deep-freeze an object and all nested plain objects.
 */
function deepFreeze<T extends Record<string, unknown>>(obj: T): Readonly<T> {
	Object.freeze(obj);

	for (const value of Object.values(obj)) {
		if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
			deepFreeze(value as Record<string, unknown>);
		}
	}

	return obj;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set the runtime config. Called during app initialization.
 *
 * The provided config is deep-frozen to prevent mutation.
 *
 * @param config The runtime configuration object.
 */
export function setRuntimeConfig(config: RuntimeConfig): void {
	const config_copy = structuredClone(config) as RuntimeConfig;
	config_current = deepFreeze(config_copy);
}

/**
 * Access the current runtime configuration.
 *
 * Returns a deeply frozen object -- any attempt to mutate it will throw.
 */
export function useRuntimeConfig(): Readonly<RuntimeConfig> {
	return config_current;
}
