/**
 * ISR (Incremental Static Regeneration) cache layer.
 *
 * Wraps the pluggable CacheHandler with stale-while-revalidate semantics:
 * - Fresh hit: serve immediately
 * - Stale hit: serve immediately + trigger background regeneration
 * - Miss: render synchronously, cache, serve
 *
 * Background regeneration is deduped -- only one regeneration per cache key
 * runs at a time, preventing thundering herd on popular pages.
 *
 * This layer works with any CacheHandler backend (memory, Redis, KV, etc.)
 * because it only uses the standard get/set interface.
 */

// --- Cache Handler Interface -------------------------------------------------
//
// Defines the pluggable cache backend interface. Implementations include
// the in-memory default and the Cloudflare KV handler in cloudflare/.

export interface CacheHandlerValue {
	lastModified: number;
	age?: number;
	cacheState?: string;
	value: IncrementalCacheValue | null;
}

/** Discriminated union of cache value types. */
export type IncrementalCacheValue =
	| CachedPageValue
	| CachedRouteValue
	| CachedRedirectValue
	| CachedImageValue;

export interface CachedPageValue {
	kind: "PAGE";
	html: string;
	headers: Record<string, string | string[]> | undefined;
	status: number | undefined;
	revalidate?: number;
	tags?: string[];
}

export interface CachedRouteValue {
	kind: "ROUTE";
	body: ArrayBuffer;
	status: number;
	headers: Record<string, string | string[]>;
	revalidate?: number;
	tags?: string[];
}

export interface CachedRedirectValue {
	kind: "REDIRECT";
	destination: string;
	statusCode: number;
	tags?: string[];
}

export interface CachedImageValue {
	kind: "IMAGE";
	etag: string;
	buffer: ArrayBuffer;
	extension: string;
	revalidate?: number;
}

export interface CacheHandler {
	get(
		key: string,
		ctx?: Record<string, unknown>,
	): Promise<CacheHandlerValue | null>;

	set(
		key: string,
		data: IncrementalCacheValue | null,
		ctx?: Record<string, unknown>,
	): Promise<void>;

	revalidateTag(
		tags: string | string[],
		durations?: { expire?: number },
	): Promise<void>;

	resetRequestCache?(): void;
}

// --- Default In-Memory Handler -----------------------------------------------

interface MemoryEntry {
	value: IncrementalCacheValue | null;
	tags: string[];
	last_modified: number;
	revalidate_at: number | null;
}

class MemoryCacheHandler implements CacheHandler {
	private store = new Map<string, MemoryEntry>();
	private tag_revalidated_at = new Map<string, number>();

	async get(key: string): Promise<CacheHandlerValue | null> {
		const entry = this.store.get(key);
		if (!entry) return null;

		// Check tag-based invalidation
		for (const tag of entry.tags) {
			const tag_time = this.tag_revalidated_at.get(tag);
			if (tag_time !== undefined && tag_time >= entry.last_modified) {
				this.store.delete(key);
				return null;
			}
		}

		// Check time-based expiry
		if (entry.revalidate_at !== null && Date.now() > entry.revalidate_at) {
			return {
				lastModified: entry.last_modified,
				value: entry.value,
				cacheState: "stale",
			};
		}

		return {
			lastModified: entry.last_modified,
			value: entry.value,
		};
	}

	async set(
		key: string,
		data: IncrementalCacheValue | null,
		ctx?: Record<string, unknown>,
	): Promise<void> {
		const tags: string[] = [];
		if (data && "tags" in data && Array.isArray(data.tags)) {
			tags.push(...data.tags);
		}
		if (ctx && "tags" in ctx && Array.isArray(ctx.tags)) {
			tags.push(...(ctx.tags as string[]));
		}

		let revalidate_at: number | null = null;
		const revalidate_seconds =
			(ctx as Record<string, unknown> | undefined)?.revalidate as number | undefined;
		if (typeof revalidate_seconds === "number" && revalidate_seconds > 0) {
			revalidate_at = Date.now() + revalidate_seconds * 1000;
		}
		if (data && "revalidate" in data && typeof data.revalidate === "number" && data.revalidate > 0) {
			revalidate_at = Date.now() + data.revalidate * 1000;
		}

		this.store.set(key, {
			value: data,
			tags: [...new Set(tags)],
			last_modified: Date.now(),
			revalidate_at,
		});
	}

