/**
 * TPR: Traffic-aware Pre-Rendering
 *
 * Uses Cloudflare zone analytics to determine which pages actually get
 * traffic, and pre-renders only those during deploy. The pre-rendered
 * HTML is uploaded to KV in the same format ISR uses at runtime -- no
 * runtime changes needed.
 *
 * Flow:
 *   1. Parse wrangler config to find custom domain and KV namespace
 *   2. Resolve the Cloudflare zone for the custom domain
 *   3. Query zone analytics (GraphQL) for top pages by request count
 *   4. Walk ranked list until coverage threshold is met
 *   5. Start the built production server locally
 *   6. Fetch each hot route to produce HTML
 *   7. Upload pre-rendered HTML to KV (same KVCacheEntry format ISR reads)
 *
 * TPR is an experimental feature enabled via --experimental-tpr. It
 * gracefully skips when no custom domain, no API token, no traffic data,
 * or no KV namespace is configured.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

// --- Types -------------------------------------------------------------------

export interface TPROptions {
	/** Project root directory. */
	root: string;
	/** Traffic coverage percentage (0-100). Default: 90. */
	coverage: number;
	/** Hard cap on number of pages to pre-render. Default: 1000. */
	limit: number;
	/** Analytics lookback window in hours. Default: 24. */
	window: number;
}

export interface TPRResult {
	/** Total unique page paths found in analytics. */
	total_paths: number;
	/** Number of pages successfully pre-rendered and uploaded. */
	prerendered_count: number;
	/** Actual traffic coverage achieved (percentage). */
	coverage_achieved: number;
	/** Wall-clock duration of the TPR step in milliseconds. */
	duration_ms: number;
	/** If TPR was skipped, the reason. */
	skipped?: string;
}

interface TrafficEntry {
	path: string;
	requests: number;
}

interface SelectedRoutes {
	routes: TrafficEntry[];
	total_requests: number;
	covered_requests: number;
	coverage_percent: number;
}

interface PrerenderResult {
	html: string;
	status: number;
	headers: Record<string, string>;
}

interface WranglerConfig {
	account_id?: string;
	kv_namespace_id?: string;
	custom_domain?: string;
}

// --- Wrangler Config Parsing -------------------------------------------------

/**
 * Parse wrangler config (TOML, JSONC, or JSON) to extract the fields TPR needs:
 * account_id, VINUXT_CACHE KV namespace ID, and custom domain.
 */
export function parseWranglerConfig(root: string): WranglerConfig | null {
	// Try TOML first (vinuxt generates wrangler.toml by default)
	const toml_path = path.join(root, "wrangler.toml");
	if (fs.existsSync(toml_path)) {
		const content = fs.readFileSync(toml_path, "utf-8");
		return extractFromTOML(content);
	}

	// Try JSONC / JSON
	for (const filename of ["wrangler.jsonc", "wrangler.json"]) {
		const filepath = path.join(root, filename);
		if (fs.existsSync(filepath)) {
			const content = fs.readFileSync(filepath, "utf-8");
			try {
				const json = JSON.parse(stripJsonComments(content));
				return extractFromJSON(json);
			} catch {
				continue;
			}
		}
	}

	return null;
}

/**
 * Strip single-line (//) and multi-line comments from JSONC while
 * preserving strings that contain slashes.
 */
function stripJsonComments(str: string): string {
	let result = "";
	let in_string = false;
	let in_single_line = false;
	let in_multi_line = false;
	let escape_next = false;

	for (let i = 0; i < str.length; i++) {
		const ch = str[i];
		const next = str[i + 1];

		if (escape_next) {
			if (!in_single_line && !in_multi_line) result += ch;
			escape_next = false;
			continue;
		}

		if (ch === "\\" && in_string) {
			result += ch;
			escape_next = true;
			continue;
		}

		if (in_single_line) {
			if (ch === "\n") {
				in_single_line = false;
				result += ch;
			}
			continue;
		}

		if (in_multi_line) {
			if (ch === "*" && next === "/") {
				in_multi_line = false;
				i++;
			}
			continue;
		}

		if (ch === '"' && !in_string) {
			in_string = true;
			result += ch;
			continue;
		}

		if (ch === '"' && in_string) {
			in_string = false;
			result += ch;
			continue;
		}

		if (!in_string && ch === "/" && next === "/") {
			in_single_line = true;
			i++;
			continue;
		}

		if (!in_string && ch === "/" && next === "*") {
			in_multi_line = true;
			i++;
			continue;
		}

		result += ch;
	}

	return result;
}

