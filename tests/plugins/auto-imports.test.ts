import { describe, it, expect } from "vitest";
import { createAutoImportsPlugin } from "../../packages/vinuxt/src/plugins/auto-imports.js";

describe("vinuxt:auto-imports plugin", () => {
	it("has the correct plugin name", () => {
		const plugin = createAutoImportsPlugin({ root: "/tmp/test-project" });
		expect(plugin.name).toBe("vinuxt:auto-imports");
	});

	it("pre-registers all vinuxt composables", () => {
		const plugin = createAutoImportsPlugin({ root: "/tmp/test-project" });

		// The plugin should expose its unimport instance or preset for testing
		const expected_composables = [
			"useAsyncData",
			"useFetch",
			"useState",
			"useCookie",
			"useRuntimeConfig",
			"useRouter",
			"useRoute",
			"navigateTo",
			"useError",
			"createError",
			"showError",
			"clearError",
		];

		const preset = plugin._preset;
		expect(preset).toBeDefined();

		const names_in_preset = preset.imports.map((i: any) =>
			typeof i === "string" ? i : i.name,
		);

		for (const name of expected_composables) {
			expect(names_in_preset).toContain(name);
		}
	});

	it("includes vinuxt/composables as the preset source", () => {
		const plugin = createAutoImportsPlugin({ root: "/tmp/test-project" });
		const preset = plugin._preset;
		expect(preset.from).toBe("vinuxt/composables");
	});

	it("configures scan dirs for composables/ and utils/", () => {
		const plugin = createAutoImportsPlugin({ root: "/tmp/test-project" });
		const dirs = plugin._scanDirs;
		expect(dirs).toBeDefined();
		expect(dirs).toContain("/tmp/test-project/composables");
		expect(dirs).toContain("/tmp/test-project/utils");
	});
});
