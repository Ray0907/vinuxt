/**
 * Router composables -- thin wrappers around vue-router.
 *
 * Provides Nuxt-compatible API surface:
 * - `useRouter()` -- access the router instance
 * - `useRoute()` -- access the current route
 * - `navigateTo()` -- programmatic navigation helper
 * - `abortNavigation()` -- for use in route middleware
 */

import {
	useRouter as useVueRouter,
	useRoute as useVueRoute,
	type Router,
	type RouteLocationRaw,
	type RouteLocationNormalized,
} from "vue-router";

/**
 * Access the vue-router instance.
 */
export function useRouter(): Router {
	return useVueRouter();
}

/**
 * Access the current route.
 */
export function useRoute(): RouteLocationNormalized {
	return useVueRoute() as RouteLocationNormalized;
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

export interface NavigateToOptions {
	/** Replace the current history entry instead of pushing. */
	replace?: boolean;
	/** Open in a new tab (client-side only). */
	external?: boolean;
}

/**
 * Programmatic navigation helper.
 *
 * Wraps `router.push` / `router.replace` with a Nuxt-compatible API.
 * When `external` is true and running in the browser, opens via
 * `window.open` instead.
 *
 * @param to   The target route (path string or route location object).
 * @param opts Navigation options.
 */
export function navigateTo(
	to: RouteLocationRaw,
	opts?: NavigateToOptions,
): Promise<void> | void {
	if (opts?.external && typeof window !== "undefined") {
		const url_target = typeof to === "string" ? to : String(to);
		window.open(url_target, "_blank");
		return;
	}

	const router = useVueRouter();

	if (opts?.replace) {
		return router.replace(to).then(() => undefined);
	}

	return router.push(to).then(() => undefined);
}

/**
 * Abort the current navigation. Intended for use inside route middleware.
 *
 * Throws a special error that the router middleware system can catch
 * to prevent navigation from completing.
 */
export function abortNavigation(message?: string): never {
	const error_abort = new Error(message ?? "Navigation aborted");
	(error_abort as Error & { __abortNavigation: boolean }).__abortNavigation = true;
	throw error_abort;
}
