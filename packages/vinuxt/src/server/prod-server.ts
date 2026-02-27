/**
 * Production HTTP server for vinuxt.
 *
 * Serves the output from `vinuxt build`:
 * - Static files from dist/client/ with appropriate cache headers
 * - SSR rendering via dist/server/entry.js for all other routes
 * - Gzip compression for text responses
 * - Manifest-based preload link injection
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { App } from "vue";
import { generateHtmlShell } from "./html.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProdServerOptions {
  port: number;
  host: string;
  outDir: string;
}

interface ViteManifestEntry {
  file: string;
  src?: string;
  css?: string[];
  imports?: string[];
  isEntry?: boolean;
}

type ViteManifest = Record<string, ViteManifestEntry>;

interface ServerEntry {
  createApp: (url: string) => Promise<{
    app: App;
    router: {
      currentRoute: { value: { matched: unknown[] } };
    };
    payload?: { serialize?: () => string };
  }>;
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

const COMPRESSIBLE_TYPES = new Set([
  "text/html",
  "text/css",
  "application/javascript",
  "application/json",
  "image/svg+xml",
  "application/xml",
  "text/plain",
  "application/manifest+json",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine MIME type from file extension. Falls back to
 * application/octet-stream for unknown extensions.
 */
function getMimeType(file_path: string): string {
  const ext = path.extname(file_path).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Check whether a MIME type should be gzip-compressed.
 */
function isCompressible(mime: string): boolean {
  const base_type = mime.split(";")[0].trim();
  return COMPRESSIBLE_TYPES.has(base_type);
}

/**
 * Check whether a URL path looks like a hashed asset (contains a hash
 * in the filename, e.g. /assets/index-abc123.js).
 */
function isHashedAsset(url_path: string): boolean {
  // Vite outputs hashed files as name-[hash].ext inside /assets/
  return url_path.startsWith("/assets/");
}

/**
 * Load and parse the Vite manifest from dist/client/.vite/manifest.json.
 * Returns an empty object if the manifest doesn't exist.
 */
function loadManifest(dir_client: string): ViteManifest {
  const path_manifest = path.join(dir_client, ".vite", "manifest.json");
  if (!fs.existsSync(path_manifest)) return {};

  const content = fs.readFileSync(path_manifest, "utf-8");
  return JSON.parse(content) as ViteManifest;
}

/**
 * Collect all preload links from the manifest for the client entry.
 *
 * Returns arrays of JS module and CSS file paths relative to dist/client/.
 */
function collectPreloadLinks(manifest: ViteManifest): {
  scripts: string[];
  styles: string[];
} {
  const scripts: string[] = [];
  const styles: string[] = [];
  const visited = new Set<string>();

  function walk(key: string): void {
    if (visited.has(key)) return;
    visited.add(key);

    const entry = manifest[key];
    if (!entry) return;

    scripts.push(`/${entry.file}`);

    if (entry.css) {
      for (const css_file of entry.css) {
        styles.push(`/${css_file}`);
      }
    }

    if (entry.imports) {
      for (const imported of entry.imports) {
        walk(imported);
      }
    }
  }

  // Find the entry point(s)
  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.isEntry) {
      walk(key);
    }
  }

  return { scripts, styles };
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

/**
 * Attempt to serve a static file from dir_client. Returns true if the file
 * was served, false if it doesn't exist (caller should fall through to SSR).
 */
async function serveStaticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url_path: string,
  dir_client: string,
): Promise<boolean> {
  // Prevent directory traversal
  const file_path = path.join(dir_client, path.normalize(url_path));
  if (!file_path.startsWith(dir_client)) {
    return false;
  }

  // Check if the file exists and is a regular file
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file_path);
  } catch {
    return false;
  }

  if (!stat.isFile()) return false;

  const mime = getMimeType(file_path);

  // Cache headers
  if (isHashedAsset(url_path)) {
    // Hashed assets are immutable -- cache forever
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    // Non-hashed files (HTML, manifest, etc.) -- revalidate always
    res.setHeader("Cache-Control", "no-cache");
  }

  res.setHeader("Content-Type", mime);

  // Gzip compression for text content
  const accepts_gzip = (req.headers["accept-encoding"] ?? "").includes("gzip");
  if (accepts_gzip && isCompressible(mime)) {
    res.setHeader("Content-Encoding", "gzip");
    res.statusCode = 200;
    const file_stream = fs.createReadStream(file_path);
    const gzip_stream = createGzip();
    await pipeline(file_stream, gzip_stream, res);
  } else {
    res.setHeader("Content-Length", stat.size);
    res.statusCode = 200;
    const file_stream = fs.createReadStream(file_path);
    await pipeline(file_stream, res);
  }

  return true;
}

// ---------------------------------------------------------------------------
// SSR rendering
// ---------------------------------------------------------------------------

/**
 * Render the requested URL via SSR and send the HTML response.
 */
async function renderSSR(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  server_entry: ServerEntry,
  preload: { scripts: string[]; styles: string[] },
): Promise<void> {
  const { renderToString } = await import("vue/server-renderer");

  const { app, router, payload } = await server_entry.createApp(url);

  // Check if route matched
  if (!router.currentRoute.value.matched.length) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>");
    return;
  }

  const app_html = await renderToString(app);
  const payload_json = payload?.serialize?.() ?? JSON.stringify({});

  const html = generateHtmlShell({
    head: "",
    appHtml: app_html,
    payload: payload_json,
    scripts: preload.scripts,
    styles: preload.styles,
  });

  const accepts_gzip = (req.headers["accept-encoding"] ?? "").includes("gzip");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");

  if (accepts_gzip) {
    res.setHeader("Content-Encoding", "gzip");
    res.statusCode = 200;
    const gzip_stream = createGzip();
    gzip_stream.pipe(res);
    gzip_stream.end(html);
    await new Promise<void>((resolve) => res.on("finish", resolve));
  } else {
    res.statusCode = 200;
    res.end(html);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the production HTTP server.
 *
 * Serves static files from dist/client/ and falls through to SSR
 * rendering for all other routes.
 */
export async function startProdServer(
  options: ProdServerOptions,
): Promise<http.Server> {
  const { port, host, outDir } = options;
  const dir_client = path.join(outDir, "client");
  const dir_server = path.join(outDir, "server");
  const path_entry = path.join(dir_server, "entry.js");

  // Validate build output exists
  if (!fs.existsSync(path_entry)) {
    console.error(
      `  Error: ${path_entry} not found.\n` +
        "  Run `vinuxt build` before `vinuxt start`.\n",
    );
    process.exit(1);
  }

  // Import the server entry
  const { pathToFileURL } = await import("node:url");
  const server_entry = (await import(
    /* @vite-ignore */ pathToFileURL(path_entry).href
  )) as ServerEntry;

  // Load the Vite manifest for preload link injection
  const manifest = loadManifest(dir_client);
  const preload = collectPreloadLinks(manifest);

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const url_path = new URL(url, `http://${host}`).pathname;

    try {
      // Try static files first
      const served = await serveStaticFile(req, res, url_path, dir_client);
      if (served) return;

      // Fall through to SSR
      await renderSSR(req, res, url, server_entry, preload);
    } catch (error) {
      console.error("  SSR Error:", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          "<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1></body></html>",
        );
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.log(`  Listening on http://${host}:${port}\n`);
      resolve(server);
    });
  });
}
