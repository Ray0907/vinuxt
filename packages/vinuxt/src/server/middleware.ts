/**
 * Middleware scanning utilities.
 *
 * Scans two distinct middleware directories:
 * - middleware/          -- route middleware (client-side, per-page)
 * - server/middleware/   -- server middleware (runs on every request)
 *
 * Naming conventions:
 * - middleware/auth.ts        -> named "auth", not global
 * - middleware/auth.global.ts -> named "auth", global (always runs)
 */

import { glob } from "node:fs/promises";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MiddlewareEntry {
	/** Middleware name derived from the filename (e.g. "auth") */
	name: string;
	/** Absolute file path to the middleware module */
	file_path: string;
	/** Whether this middleware runs globally (has .global suffix) */
	global: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the middleware/ directory for route middleware files.
 *
 * Route middleware is client-side and applied per-page via page meta
 * or globally when the filename includes ".global." before the extension.
 *
 * @param root - Project root directory
 */
export async function scanMiddleware(root: string): Promise<MiddlewareEntry[]> {
	const dir_middleware = path.join(root, "middleware");
	return scanDir(dir_middleware);
}

/**
 * Scan the server/middleware/ directory for server middleware files.
 *
 * Server middleware runs on every server request before route handlers.
 *
 * @param root - Project root directory
 */
export async function scanServerMiddleware(
	root: string,
): Promise<MiddlewareEntry[]> {
	const dir_server_middleware = path.join(root, "server", "middleware");
	return scanDir(dir_server_middleware);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Scan a directory for middleware files and return structured entries.
 */
async function scanDir(dir: string): Promise<MiddlewareEntry[]> {
	if (!fs.existsSync(dir)) return [];

	const entries: MiddlewareEntry[] = [];

	for await (const file of glob("**/*.{ts,js}", { cwd: dir })) {
		const filename = path.basename(file);
		const { name, is_global } = parseMiddlewareName(filename);

		entries.push({
			name,
			file_path: path.join(dir, file),
			global: is_global,
		});
	}

	return entries;
}

/**
 * Parse a middleware filename to extract the name and global flag.
 *
 * Examples:
 * - "auth.ts"        -> { name: "auth", is_global: false }
 * - "auth.global.ts" -> { name: "auth", is_global: true }
 * - "log.global.js"  -> { name: "log", is_global: true }
 */
function parseMiddlewareName(filename: string): {
	name: string;
	is_global: boolean;
} {
	// Strip extension
	const without_ext = filename.replace(/\.(ts|js)$/, "");

	// Check for .global suffix
	if (without_ext.endsWith(".global")) {
		return {
			name: without_ext.slice(0, -".global".length),
			is_global: true,
		};
	}

	return {
		name: without_ext,
		is_global: false,
	};
}