function extractFromJSON(config: Record<string, unknown>): WranglerConfig {
	const result: WranglerConfig = {};

	// account_id
	if (typeof config.account_id === "string") {
		result.account_id = config.account_id;
	}

	// KV namespace ID for VINUXT_CACHE
	if (Array.isArray(config.kv_namespaces)) {
		const vinuxt_kv = config.kv_namespaces.find(
			(ns: Record<string, unknown>) =>
				ns && typeof ns === "object" && ns.binding === "VINUXT_CACHE",
		);
		if (
			vinuxt_kv &&
			typeof vinuxt_kv.id === "string" &&
			vinuxt_kv.id !== "<your-kv-namespace-id>"
		) {
			result.kv_namespace_id = vinuxt_kv.id;
		}
	}

	// Custom domain -- check routes[] and custom_domains[]
	const domain =
		extractDomainFromRoutes(config.routes) ??
		extractDomainFromCustomDomains(config);
	if (domain) result.custom_domain = domain;

	return result;
}

function extractDomainFromRoutes(routes: unknown): string | null {
	if (!Array.isArray(routes)) return null;

	for (const route of routes) {
		if (typeof route === "string") {
			const domain = cleanDomain(route);
			if (domain && !domain.includes("workers.dev")) return domain;
		} else if (route && typeof route === "object") {
			const r = route as Record<string, unknown>;
			const pattern =
				typeof r.zone_name === "string"
					? r.zone_name
					: typeof r.pattern === "string"
						? r.pattern
						: null;
			if (pattern) {
				const domain = cleanDomain(pattern);
				if (domain && !domain.includes("workers.dev")) return domain;
			}
		}
	}
	return null;
}

function extractDomainFromCustomDomains(config: Record<string, unknown>): string | null {
	// Workers Custom Domains: "custom_domains": ["example.com"]
	if (Array.isArray(config.custom_domains)) {
		for (const d of config.custom_domains) {
			if (typeof d === "string" && !d.includes("workers.dev")) {
				return cleanDomain(d);
			}
		}
	}
	return null;
}

/** Strip protocol and trailing wildcards from a route pattern to get a bare domain. */
function cleanDomain(raw: string): string | null {
	const cleaned = raw
		.replace(/^https?:\/\//, "")
		.replace(/\/\*$/, "")
		.replace(/\/+$/, "")
		.split("/")[0]; // Take only the host part
	return cleaned || null;
}

/**
 * Simple extraction of specific fields from wrangler.toml content.
 * Not a full TOML parser -- just enough for the fields we need.
 */
function extractFromTOML(content: string): WranglerConfig {
	const result: WranglerConfig = {};

	// account_id = "..."
	const account_match = content.match(/^account_id\s*=\s*"([^"]+)"/m);
	if (account_match) result.account_id = account_match[1];

	// KV namespace with binding = "VINUXT_CACHE"
	// Look for [[kv_namespaces]] blocks
	const kv_blocks = content.split(/\[\[kv_namespaces\]\]/);
	for (let i = 1; i < kv_blocks.length; i++) {
		const block = kv_blocks[i].split(/\[\[/)[0]; // Take until next section
		const binding_match = block.match(/binding\s*=\s*"([^"]+)"/);
		const id_match = block.match(/\bid\s*=\s*"([^"]+)"/);
		if (
			binding_match?.[1] === "VINUXT_CACHE" &&
			id_match?.[1] &&
			id_match[1] !== "<your-kv-namespace-id>"
		) {
			result.kv_namespace_id = id_match[1];
		}
	}

	// routes -- both string and table forms
	// route = "example.com/*"
	const route_match = content.match(/^route\s*=\s*"([^"]+)"/m);
	if (route_match) {
		const domain = cleanDomain(route_match[1]);
		if (domain && !domain.includes("workers.dev")) {
			result.custom_domain = domain;
		}
	}

	// [[routes]] blocks
	if (!result.custom_domain) {
		const route_blocks = content.split(/\[\[routes\]\]/);
		for (let i = 1; i < route_blocks.length; i++) {
			const block = route_blocks[i].split(/\[\[/)[0];
			const pattern_match = block.match(/pattern\s*=\s*"([^"]+)"/);
			if (pattern_match) {
				const domain = cleanDomain(pattern_match[1]);
				if (domain && !domain.includes("workers.dev")) {
					result.custom_domain = domain;
					break;
				}
			}
		}
	}

	return result;
}

