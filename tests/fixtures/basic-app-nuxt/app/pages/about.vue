<template>
	<div class="about">
		<div class="about-header">
			<h1>About Page</h1>
			<p class="about-lead">Nuxt baseline benchmark app.</p>
		</div>

		<div class="about-grid">
			<div class="about-card">
				<h3 class="card-title">Why Benchmark?</h3>
				<p class="card-text">
					Comparing vinuxt against stock Nuxt requires identical apps
					running the same pages, routes, and server APIs.
				</p>
			</div>
			<div class="about-card">
				<h3 class="card-title">How It Works</h3>
				<p class="card-text">
					Same file-based routing, auto-imports,
					SSR, layouts, middleware, and composables -- stock Nuxt + Nitro.
				</p>
			</div>
			<div class="about-card">
				<h3 class="card-title">Compatibility</h3>
				<p class="card-text">
					Both apps share the same Vue pages and composables.
					Only the framework layer differs.
				</p>
			</div>
		</div>

		<div class="about-cta">
			<a href="/" class="btn-back">Back Home</a>
		</div>
	</div>
</template>

<style scoped>
.about {
	display: flex;
	flex-direction: column;
	gap: 40px;
}

.about-header {
	padding: 16px 0;
}

h1 {
	font-size: 36px;
	font-weight: 700;
	letter-spacing: -0.03em;
	margin-bottom: 8px;
}

.about-lead {
	color: var(--text-secondary);
	font-size: 17px;
}

.about-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 16px;
}

@media (max-width: 640px) {
	.about-grid {
		grid-template-columns: 1fr;
	}
}

.about-card {
	background: var(--bg-secondary);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	padding: 24px;
	transition: border-color 0.2s;
}

.about-card:hover {
	border-color: var(--accent);
}

.card-title {
	font-size: 15px;
	font-weight: 600;
	margin-bottom: 8px;
}

.card-text {
	font-size: 14px;
	color: var(--text-secondary);
	line-height: 1.6;
}

code {
	font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	font-size: 13px;
	background: rgba(59, 130, 246, 0.15);
	color: var(--accent);
	padding: 2px 6px;
	border-radius: 4px;
}

.about-cta {
	padding-top: 8px;
}

.btn-back {
	display: inline-flex;
	align-items: center;
	padding: 8px 16px;
	border-radius: 8px;
	font-size: 14px;
	font-weight: 500;
	color: var(--text-secondary);
	background: var(--bg-secondary);
	border: 1px solid var(--border);
	text-decoration: none;
	transition: all 0.15s;
	cursor: pointer;
}

.btn-back:hover {
	color: var(--text-primary);
	border-color: var(--accent);
}
</style>
