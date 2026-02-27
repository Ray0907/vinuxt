<template>
	<div class="home">
		<section class="hero">
			<div class="badge">Open Source Framework</div>
			<h1>Vinuxt Works!</h1>
			<p class="hero-sub">
				Run your Nuxt apps on pure Vite. Same pages, composables, and conventions
				-- faster dev server, simpler build pipeline.
			</p>
			<div class="hero-actions">
				<a href="/about" class="btn btn-primary">Go to About</a>
				<a href="/posts/1" class="btn btn-secondary">View Posts</a>
			</div>
		</section>

		<section class="features">
			<div class="feature-card">
				<div class="feature-icon">~0s</div>
				<h3 class="feature-title">Instant HMR</h3>
				<p class="feature-desc">Vite-native hot module replacement. Changes reflect instantly.</p>
			</div>
			<div class="feature-card">
				<div class="feature-icon">SSR</div>
				<h3 class="feature-title">Server-Side Rendering</h3>
				<p class="feature-desc">Full SSR with payload hydration. SEO-ready out of the box.</p>
			</div>
			<div class="feature-card">
				<div class="feature-icon">1:1</div>
				<h3 class="feature-title">Nuxt Compatible</h3>
				<p class="feature-desc">Same file-based routing, layouts, middleware, and composables.</p>
			</div>
		</section>

		<section class="code-block">
			<div class="code-header">
				<span class="code-dot" style="background: #EF4444;"></span>
				<span class="code-dot" style="background: #F59E0B;"></span>
				<span class="code-dot" style="background: #22C55E;"></span>
				<span class="code-title">terminal</span>
			</div>
			<pre class="code-content"><span class="code-comment"># Drop-in replacement</span>
<span class="code-prompt">$</span> npx vinuxt dev

<span class="code-output">  vinuxt dev  (Vite 7.3.1)

  Local:   http://localhost:3000/</span></pre>
		</section>
	</div>
</template>

<style scoped>
.home {
	display: flex;
	flex-direction: column;
	gap: 64px;
}

.hero {
	text-align: center;
	padding: 32px 0 0;
}

.badge {
	display: inline-block;
	padding: 4px 12px;
	border-radius: 100px;
	border: 1px solid var(--border);
	font-size: 12px;
	font-weight: 500;
	color: var(--accent);
	letter-spacing: 0.03em;
	margin-bottom: 20px;
}

h1 {
	font-size: 48px;
	font-weight: 700;
	letter-spacing: -0.03em;
	line-height: 1.1;
	background: linear-gradient(135deg, #F1F5F9, #3B82F6);
	-webkit-background-clip: text;
	-webkit-text-fill-color: transparent;
	background-clip: text;
	margin-bottom: 16px;
}

.hero-sub {
	color: var(--text-secondary);
	font-size: 17px;
	max-width: 520px;
	margin: 0 auto 28px;
	line-height: 1.6;
}

.hero-actions {
	display: flex;
	gap: 12px;
	justify-content: center;
}

.btn {
	display: inline-flex;
	align-items: center;
	padding: 10px 20px;
	border-radius: 8px;
	font-size: 14px;
	font-weight: 600;
	text-decoration: none;
	transition: all 0.15s;
	cursor: pointer;
}

.btn-primary {
	background: var(--accent);
	color: white;
}

.btn-primary:hover {
	background: var(--accent-hover);
	color: white;
}

.btn-secondary {
	background: var(--bg-secondary);
	color: var(--text-primary);
	border: 1px solid var(--border);
}

.btn-secondary:hover {
	border-color: var(--accent);
	color: var(--accent);
}

.features {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 16px;
}

@media (max-width: 640px) {
	.features {
		grid-template-columns: 1fr;
	}
	h1 {
		font-size: 36px;
	}
}

.feature-card {
	background: var(--bg-secondary);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	padding: 24px;
	transition: border-color 0.2s;
	cursor: default;
}

.feature-card:hover {
	border-color: var(--accent);
}

.feature-icon {
	font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	font-size: 20px;
	font-weight: 700;
	color: var(--accent);
	margin-bottom: 12px;
}

.feature-title {
	font-size: 15px;
	font-weight: 600;
	margin-bottom: 6px;
}

.feature-desc {
	font-size: 13px;
	color: var(--text-secondary);
	line-height: 1.5;
}

.code-block {
	background: #0D1117;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	overflow: hidden;
}

.code-header {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 10px 16px;
	border-bottom: 1px solid var(--border);
	background: rgba(30, 41, 59, 0.5);
}

.code-dot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
}

.code-title {
	margin-left: 8px;
	font-size: 12px;
	color: var(--text-muted);
	font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
}

.code-content {
	padding: 20px;
	font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	font-size: 13px;
	line-height: 1.7;
	color: var(--text-secondary);
	overflow-x: auto;
}

.code-comment {
	color: var(--text-muted);
}

.code-prompt {
	color: var(--accent);
	user-select: none;
}

.code-output {
	color: #22C55E;
}
</style>