	async revalidateTag(tags: string | string[]): Promise<void> {
		const tag_list = Array.isArray(tags) ? tags : [tags];
		const now = Date.now();
		for (const tag of tag_list) {
			this.tag_revalidated_at.set(tag, now);
		}
	}

	resetRequestCache(): void {
		// No-op for memory handler
	}
}

// --- Global Cache Handler Singleton ------------------------------------------

let cache_handler: CacheHandler = new MemoryCacheHandler();

/** Get the current cache handler. */
export function getCacheHandler(): CacheHandler {
	return cache_handler;
}

/** Set a custom cache handler (e.g. KVCacheHandler for Cloudflare). */
export function setCacheHandler(handler: CacheHandler): void {
	cache_handler = handler;
}

// --- ISR Public API ----------------------------------------------------------

export interface ISRCacheEntry {
	value: CacheHandlerValue;
	is_stale: boolean;
}

/**
 * Get a cache entry with staleness information.
 *
 * Returns { value, is_stale: false } for fresh entries,
 * { value, is_stale: true } for expired-but-usable entries,
 * or null for cache misses.
 */
export async function isrGet(key: string): Promise<ISRCacheEntry | null> {
	const handler = getCacheHandler();
	const result = await handler.get(key);
	if (!result || !result.value) return null;

	return {
		value: result,
		is_stale: result.cacheState === "stale",
	};
}

/**
 * Store a value in the ISR cache with a revalidation period.
 */
export async function isrSet(
	key: string,
	data: IncrementalCacheValue,
	revalidate_seconds: number,
	tags?: string[],
): Promise<void> {
	const handler = getCacheHandler();
	await handler.set(key, data, {
		revalidate: revalidate_seconds,
		tags: tags ?? [],
	});
}

// --- Background Regeneration Dedup -------------------------------------------

const pending_regenerations = new Map<string, Promise<void>>();

/**
 * Trigger a background regeneration for a cache key.
 *
 * If a regeneration for this key is already in progress, this is a no-op.
 * The render_fn should produce the new cache value and call isrSet internally.
 */
export function triggerBackgroundRegeneration(
	key: string,
	render_fn: () => Promise<void>,
): void {
	if (pending_regenerations.has(key)) return;

	const promise = render_fn()
		.catch((err) => {
			console.error(`[vinuxt] ISR background regeneration failed for ${key}:`, err);
		})
		.finally(() => {
			pending_regenerations.delete(key);
		});

	pending_regenerations.set(key, promise);
}

// --- Helpers for Building ISR Cache Values -----------------------------------

/**
 * Build a CachedPageValue for the ISR cache.
 */
export function buildPageCacheValue(
	html: string,
	status?: number,
): CachedPageValue {
	return {
		kind: "PAGE",
		html,
		headers: undefined,
		status,
	};
}

/**
 * Compute an ISR cache key for a given pathname.
 * Long pathnames are hashed to stay within KV key-length limits (512 bytes).
 */
export function isrCacheKey(pathname: string): string {
	const normalized = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
	const key = `page:${normalized}`;
	if (key.length <= 200) return key;
	return `page:__hash:${simpleHash(normalized)}`;
}

/**
 * Simple FNV-1a hash for cache key shortening.
 * Returns a hex string.
 */
function simpleHash(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

// --- Revalidate Duration Tracking --------------------------------------------

const MAX_REVALIDATE_ENTRIES = 10_000;
const revalidate_durations = new Map<string, number>();

/**
 * Store the revalidate duration for a cache key.
 * Uses insertion-order LRU eviction to prevent unbounded growth.
 */
export function setRevalidateDuration(key: string, seconds: number): void {
	// Simple LRU: delete and re-insert to move to end (most recent)
	revalidate_durations.delete(key);
	revalidate_durations.set(key, seconds);
	// Evict oldest entries if over limit
	while (revalidate_durations.size > MAX_REVALIDATE_ENTRIES) {
		const first = revalidate_durations.keys().next().value;
		if (first !== undefined) revalidate_durations.delete(first);
		else break;
	}
}

/**
 * Get the revalidate duration for a cache key.
 */
export function getRevalidateDuration(key: string): number | undefined {
	return revalidate_durations.get(key);
}
