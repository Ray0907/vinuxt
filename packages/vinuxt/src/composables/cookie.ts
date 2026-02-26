/**
 * Cookie parsing and serialization utilities.
 *
 * Provides pure functions for working with HTTP cookies:
 * - `parseCookies` -- parse a Cookie header string into a key-value record
 * - `serializeCookie` -- build a Set-Cookie header string from name, value, and options
 *
 * The reactive `useCookie` composable will be built on top of these helpers
 * once browser/server context integration is in place.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CookieOptions {
	/** Cookie max age in seconds. */
	maxAge?: number;
	/** URL path the cookie is valid for. */
	path?: string;
	/** Domain the cookie is valid for. */
	domain?: string;
	/** Only send over HTTPS. */
	secure?: boolean;
	/** Prevent JavaScript access. */
	httpOnly?: boolean;
	/** SameSite attribute: "Strict", "Lax", or "None". */
	sameSite?: "Strict" | "Lax" | "None";
}

// ---------------------------------------------------------------------------
// parseCookies
// ---------------------------------------------------------------------------

/**
 * Parse a Cookie header string into a plain object of key-value pairs.
 *
 * Handles encoded values (via `decodeURIComponent`), whitespace trimming,
 * and edge cases like empty strings or values containing `=`.
 *
 * @param header The raw Cookie header string (e.g. "a=1; b=2").
 * @returns A record mapping cookie names to their decoded values.
 */
export function parseCookies(header: string): Record<string, string> {
	const result: Record<string, string> = {};

	if (!header) {
		return result;
	}

	const pairs = header.split(";");

	for (const pair of pairs) {
		const idx_eq = pair.indexOf("=");

		if (idx_eq === -1) {
			continue;
		}

		const name_raw = pair.slice(0, idx_eq).trim();
		const value_raw = pair.slice(idx_eq + 1).trim();

		if (!name_raw) {
			continue;
		}

		try {
			result[name_raw] = decodeURIComponent(value_raw);
		} catch {
			// If decoding fails, use the raw value
			result[name_raw] = value_raw;
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// serializeCookie
// ---------------------------------------------------------------------------

/**
 * Serialize a cookie name, value, and options into a Set-Cookie header string.
 *
 * @param name    The cookie name.
 * @param value   The cookie value (will be URI-encoded).
 * @param options Optional cookie attributes (path, maxAge, etc.).
 * @returns A fully formed Set-Cookie header string.
 */
export function serializeCookie(
	name: string,
	value: string,
	options?: CookieOptions,
): string {
	const value_encoded = encodeURIComponent(value);
	const parts: string[] = [`${name}=${value_encoded}`];

	if (!options) {
		return parts[0];
	}

	if (options.path !== undefined) {
		parts.push(`Path=${options.path}`);
	}

	if (options.maxAge !== undefined) {
		parts.push(`Max-Age=${options.maxAge}`);
	}

	if (options.domain !== undefined) {
		parts.push(`Domain=${options.domain}`);
	}

	if (options.secure) {
		parts.push("Secure");
	}

	if (options.httpOnly) {
		parts.push("HttpOnly");
	}

	if (options.sameSite !== undefined) {
		parts.push(`SameSite=${options.sameSite}`);
	}

	return parts.join("; ");
}