// --- Cloudflare API ----------------------------------------------------------

/** Resolve zone ID from a domain name via the Cloudflare API. */
async function resolveZoneId(
	domain: string,
	api_token: string,
): Promise<string | null> {
	// Extract the registrable domain (e.g., "shop.example.com" -> "example.com").
	const parts = domain.split(".");
	const MULTI_PART_TLDS = [
		"co.uk", "com.br", "com.au", "co.jp", "co.kr", "co.nz",
		"co.za", "com.mx", "com.ar", "com.cn", "org.uk", "net.au",
	];
	const last_two = parts.slice(-2).join(".");
	let root_domain: string;
	if (MULTI_PART_TLDS.includes(last_two) && parts.length > 2) {
		root_domain = parts.slice(-3).join(".");
	} else {
		root_domain = parts.length > 2 ? parts.slice(-2).join(".") : domain;
	}

	const response = await fetch(
		`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(root_domain)}`,
		{
			headers: {
				Authorization: `Bearer ${api_token}`,
				"Content-Type": "application/json",
			},
		},
	);

	if (!response.ok) return null;

	const data = (await response.json()) as {
		success: boolean;
		result?: Array<{ id: string }>;
	};
	if (!data.success || !data.result?.length) return null;

	return data.result[0].id;
}

/** Resolve the account ID associated with the API token. */
async function resolveAccountId(api_token: string): Promise<string | null> {
	const response = await fetch(
		"https://api.cloudflare.com/client/v4/accounts?per_page=1",
		{
			headers: {
				Authorization: `Bearer ${api_token}`,
				"Content-Type": "application/json",
			},
		},
	);

	if (!response.ok) return null;

	const data = (await response.json()) as {
		success: boolean;
		result?: Array<{ id: string }>;
	};
	if (!data.success || !data.result?.length) return null;

	return data.result[0].id;
}

// --- Traffic Querying --------------------------------------------------------

/**
 * Query Cloudflare zone analytics for top page paths by request count
 * over the given time window.
 */
async function queryTraffic(
	zone_tag: string,
	api_token: string,
	window_hours: number,
): Promise<TrafficEntry[]> {
	const now = new Date();
	const start = new Date(now.getTime() - window_hours * 60 * 60 * 1000);

	const query = `{
    viewer {
      zones(filter: { zoneTag: "${zone_tag}" }) {
        httpRequestsAdaptiveGroups(
          limit: 10000
          orderBy: [sum_requests_DESC]
          filter: {
            datetime_geq: "${start.toISOString()}"
            datetime_lt: "${now.toISOString()}"
            requestSource: "eyeball"
          }
        ) {
          sum { requests }
          dimensions { clientRequestPath }
        }
      }
    }
  }`;

	const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${api_token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query }),
	});

	if (!response.ok) {
		throw new Error(
			`Zone analytics query failed: ${response.status} ${response.statusText}`,
		);
	}

	const data = (await response.json()) as {
		errors?: Array<{ message: string }>;
		data?: {
			viewer?: {
				zones?: Array<{
					httpRequestsAdaptiveGroups?: Array<{
						sum: { requests: number };
						dimensions: { clientRequestPath: string };
					}>;
				}>;
			};
		};
	};

	if (data.errors?.length) {
		throw new Error(`Zone analytics error: ${data.errors[0].message}`);
	}

	const groups = data.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups;
	if (!groups || groups.length === 0) return [];

	return filterTrafficPaths(
		groups.map((g) => ({
			path: g.dimensions.clientRequestPath,
			requests: g.sum.requests,
		})),
	);
}

