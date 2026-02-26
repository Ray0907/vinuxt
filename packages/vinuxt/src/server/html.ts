/**
 * HTML shell generation for SSR responses.
 *
 * Produces a full HTML document that wraps the server-rendered Vue app.
 * The payload is safely serialized to prevent XSS via </script> injection.
 */

export interface HtmlShellOptions {
	/** <title>, <meta>, <link> tags for the <head> */
	head: string;
	/** SSR-rendered HTML string from renderToString */
	appHtml: string;
	/** JSON string of __VINUXT_DATA__ payload */
	payload: string;
	/** Script module src URLs */
	scripts: string[];
	/** Stylesheet href URLs */
	styles: string[];
}

/**
 * Escape a JSON string for safe embedding inside a <script> tag.
 *
 * JSON.stringify does NOT escape characters meaningful to the HTML parser.
 * If a JSON string value contains "</script>", the browser closes the script
 * tag early -- anything after it executes as HTML/JS. This is a well-known
 * stored XSS vector in SSR frameworks.
 *
 * Characters escaped:
 *   <      -> \u003c   (prevents </script> and <!-- breakout)
 *   >      -> \u003e   (prevents --> and other HTML close sequences)
 *   &      -> \u0026   (prevents entity interpretation in XHTML)
 *   \u2028 -> \\u2028  (line separator -- invalid in JS string literals pre-ES2019)
 *   \u2029 -> \\u2029  (paragraph separator -- same)
 */
function escapePayload(json: string): string {
	return json
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

/**
 * Generate a full HTML document wrapping SSR-rendered Vue app content.
 *
 * The app HTML is placed inside `<div id="__nuxt">...</div>`.
 * The payload is injected as a `JSON.parse()` wrapper for safety --
 * this prevents XSS via `</script>` in data values.
 */
export function generateHtmlShell(options: HtmlShellOptions): string {
	const { head, appHtml, payload, scripts, styles } = options;

	const style_tags = styles
		.map((href) => `<link rel="stylesheet" href="${href}" />`)
		.join("\n\t\t");

	const script_tags = scripts
		.map((src) => `<script type="module" src="${src}"></script>`)
		.join("\n\t\t");

	const payload_escaped = escapePayload(payload);

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	${head}
	${style_tags}
</head>
<body>
	<div id="__nuxt">${appHtml}</div>
	<script>window.__VINUXT_DATA__=JSON.parse(${JSON.stringify(payload_escaped)})</script>
	${script_tags}
</body>
</html>`;
}
