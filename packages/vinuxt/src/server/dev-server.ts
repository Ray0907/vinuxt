/**
 * SSR request handler for the Vite dev server.
 *
 * For each request:
 * 1. Load virtual:vinuxt-server-entry via Vite's SSR module loader
 * 2. Create a Vue app + router for the requested URL
 * 3. Wait for the router to be ready
 * 4. Render the app to an HTML string with renderToString
 * 5. Wrap in the HTML shell with __VINUXT_DATA__ payload
 * 6. Apply Vite's HTML transforms (HMR client, CSS injection)
 * 7. Send the response
 */

import type { ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { generateHtmlShell } from "./html.js";

export function createSSRHandler(server: ViteDevServer) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> => {
    const url = req.originalUrl || "/";

    try {
      // 1. Load the server entry via Vite's SSR module loader
      const { createApp } = await server.ssrLoadModule(
        "virtual:vinuxt-server-entry",
      );

      // 2. Create app for this request
      const { app, router, payload } = await createApp(url);

      // 3. Wait for router to resolve
      await router.isReady();

      // 4. Check if route matched
      if (!router.currentRoute.value.matched.length) {
        return next(); // Let Vite handle 404 / static files
      }

      // 5. Render to string
      const { renderToString } = await import("vue/server-renderer");
      const app_html = await renderToString(app);

      // 6. Serialize payload (composables populate it during render)
      const payload_json = payload?.serialize?.() ?? JSON.stringify({});

      // 7. Generate HTML shell
      const html = generateHtmlShell({
        head: "",
        appHtml: app_html,
        payload: payload_json,
        scripts: ["virtual:vinuxt-client-entry"],
        styles: [],
      });

      // 8. Apply Vite's HTML transforms (injects HMR client, CSS, etc.)
      const html_transformed = await server.transformIndexHtml(
        url,
        html,
        req.originalUrl,
      );

      // 9. Send response
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html_transformed);
    } catch (e) {
      server.ssrFixStacktrace(e as Error);
      console.error(e);
      next(e);
    }
  };
}