/** Filter out non-page requests (static assets, API routes, internal routes). */
function filterTrafficPaths(entries: TrafficEntry[]): TrafficEntry[] {
	return entries.filter((e) => {
		if (!e.path.startsWith("/")) return false;
		// Static assets
		if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|webp|avif)$/i.test(e.path))
			return false;
		// API routes
		if (e.path.startsWith("/api/")) return false;
		// Internal routes
		if (e.path.startsWith("/_vinuxt/") || e.path.startsWith("/_nuxt/")) return false;
		return true;
	});
}

// --- Route Selection ---------------------------------------------------------

/**
 * Walk the ranked traffic list, accumulating request counts until the
 * coverage target is met or the hard cap is reached.
 */
export function selectRoutes(
	traffic: TrafficEntry[],
	coverage_target: number,
	limit: number,
): SelectedRoutes {
	const total_requests = traffic.reduce((sum, e) => sum + e.requests, 0);
	if (total_requests === 0) {
		return { routes: [], total_requests: 0, covered_requests: 0, coverage_percent: 0 };
	}

	const target = total_requests * (coverage_target / 100);
	const selected: TrafficEntry[] = [];
	let accumulated = 0;

	// Traffic is already sorted DESC by requests from the GraphQL query
	for (const entry of traffic) {
		if (accumulated >= target || selected.length >= limit) break;
		selected.push(entry);
		accumulated += entry.requests;
	}

	return {
		routes: selected,
		total_requests,
		covered_requests: accumulated,
		coverage_percent: (accumulated / total_requests) * 100,
	};
}

// --- Pre-rendering -----------------------------------------------------------

/** Pre-render port -- high number to avoid collisions with dev servers. */
const PRERENDER_PORT = 19384;

/** Max time to wait for the local server to start (ms). */
const SERVER_STARTUP_TIMEOUT = 30_000;

/** Max concurrent fetch requests during pre-rendering. */
const FETCH_CONCURRENCY = 10;

/**
 * Start a local production server, fetch each route to produce HTML,
 * and return the results. Pages that fail to render are skipped.
 */
async function prerenderRoutes(
	routes: string[],
	root: string,
	host_domain?: string,
): Promise<Map<string, PrerenderResult>> {
	const results = new Map<string, PrerenderResult>();
	let failed_count = 0;
	const port = PRERENDER_PORT;

	// Verify dist/ exists
	const dist_dir = path.join(root, "dist");
	if (!fs.existsSync(dist_dir)) {
		console.log("  TPR: Skipping pre-render -- dist/ directory not found");
		return results;
	}

	// Start the local production server as a subprocess
	const server_process = startLocalServer(root, port);

	try {
		await waitForServer(port, SERVER_STARTUP_TIMEOUT);

		// Fetch routes in batches to limit concurrency
		for (let i = 0; i < routes.length; i += FETCH_CONCURRENCY) {
			const batch = routes.slice(i, i + FETCH_CONCURRENCY);
			const promises = batch.map(async (route_path) => {
				try {
					const response = await fetch(`http://127.0.0.1:${port}${route_path}`, {
						headers: {
							"User-Agent": "vinuxt-tpr/1.0",
							...(host_domain ? { Host: host_domain } : {}),
						},
						redirect: "manual", // Don't follow redirects -- cache the redirect itself
					});

					// Only cache successful responses (2xx and 3xx)
					if (response.status < 400) {
						const html = await response.text();
						const headers: Record<string, string> = {};
						response.headers.forEach((value, key) => {
							// Only keep relevant headers
							if (
								key === "content-type" ||
								key === "cache-control" ||
								key === "x-vinuxt-revalidate" ||
								key === "location"
							) {
								headers[key] = value;
							}
						});
						results.set(route_path, {
							html,
							status: response.status,
							headers,
						});
					}
				} catch {
					// Skip pages that fail to render -- they may depend on
					// request-specific data (cookies, headers, auth) that
					// isn't available during pre-rendering.
					failed_count++;
				}
			});

			await Promise.all(promises);
		}

		if (failed_count > 0) {
			console.log(`  TPR: ${failed_count} page(s) failed to pre-render (skipped)`);
		}
	} finally {
		server_process.kill("SIGTERM");
		// Give it a moment to clean up
		await new Promise<void>((resolve) => {
			server_process.on("exit", resolve);
			setTimeout(resolve, 2000);
		});
	}

	return results;
}

/**
 * Spawn a subprocess running the vinuxt production server.
 * Uses the same Node.js binary and resolves prod-server.js relative
 * to the current module (works whether vinuxt is installed or linked).
 */
