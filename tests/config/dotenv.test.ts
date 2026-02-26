import { describe, it, expect } from "vitest";
import { loadDotenv, getDotenvFiles } from "../../packages/vinuxt/src/config/dotenv.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("getDotenvFiles", () => {
	it("returns correct file order for development", () => {
		const files = getDotenvFiles("development");
		expect(files).toEqual([
			".env.development.local",
			".env.local",
			".env.development",
			".env",
		]);
	});

	it("excludes .env.local for test mode", () => {
		const files = getDotenvFiles("test");
		expect(files).toEqual([
			".env.test.local",
			".env.test",
			".env",
		]);
	});
});

describe("loadDotenv", () => {
	it("loads .env file into processEnv", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vinuxt-test-"));
		fs.writeFileSync(path.join(tmp, ".env"), "FOO=bar\n");
		const env: Record<string, string | undefined> = {};
		const result = loadDotenv({ root: tmp, mode: "development", processEnv: env });
		expect(env.FOO).toBe("bar");
		expect(result.loadedFiles).toContain(".env");
		fs.rmSync(tmp, { recursive: true });
	});

	it("does not overwrite existing env vars", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vinuxt-test-"));
		fs.writeFileSync(path.join(tmp, ".env"), "EXISTING=new\n");
		const env: Record<string, string | undefined> = { EXISTING: "original" };
		loadDotenv({ root: tmp, mode: "development", processEnv: env });
		expect(env.EXISTING).toBe("original");
		fs.rmSync(tmp, { recursive: true });
	});

	it("expands variable references", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vinuxt-test-"));
		fs.writeFileSync(path.join(tmp, ".env"), "BASE=/api\nURL=${BASE}/v1\n");
		const env: Record<string, string | undefined> = {};
		loadDotenv({ root: tmp, mode: "development", processEnv: env });
		expect(env.URL).toBe("/api/v1");
		fs.rmSync(tmp, { recursive: true });
	});

	it("respects mode-specific file priority", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vinuxt-test-"));
		fs.writeFileSync(path.join(tmp, ".env"), "KEY=from-env\n");
		fs.writeFileSync(path.join(tmp, ".env.development"), "KEY=from-dev\n");
		const env: Record<string, string | undefined> = {};
		loadDotenv({ root: tmp, mode: "development", processEnv: env });
		expect(env.KEY).toBe("from-dev");
		fs.rmSync(tmp, { recursive: true });
	});
});
