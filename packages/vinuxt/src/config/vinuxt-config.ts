import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface RouteRule {
	cache?: { maxAge: number } | false;
	redirect?: { to: string; statusCode?: number };
	headers?: Record<string, string>;
	ssr?: boolean;
}

export interface VinuxtConfig {
	ssr: boolean;
	runtimeConfig: {
		[key: string]: unknown;
		public: Record<string, unknown>;
	};
	routeRules: Record<string, RouteRule>;
	app: { head: Record<string, unknown>; baseURL: string };
	css: string[];
	plugins: string[];
	imports: { dirs: string[] };
	components: { dirs: string[] };
}

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type UserVinuxtConfig = DeepPartial<VinuxtConfig> & Record<string, unknown>;

const CONFIG_FILES = [
	"vinuxt.config.ts",
	"vinuxt.config.js",
	"vinuxt.config.mjs",
	"nuxt.config.ts",
	"nuxt.config.js",
];

function createDefaults(): VinuxtConfig {
	return {
		ssr: true,
		runtimeConfig: { public: {} },
		routeRules: {},
		app: { head: {}, baseURL: "/" },
		css: [],
		plugins: [],
		imports: { dirs: ["composables", "utils"] },
		components: { dirs: ["components"] },
	};
}

/**
 * Identity function that provides TypeScript type inference for config files.
 * Usage: `export default defineVinuxtConfig({ ... })`
 */
export function defineVinuxtConfig<T extends UserVinuxtConfig>(config: T): T {
	return config;
}

/**
 * Alias of defineVinuxtConfig for migration compatibility with Nuxt projects.
 */
export const defineNuxtConfig = defineVinuxtConfig;

/**
 * Find the first matching config file in the given directory.
 */
function findConfigFile(root: string): string | undefined {
	for (const name of CONFIG_FILES) {
		const file_path = path.join(root, name);
		if (fs.existsSync(file_path)) return file_path;
	}
	return undefined;
}

/**
 * Deep merge user config into defaults.
 *
 * - `runtimeConfig` and `app` are deep-merged (object spread at each level).
 * - All other keys are shallow-replaced (arrays, primitives overwrite defaults).
 */
function mergeConfig(
	defaults: VinuxtConfig,
	user: Record<string, unknown>,
): VinuxtConfig {
	const merged = { ...defaults };

	for (const key of Object.keys(user)) {
		const value_user = user[key];

		if (key === "runtimeConfig" && isPlainObject(value_user)) {
			const value_default = defaults.runtimeConfig;
			const value_public_user = isPlainObject(
				(value_user as Record<string, unknown>).public,
			)
				? ((value_user as Record<string, unknown>).public as Record<string, unknown>)
				: {};

			merged.runtimeConfig = {
				...value_default,
				...(value_user as Record<string, unknown>),
				public: {
					...value_default.public,
					...value_public_user,
				},
			};
			continue;
		}

		if (key === "app" && isPlainObject(value_user)) {
			const value_default = defaults.app;
			merged.app = {
				...value_default,
				...(value_user as Record<string, unknown>),
				head: {
					...value_default.head,
					...(isPlainObject((value_user as Record<string, unknown>).head)
						? ((value_user as Record<string, unknown>).head as Record<string, unknown>)
						: {}),
				},
			} as VinuxtConfig["app"];
			continue;
		}

		(merged as Record<string, unknown>)[key] = value_user;
	}

	return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load and resolve the vinuxt config from the given root directory.
 *
 * Config file lookup order:
 * 1. vinuxt.config.ts
 * 2. vinuxt.config.js
 * 3. vinuxt.config.mjs
 * 4. nuxt.config.ts (migration fallback)
 * 5. nuxt.config.js (migration fallback)
 *
 * Returns defaults when no config file is found.
 */
export async function loadVinuxtConfig(root: string): Promise<VinuxtConfig> {
	const defaults = createDefaults();
	const file_config = findConfigFile(root);

	if (!file_config) return defaults;

	const url_config = pathToFileURL(file_config).href;
	const mod = (await import(url_config)) as {
		default?: Record<string, unknown>;
	};
	const raw = mod.default ?? {};

	return mergeConfig(defaults, raw);
}
