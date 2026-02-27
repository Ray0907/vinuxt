<template>
	<div class="layout-default">
		<nav class="nav">
			<div class="nav-inner">
				<a href="/" class="logo">
					<span class="logo-icon">N</span>
					<span class="logo-text">nuxt</span>
				</a>
				<div class="nav-links">
					<a href="/" class="nav-link">Home</a>
					<a href="/about" class="nav-link">About</a>
					<a href="/posts/1" class="nav-link">Posts</a>
				</div>
			</div>
		</nav>
		<main class="main">
			<slot />
		</main>
		<footer class="footer">
			<p class="footer-text">nuxt baseline</p>
		</footer>
	</div>
</template>

<style>
:root {
	--bg-primary: #0F172A;
	--bg-secondary: #1E293B;
	--bg-card: #1E293B;
	--text-primary: #F1F5F9;
	--text-secondary: #94A3B8;
	--text-muted: #64748B;
	--accent: #3B82F6;
	--accent-hover: #60A5FA;
	--border: #334155;
	--radius: 8px;
}

* {
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}

body {
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
	background-color: var(--bg-primary);
	color: var(--text-primary);
	line-height: 1.6;
	-webkit-font-smoothing: antialiased;
}

.layout-default {
	min-height: 100vh;
	display: flex;
	flex-direction: column;
}

.nav {
	position: sticky;
	top: 0;
	z-index: 50;
	border-bottom: 1px solid var(--border);
	background: rgba(15, 23, 42, 0.85);
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
}

.nav-inner {
	max-width: 960px;
	margin: 0 auto;
	padding: 0 24px;
	height: 56px;
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.logo {
	display: flex;
	align-items: center;
	gap: 8px;
	text-decoration: none;
	color: var(--text-primary);
}

.logo-icon {
	width: 28px;
	height: 28px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--accent);
	color: white;
	border-radius: 6px;
	font-weight: 700;
	font-size: 14px;
	font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
}

.logo-text {
	font-weight: 600;
	font-size: 16px;
	font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	letter-spacing: -0.02em;
}

.nav-links {
	display: flex;
	gap: 4px;
}

.nav-link {
	color: var(--text-secondary);
	text-decoration: none;
	padding: 6px 12px;
	border-radius: 6px;
	font-size: 14px;
	font-weight: 500;
	transition: color 0.15s, background-color 0.15s;
	cursor: pointer;
}

.nav-link:hover {
	color: var(--text-primary);
	background: rgba(59, 130, 246, 0.1);
}

.main {
	flex: 1;
	max-width: 960px;
	margin: 0 auto;
	padding: 48px 24px;
	width: 100%;
}

.footer {
	border-top: 1px solid var(--border);
	padding: 24px;
	text-align: center;
}

.footer-text {
	color: var(--text-muted);
	font-size: 13px;
	font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
}

a {
	color: var(--accent);
	text-decoration: none;
	transition: color 0.15s;
}

a:hover {
	color: var(--accent-hover);
}
</style>
