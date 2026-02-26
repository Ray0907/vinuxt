import { describe, it, expect, beforeEach } from "vitest";
import {
	useRuntimeConfig,
	setRuntimeConfig,
	type RuntimeConfig,
} from "../../packages/vinuxt/src/composables/runtime-config.js";

describe("useRuntimeConfig", () => {
	beforeEach(() => {
		// Reset config between tests
		setRuntimeConfig({
			public: { apiBase: "https://api.example.com" },
			secretKey: "s3cret",
		});
	});

	it("returns public config", () => {
		const config = useRuntimeConfig();
		expect(config.public.apiBase).toBe("https://api.example.com");
	});

	it("returns full config (server context)", () => {
		const config = useRuntimeConfig();
		expect(config.secretKey).toBe("s3cret");
		expect(config.public.apiBase).toBe("https://api.example.com");
	});

	it("config is readonly (frozen)", () => {
		const config = useRuntimeConfig();

		// Top-level properties should be frozen
		expect(() => {
			(config as Record<string, unknown>).newProp = "fail";
		}).toThrow();

		// Public sub-object should also be frozen
		expect(() => {
			(config.public as Record<string, unknown>).newProp = "fail";
		}).toThrow();
	});

	it("returns updated config after setRuntimeConfig", () => {
		setRuntimeConfig({
			public: { apiBase: "https://v2.api.example.com" },
			newSecret: "new-value",
		});

		const config = useRuntimeConfig();
		expect(config.public.apiBase).toBe("https://v2.api.example.com");
		expect(config.newSecret).toBe("new-value");
	});
});