function startLocalServer(root: string, port: number): ChildProcess {
	const this_dir = fileURLToPath(new URL(".", import.meta.url));
	const prod_server_path = path.resolve(this_dir, "..", "server", "prod-server.js");
	const out_dir = path.join(root, "dist");

	// Escape backslashes for Windows paths inside the JS string
	const escaped_prod_server = prod_server_path.replace(/\\/g, "\\\\");
	const escaped_out_dir = out_dir.replace(/\\/g, "\\\\");

	const script = [
		`import("file://${escaped_prod_server}")`,
		`.then(m => m.startProdServer({ port: ${port}, host: "127.0.0.1", outDir: "${escaped_out_dir}" }))`,
		`.catch(e => { console.error("[vinuxt-tpr] Server failed to start:", e); process.exit(1); });`,
	].join("");

	const proc = spawn(process.execPath, ["--input-type=module", "-e", script], {
		cwd: root,
		stdio: "pipe",
		env: { ...process.env, NODE_ENV: "production" },
	});

	// Forward server errors to the parent's stderr for debugging
	proc.stderr?.on("data", (chunk: Buffer) => {
		const msg = chunk.toString().trim();
		if (msg) console.error(`  [tpr-server] ${msg}`);
	});

	return proc;
}

/** Poll the local server until it responds or the timeout is reached. */
async function waitForServer(port: number, timeout_ms: number): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout_ms) {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 2000);
			const response = await fetch(`http://127.0.0.1:${port}/`, {
				redirect: "manual",
				signal: controller.signal,
			});
			clearTimeout(timer);
			// Any response means the server is up
			await response.text(); // consume body
			return;
		} catch {
			await new Promise<void>((r) => setTimeout(r, 300));
		}
	}
	throw new Error(
		`Local production server failed to start within ${timeout_ms / 1000}s`,
	);
}

// --- KV Upload ---------------------------------------------------------------

/**
 * Upload pre-rendered pages to KV using the Cloudflare REST API.
 * Writes in the same KVCacheEntry format that KVCacheHandler reads
 * at runtime, so ISR serves these entries without any code changes.
 */
async function uploadToKV(
	entries: Map<string, PrerenderResult>,
	namespace_id: string,
	account_id: string,
	api_token: string,
	default_revalidate_seconds: number,
): Promise<void> {
	const now = Date.now();

	// Build the bulk write payload
	const pairs: Array<{
		key: string;
		value: string;
		expiration_ttl?: number;
	}> = [];

	for (const [route_path, result] of entries) {
		// Determine revalidation window -- use the page's revalidate header
		// if present, otherwise fall back to the default
		const revalidate_header = result.headers["x-vinuxt-revalidate"];
		const revalidate_seconds =
			revalidate_header && !isNaN(Number(revalidate_header))
				? Number(revalidate_header)
				: default_revalidate_seconds;

		const revalidate_at =
			revalidate_seconds > 0 ? now + revalidate_seconds * 1000 : null;

		// KV TTL: 10x the revalidation period, clamped to [60s, 30d]
		// (matches the logic in KVCacheHandler.set)
		const kv_ttl =
			revalidate_seconds > 0
				? Math.max(Math.min(revalidate_seconds * 10, 30 * 24 * 3600), 60)
				: 24 * 3600; // 24h fallback if no revalidation

		const entry = {
			value: {
				kind: "PAGE" as const,
				html: result.html,
				headers: result.headers,
				status: result.status,
			},
			tags: [] as string[],
			last_modified: now,
			revalidate_at,
		};

		pairs.push({
			key: `cache:${route_path}`,
			value: JSON.stringify(entry),
			expiration_ttl: kv_ttl,
		});
	}

	// Upload in batches (KV bulk API accepts up to 10,000 per request)
	const BATCH_SIZE = 10_000;
	for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
		const batch = pairs.slice(i, i + BATCH_SIZE);
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${account_id}/storage/kv/namespaces/${namespace_id}/bulk`,
			{
				method: "PUT",
				headers: {
					Authorization: `Bearer ${api_token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(batch),
			},
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				`KV bulk upload failed (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${response.status} -- ${text}`,
			);
		}
	}
}

