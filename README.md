# vinuxt

The Nuxt API surface, reimplemented on Vite.

> **Experimental -- under heavy development.** Inspired by Cloudflare's [vinext](https://github.com/cloudflare/vinext) (Next.js on Vite), vinuxt does the same for Nuxt. The vast majority of the code was written by AI (Claude Code). Treat this accordingly -- there will be bugs, rough edges, and things that don't work. Use at your own risk.

## Quick start

```bash
pnpm add -D vinuxt vite
```

Replace `nuxt` with `vinuxt` in your scripts:

```json
{
  "scripts": {
    "dev": "vinuxt dev",
    "build": "vinuxt build",
    "start": "vinuxt start"
  }
}
```

```bash
vinuxt dev          # Development server with HMR
vinuxt build        # Production build
vinuxt start        # Start local production server
vinuxt deploy       # Build and deploy to Cloudflare Workers
```

vinuxt auto-detects your `pages/`, `layouts/`, `composables/`, and `server/` directories, loads `nuxt.config.ts`, and configures Vite automatically.

### Migrating an existing Nuxt project

```bash
npx vinuxt init
```

This will:

1. Run `vinuxt check` to scan for compatibility issues
2. Install `vite` as a devDependency
3. Add `"type": "module"` to `package.json`
4. Add `dev:vinuxt`, `build:vinuxt`, `start:vinuxt` scripts
5. Generate a minimal `vite.config.ts`

The migration is non-destructive -- your existing Nuxt setup continues to work alongside vinuxt.

```bash
pnpm run dev:vinuxt    # Start the vinuxt dev server
pnpm run dev           # Still runs Nuxt as before
```

### CLI reference

| Command | Description |
|---------|-------------|
| `vinuxt dev` | Start dev server with HMR |
| `vinuxt build` | Production build (client + server SSR) |
| `vinuxt start` | Start local production server |
| `vinuxt deploy` | Build and deploy to Cloudflare Workers |
| `vinuxt init` | Migrate a Nuxt project to run under vinuxt |
| `vinuxt check` | Scan your Nuxt app for compatibility issues |
| `vinuxt lint` | Delegate to oxlint |

Options: `-p / --port <port>`, `-H / --hostname <host>`.

`vinuxt deploy` options: `--preview`, `--env <name>`, `--name <name>`, `--skip-build`, `--dry-run`, `--experimental-tpr`.

## Benchmarks

> Measured on Apple M4 Pro, Node.js 22, pnpm 10. Same 3-page fixture app (index, about, dynamic `[id]`) with layouts, composables, and server API routes. Vitest bench, 3+ samples per metric. Take these as directional, not definitive.

### Dev server cold start

| Framework | Mean | Speedup |
|-----------|------|---------|
| **vinuxt** | **1,671 ms** | -- |
| Nuxt 4.3.1 | 2,143 ms | 1.3x slower |

### SSR throughput (warm, req/s)

| Route | vinuxt | Nuxt 4.3.1 | Speedup |
|-------|--------|------------|---------|
| `GET /` | **1,092 req/s** | 361 req/s | **3.0x** |
| `GET /about` | **1,228 req/s** | 349 req/s | **3.5x** |
| `GET /posts/1` | **1,385 req/s** | 382 req/s | **3.6x** |

### Production build

| Framework | Mean | Speedup |
|-----------|------|---------|
| **vinuxt** | **2,216 ms** | -- |
| Nuxt 4.3.1 | 3,835 ms | 1.7x slower |

### Client bundle size (gzip)

| | vinuxt | Nuxt 4.3.1 | Ratio |
|---|--------|------------|-------|
| JS | **45.2 KB** | 68.5 KB | **1.5x smaller** |
| CSS | 1.8 KB | 2.5 KB | comparable |
| **Total** | **47.0 KB** | **71.0 KB** | **1.5x smaller** |

Nuxt ships more client-side infrastructure (Nitro runtime, error pages, payload extraction). vinuxt's lighter runtime and Vite/Rollup's tree-shaking produce a smaller bundle.

Reproduce with `pnpm bench`.

## What's supported

### Nuxt conventions

