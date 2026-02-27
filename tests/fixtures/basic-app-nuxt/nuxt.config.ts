export default defineNuxtConfig({
	runtimeConfig: {
		secretKey: "server-only-secret",
		public: {
			appName: "Basic Test App",
			apiBase: "/api",
		},
	},
});
