/**
 * Image optimization HTTP handler for the /_vinuxt/image endpoint.
 *
 * Supports on-the-fly image resizing, format conversion, and quality
 * adjustment. Uses sharp when available (optional peer dependency),
 * otherwise passes through the original image unchanged.
 *
 * Query parameters:
 *   url  (required)  - Image path (relative) or external URL
 *   w    (optional)  - Target width in pixels
 *   q    (optional)  - Quality 1-100, default 75
 *   f    (optional)  - Output format: webp, avif, jpeg, png
 *
 * Security:
 *   - Only relative paths and configured external domains are allowed
 *   - SSRF prevention: rejects private/internal IPs and non-http(s) schemes
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageOptimizationOptions {
  /** Project root or dist/client root for resolving relative paths */
  publicDir: string;
  /** Allowed external image domains (e.g. ["images.unsplash.com"]) */
  allowedDomains?: string[];
  /** Whether we are in development mode */
  isDev?: boolean;
}

interface ImageParams {
  url: string;
  width: number | null;
  quality: number;
  format: "webp" | "avif" | "jpeg" | "png" | null;
}

// ---------------------------------------------------------------------------
// Content-Type mapping
// ---------------------------------------------------------------------------

const FORMAT_MIME: Record<string, string> = {
  webp: "image/webp",
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
};

const EXT_MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Private/internal IP ranges to block for SSRF prevention */
const BLOCKED_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fd/i,
  /^fe80/i,
  /^localhost$/i,
];

/**
 * Validate and parse the image URL parameter.
 * Returns null if the URL is invalid or not allowed.
 */
function validateUrl(
  raw_url: string,
  allowed_domains: string[],
):
  | { type: "relative"; path: string }
  | { type: "external"; url: string }
  | null {
  // Relative path
  if (raw_url.startsWith("/")) {
    // Prevent directory traversal
    const normalized = path.normalize(raw_url);
    if (normalized.includes("..")) return null;
    return { type: "relative", path: normalized };
  }

  // Absolute URL
  let parsed: URL;
  try {
    parsed = new URL(raw_url);
  } catch {
    return null;
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  // Block private/internal IPs
  const hostname = parsed.hostname;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(hostname)) return null;
  }

  // Check allowed domains
  if (allowed_domains.length > 0) {
    const is_allowed = allowed_domains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    if (!is_allowed) return null;
  }

  return { type: "external", url: raw_url };
}

/**
 * Parse query parameters from the request URL.
 */
function parseImageParams(url: string): ImageParams | null {
  const parsed = new URL(url, "http://localhost");
  const raw_url = parsed.searchParams.get("url");

  if (!raw_url) return null;

  const width_raw = parsed.searchParams.get("w");
  const width = width_raw ? parseInt(width_raw, 10) : null;
  if (width !== null && (isNaN(width) || width < 1 || width > 8192)) {
    return null;
  }

  const quality_raw = parsed.searchParams.get("q");
  const quality = quality_raw ? parseInt(quality_raw, 10) : 75;
  if (isNaN(quality) || quality < 1 || quality > 100) {
    return null;
  }

  const format_raw = parsed.searchParams.get("f");
  const valid_formats = new Set(["webp", "avif", "jpeg", "png"]);
  const format =
    format_raw && valid_formats.has(format_raw)
      ? (format_raw as ImageParams["format"])
      : null;

  return { url: raw_url, width, quality, format };
}

// ---------------------------------------------------------------------------
// Sharp integration (optional)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpInstance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpFactory = (input: Buffer) => SharpInstance;

let _sharp: SharpFactory | null | false = null;

/**
 * Try to load sharp. Returns the factory function or null if not available.
 * Caches the result so we only attempt once.
 */
async function loadSharp(): Promise<SharpFactory | null> {
  if (_sharp === false) return null;
  if (_sharp !== null) return _sharp;

  try {
    // sharp is an optional peer dependency -- may not be installed.
    // Use a variable to prevent TypeScript from resolving the module at compile time.
    const pkg_name = "sharp";
    const mod = await import(/* @vite-ignore */ pkg_name);
    _sharp = (mod.default ?? mod) as SharpFactory;
    return _sharp;
  } catch {
    _sharp = false;
    return null;
  }
}

/**
 * Optimize an image buffer using sharp.
 */
async function optimizeWithSharp(
  buffer: Buffer,
  params: ImageParams,
): Promise<{ data: Buffer; content_type: string }> {
  const sharp = await loadSharp();
  if (!sharp) {
    // Fallback: return original
    const ext = path.extname(params.url).toLowerCase();
    const content_type = EXT_MIME[ext] ?? "application/octet-stream";
    return { data: buffer, content_type };
  }

  let pipeline = sharp(buffer);

  if (params.width) {
    pipeline = pipeline.resize(params.width);
  }

  const format = params.format ?? "webp";
  switch (format) {
    case "webp":
      pipeline = pipeline.webp({ quality: params.quality });
      break;
    case "avif":
      pipeline = pipeline.avif({ quality: params.quality });
      break;
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: params.quality });
      break;
    case "png":
      pipeline = pipeline.png();
      break;
  }

  const data = await pipeline.toBuffer();
  const content_type = FORMAT_MIME[format] ?? "image/webp";
  return { data, content_type };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an HTTP request handler for the /_vinuxt/image endpoint.
 *
 * In development mode, proxies the original image with appropriate headers.
 * In production, uses sharp (if available) for resizing and format conversion,
 * with a passthrough fallback.
 */
export function createImageHandler(
  options: ImageOptimizationOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { publicDir, allowedDomains = [], isDev = false } = options;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? "/";

    // Parse parameters
    const params = parseImageParams(url);
    if (!params) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid parameters. Required: url" }));
      return;
    }

    // Validate URL
    const validated = validateUrl(params.url, allowedDomains);
    if (!validated) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "URL not allowed" }));
      return;
    }

    try {
      let buffer: Buffer;

      if (validated.type === "relative") {
        // Serve from local filesystem
        const file_path = path.join(publicDir, validated.path);

        // Double-check no traversal past publicDir
        if (!file_path.startsWith(publicDir)) {
          res.statusCode = 403;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Path not allowed" }));
          return;
        }

        if (!fs.existsSync(file_path)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Image not found" }));
          return;
        }

        buffer = fs.readFileSync(file_path);
      } else {
        // Fetch external image
        const response = await fetch(validated.url);
        if (!response.ok) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: `Failed to fetch image: ${response.status}`,
            }),
          );
          return;
        }
        buffer = Buffer.from(await response.arrayBuffer());
      }

      // In dev mode or if no transforms needed, passthrough
      if (isDev || (!params.width && !params.format)) {
        const ext = path.extname(params.url).toLowerCase();
        const content_type = EXT_MIME[ext] ?? "application/octet-stream";
        res.statusCode = 200;
        res.setHeader("Content-Type", content_type);
        res.setHeader(
          "Cache-Control",
          isDev ? "no-cache" : "public, max-age=31536000, immutable",
        );
        res.end(buffer);
        return;
      }

      // Optimize with sharp (or passthrough if not available)
      const result = await optimizeWithSharp(buffer, params);

      res.statusCode = 200;
      res.setHeader("Content-Type", result.content_type);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.end(result.data);
    } catch (error) {
      console.error("  Image optimization error:", error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  };
}

// Re-export for testing
export { parseImageParams, validateUrl };
