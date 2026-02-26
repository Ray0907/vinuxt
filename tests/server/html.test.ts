import { describe, it, expect } from "vitest";
import { generateHtmlShell } from "../../packages/vinuxt/src/server/html.js";

describe("generateHtmlShell", () => {
	it("produces valid HTML with app content", () => {
		const html = generateHtmlShell({
			head: "<title>Test</title>",
			appHtml: "<div>Hello</div>",
			payload: '{"foo":"bar"}',
			scripts: ["/src/entry.js"],
			styles: ["/src/style.css"],
		});
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain('<div id="__nuxt">');
		expect(html).toContain("<div>Hello</div>");
		expect(html).toContain("__VINUXT_DATA__");
		expect(html).toContain("<title>Test</title>");
		expect(html).toContain('src="/src/entry.js"');
		expect(html).toContain('href="/src/style.css"');
	});

	it("escapes payload to prevent XSS", () => {
		const html = generateHtmlShell({
			head: "",
			appHtml: "",
			payload: '{"xss":"</script><script>alert(1)"}',
			scripts: [],
			styles: [],
		});
		// Should use JSON.parse wrapper or escape </script>
		// The raw </script><script>alert should NOT appear unescaped in the output
		expect(html).not.toContain("</script><script>alert");
	});

	it("renders multiple scripts and styles", () => {
		const html = generateHtmlShell({
			head: "",
			appHtml: "",
			payload: "{}",
			scripts: ["/a.js", "/b.js"],
			styles: ["/x.css", "/y.css"],
		});
		expect(html).toContain('src="/a.js"');
		expect(html).toContain('src="/b.js"');
		expect(html).toContain('href="/x.css"');
		expect(html).toContain('href="/y.css"');
	});

	it("handles empty options gracefully", () => {
		const html = generateHtmlShell({
			head: "",
			appHtml: "",
			payload: "{}",
			scripts: [],
			styles: [],
		});
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain('<div id="__nuxt">');
		expect(html).toContain("__VINUXT_DATA__");
	});
});
