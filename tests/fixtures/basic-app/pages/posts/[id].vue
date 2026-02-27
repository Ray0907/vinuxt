<template>
	<div class="post">
		<a href="/" class="breadcrumb">Home</a>
		<span class="breadcrumb-sep">/</span>
		<span class="breadcrumb-current">Post {{ $route.params.id }}</span>

		<div class="post-card">
			<div class="post-meta">
				<span class="post-tag">dynamic route</span>
				<span class="post-id">#{{ $route.params.id }}</span>
			</div>
			<h1>Post {{ $route.params.id }}</h1>
			<p class="post-body">
				This page demonstrates file-based dynamic routing with <code>[id].vue</code>.
				The route parameter is extracted from the URL and available via
				<code>$route.params.id</code>.
			</p>
			<div class="post-footer">
				<a href="/" class="btn-back">Back Home</a>
			</div>
		</div>
	</div>
</template>

<style scoped>
.post {
	display: flex;
	flex-direction: column;
	gap: 20px;
	padding-top: 8px;
}

.breadcrumb {
	font-size: 13px;
	color: var(--text-muted);
	text-decoration: none;
}

.breadcrumb:hover {
	color: var(--accent);
}

.breadcrumb-sep {
	font-size: 13px;
	color: var(--text-muted);
	margin: 0 4px;
}

.breadcrumb-current {
	font-size: 13px;
	color: var(--text-secondary);
}

.post-card {
	background: var(--bg-secondary);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	padding: 32px;
}

.post-meta {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 16px;
}

.post-tag {
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--accent);
	background: rgba(59, 130, 246, 0.12);
	padding: 3px 8px;
	border-radius: 4px;
}

.post-id {
	font-size: 13px;
	color: var(--text-muted);
	font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
}

h1 {
	font-size: 28px;
	font-weight: 700;
	letter-spacing: -0.02em;
	margin-bottom: 12px;
}

.post-body {
	font-size: 15px;
	color: var(--text-secondary);
	line-height: 1.7;
}

code {
	font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	font-size: 13px;
	background: rgba(59, 130, 246, 0.15);
	color: var(--accent);
	padding: 2px 6px;
	border-radius: 4px;
}

.post-footer {
	margin-top: 24px;
	padding-top: 20px;
	border-top: 1px solid var(--border);
}

.btn-back {
	display: inline-flex;
	align-items: center;
	padding: 8px 16px;
	border-radius: 8px;
	font-size: 14px;
	font-weight: 500;
	color: var(--text-secondary);
	background: transparent;
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