// --- Main Entry --------------------------------------------------------------

/** Default revalidation TTL for pre-rendered pages (1 hour). */
const DEFAULT_REVALIDATE_SECONDS = 3600;

/**
 * Run the TPR pipeline: query traffic, select routes, pre-render, upload.
 *
 * Designed to be called between the build step and wrangler deploy in
 * the `vinuxt deploy` pipeline. Gracefully skips (never errors) when
 * the prerequisites aren't met.
 */
export async function runTPR(options: TPROptions): Promise<TPRResult> {
	const time_start = Date.now();
	const { root, coverage, limit, window: window_hours } = options;

	const skip = (reason: string): TPRResult => ({
		total_paths: 0,
		prerendered_count: 0,
		coverage_achieved: 0,
		duration_ms: Date.now() - time_start,
		skipped: reason,
	});

	// 1. Check for API token
	const api_token = process.env.CLOUDFLARE_API_TOKEN;
	if (!api_token) {
		return skip("no CLOUDFLARE_API_TOKEN set");
	}

	// 2. Parse wrangler config
	const wrangler_config = parseWranglerConfig(root);
	if (!wrangler_config) {
		return skip("could not parse wrangler config");
	}

	// 3. Check for custom domain
	if (!wrangler_config.custom_domain) {
		return skip("no custom domain -- zone analytics unavailable");
	}

	// 4. Check for KV namespace
	if (!wrangler_config.kv_namespace_id) {
		return skip("no VINUXT_CACHE KV namespace configured");
	}

	// 5. Resolve account ID
	const account_id = wrangler_config.account_id ?? (await resolveAccountId(api_token));
	if (!account_id) {
		return skip("could not resolve Cloudflare account ID");
	}

	// 6. Resolve zone ID
	console.log(`  TPR: Analyzing traffic for ${wrangler_config.custom_domain} (last ${window_hours}h)`);

	const zone_id = await resolveZoneId(wrangler_config.custom_domain, api_token);
	if (!zone_id) {
		return skip(
			`could not resolve zone for ${wrangler_config.custom_domain}`,
		);
	}

	// 7. Query traffic data
	let traffic: TrafficEntry[];
	try {
		traffic = await queryTraffic(zone_id, api_token, window_hours);
	} catch (err) {
		return skip(
			`analytics query failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (traffic.length === 0) {
		return skip("no traffic data available (first deploy?)");
	}

	// 8. Select routes by coverage
	const selection = selectRoutes(traffic, coverage, limit);

	console.log(
		`  TPR: ${traffic.length.toLocaleString()} unique paths -- ` +
		`${selection.routes.length} pages cover ${Math.round(selection.coverage_percent)}% of traffic`,
	);

	if (selection.routes.length === 0) {
		return {
			total_paths: traffic.length,
			prerendered_count: 0,
			coverage_achieved: 0,
			duration_ms: Date.now() - time_start,
			skipped: "no pre-renderable routes after filtering",
		};
	}

	// 9. Pre-render selected routes
	console.log(`  TPR: Pre-rendering ${selection.routes.length} pages...`);

	const route_paths = selection.routes.map((r) => r.path);
	let rendered: Map<string, PrerenderResult>;
	try {
		rendered = await prerenderRoutes(route_paths, root, wrangler_config.custom_domain);
	} catch (err) {
		return skip(
			`pre-rendering failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (rendered.size === 0) {
		return {
			total_paths: traffic.length,
			prerendered_count: 0,
			coverage_achieved: selection.coverage_percent,
			duration_ms: Date.now() - time_start,
			skipped: "all pages failed to pre-render (request-dependent?)",
		};
	}

	// 10. Upload to KV
	try {
		await uploadToKV(
			rendered,
			wrangler_config.kv_namespace_id,
			account_id,
			api_token,
			DEFAULT_REVALIDATE_SECONDS,
		);
	} catch (err) {
		return skip(
			`KV upload failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const duration_ms = Date.now() - time_start;
	console.log(
		`  TPR: Pre-rendered ${rendered.size} pages in ${(duration_ms / 1000).toFixed(1)}s -> KV cache`,
	);

	return {
		total_paths: traffic.length,
		prerendered_count: rendered.size,
		coverage_achieved: selection.coverage_percent,
		duration_ms,
	};
}
