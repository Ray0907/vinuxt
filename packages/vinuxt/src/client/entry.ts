/**
 * Client-side hydration entry point.
 *
 * This module is NOT directly bundled -- its logic is code-generated as
 * the virtual:vinuxt-client-entry module. This file serves as the
 * reference implementation and type-safe source of truth.
 *
 * The generated code:
 * 1. Creates a Vue SSR app with createSSRApp
 * 2. Sets up vue-router with createWebHistory
 * 3. Reads window.__VINUXT_DATA__ for hydration payload
 * 4. Waits for router.isReady() then mounts on #__nuxt
 */

export {};

// The actual client entry is generated as a virtual module in index.ts.
// See generateClientEntry() for the code that runs in the browser.