| Feature | Status | Notes |
|---------|--------|-------|
| File-based routing (`pages/`) | Yes | Dynamic `[param]`, catch-all `[...slug]`, nested routes |
| Layouts (`layouts/`) | Yes | `default.vue`, named layouts via `definePageMeta` |
| Auto-imports | Yes | Composables and utilities auto-imported via `unimport` |
| Composables | Yes | `useAsyncData`, `useFetch`, `useState`, `useRuntimeConfig`, `useCookie`, `useRoute`, `useRouter`, `useHead`, `useError`, `createError`, `navigateTo` |
| Server API routes (`server/api/`) | Yes | File-based, supports `defineEventHandler` |
| Middleware | Yes | Global and per-page, `defineNuxtRouteMiddleware` |
| `definePageMeta` | Yes | `layout`, `middleware`, `name`, `path` |
| `NuxtLink` | Yes | SPA navigation, `<RouterLink>` wrapper |
| `NuxtImg` | Yes | Via `@unpic/vue` |
| `NuxtLoadingIndicator` | Yes | Loading bar on navigation |
| Runtime config | Yes | `useRuntimeConfig`, `nuxt.config.ts` `runtimeConfig` |
| `.env` loading | Yes | Next.js-style dotenv loading with mode support |
| SSR + hydration | Yes | Full server-side rendering with client hydration |
| `<head>` management | Yes | Via `@unhead/vue` |

### Cloudflare deployment

| Feature | Status | Notes |
|---------|--------|-------|
| `vinuxt deploy` | Yes | Auto-generates wrangler.toml, worker entry, builds and deploys |
| KV cache (ISR) | Yes | `KVCacheHandler` for Incremental Static Regeneration |
| TPR (Traffic-aware Pre-Rendering) | Yes | Queries zone analytics, pre-renders hot routes to KV |
| Preview environments | Yes | `--preview` or `--env <name>` |
| Dependency auto-install | Yes | Installs `wrangler` if missing |

## Architecture

vinuxt is a Vite plugin that:

1. **Scans your `pages/` directory** to build a file-system router matching Nuxt conventions.
2. **Auto-imports composables** via `unimport`, providing the same DX as Nuxt.
3. **Generates virtual entry modules** for SSR and client hydration -- `vue-router` handles routing, `@unhead/vue` handles `<head>`.
4. **Serves with full SSR** in dev and production -- Vite's middleware mode handles requests, renders Vue components to HTML, and injects the hydration payload.

### Request flow

```
Request -> Vite dev server middleware -> Route match -> Server API / Page SSR
  -> renderToString(App + Layout + Page) -> HTML with __VINUXT_DATA__
  -> Client hydration via vue-router + composables
```

## Project structure

```
packages/vinuxt/
  src/
    index.ts              # Main Vite plugin
    cli.ts                # vinuxt CLI (dev/build/start/deploy/init/check/lint)
    check.ts              # Compatibility scanner
    deploy.ts             # Cloudflare Workers deployment
    init.ts               # vinuxt init -- one-command migration
    plugins/
      auto-imports.ts     # unimport integration
      components.ts       # Component auto-registration
      page-meta.ts        # definePageMeta extraction
    composables/          # useAsyncData, useState, useCookie, etc.
    components/           # NuxtLink, NuxtImg, NuxtLoadingIndicator
    server/
      dev-server.ts       # SSR request handler
      html.ts             # HTML shell generation
      api-handler.ts      # Server API routes
      prod-server.ts      # Production server
    routing/
      router.ts           # File-system route scanner
    config/
      vinuxt-config.ts    # nuxt.config.ts loader
      dotenv.ts           # .env file loading
    cloudflare/
      kv-cache-handler.ts # KV-backed ISR cache
      tpr.ts              # Traffic-aware Pre-Rendering

tests/
  *.test.ts               # 215 Vitest tests
  bench/                  # Benchmark suite (vinuxt vs Nuxt)
  fixtures/               # Test apps
```

## Development

```bash
git clone https://github.com/Ray0907/vinuxt.git
cd vinuxt
pnpm install
pnpm run build          # Compile packages/vinuxt to dist/
pnpm test               # Run 215 tests
pnpm bench              # Run benchmarks (vinuxt vs Nuxt)
pnpm run typecheck      # TypeScript checking
pnpm run lint           # Linting (oxlint)
```

## Why

Vite is the default build tool for Vue. Nuxt adds a heavy meta-framework layer on top -- custom bundler integration, nitropack server, complex module system. For many projects, you just want Nuxt's conventions (file routing, auto-imports, composables, layouts) without the overhead.

vinuxt gives you exactly that: Nuxt's developer experience on a pure Vite pipeline. Faster cold starts, faster builds, simpler internals.

**Alternatives worth knowing about:**
- **[Nuxt](https://nuxt.com/)** -- the real thing. More features, more mature, battle-tested. Use Nuxt if you need the full ecosystem.
- **[VitePress](https://vitepress.dev/)** -- Vite-native, but focused on documentation sites.

## License

MIT
