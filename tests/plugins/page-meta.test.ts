import { describe, it, expect } from "vitest";
import { createPageMetaPlugin } from "../../packages/vinuxt/src/plugins/page-meta.js";

describe("vinuxt:page-meta plugin", () => {
	const plugin = createPageMetaPlugin({ root: "/project" });

	it("has the correct plugin name", () => {
		expect(plugin.name).toBe("vinuxt:page-meta");
	});

	it("transforms code containing definePageMeta in pages/", () => {
		const code_input = `
<script setup>
definePageMeta({ layout: "admin", middleware: "auth" })
</script>

<template>
  <div>Hello</div>
</template>
`;
		const result = (plugin.transform as any).call(
			{},
			code_input,
			"/project/pages/dashboard.vue",
		);

		expect(result).toBeDefined();
		expect(result.code).toContain("__pageMetaRaw");
	});

	it("extracts layout and middleware values correctly", () => {
		const code_input = `
<script setup>
definePageMeta({ layout: "admin", middleware: "auth" })
</script>

<template>
  <div>Hello</div>
</template>
`;
		const result = (plugin.transform as any).call(
			{},
			code_input,
			"/project/pages/settings.vue",
		);

		expect(result).toBeDefined();
		expect(result.code).toContain("__pageMetaRaw");
		// The exported meta should contain the raw object text
		expect(result.code).toContain("layout");
		expect(result.code).toContain("admin");
		expect(result.code).toContain("middleware");
		expect(result.code).toContain("auth");
	});

	it("does not transform code without definePageMeta", () => {
		const code_input = `
<script setup>
const msg = "hello"
</script>

<template>
  <div>{{ msg }}</div>
</template>
`;
		const result = (plugin.transform as any).call(
			{},
			code_input,
			"/project/pages/index.vue",
		);

		expect(result).toBeNull();
	});

	it("does not transform files outside pages/", () => {
		const code_input = `
<script setup>
definePageMeta({ layout: "admin" })
</script>

<template>
  <div>Hello</div>
</template>
`;
		const result = (plugin.transform as any).call(
			{},
			code_input,
			"/project/components/MyComponent.vue",
		);

		expect(result).toBeNull();
	});

	it("does not transform non-.vue files", () => {
		const code_input = `definePageMeta({ layout: "admin" })`;
		const result = (plugin.transform as any).call(
			{},
			code_input,
			"/project/pages/helper.ts",
		);

		expect(result).toBeNull();
	});
});
