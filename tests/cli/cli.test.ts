import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const CLI = path.resolve("packages/vinuxt/src/cli.ts");

describe("vinuxt CLI", () => {
	it("prints version with --version", () => {
		const output = execFileSync(
			"npx", ["tsx", CLI, "--version"],
			{ encoding: "utf-8" },
		);
		expect(output.trim()).toMatch(/^vinuxt v\d/);
	});

	it("prints help with --help", () => {
		const output = execFileSync(
			"npx", ["tsx", CLI, "--help"],
			{ encoding: "utf-8" },
		);
		expect(output).toContain("vinuxt");
		expect(output).toContain("dev");
		expect(output).toContain("build");
		expect(output).toContain("start");
		expect(output).toContain("deploy");
	});

	it("prints help with no args", () => {
		const output = execFileSync(
			"npx", ["tsx", CLI],
			{ encoding: "utf-8" },
		);
		expect(output).toContain("vinuxt");
	});

	it("exits with error for unknown command", () => {
		expect(() => {
			execFileSync(
				"npx", ["tsx", CLI, "foobar"],
				{ encoding: "utf-8", stdio: "pipe" },
			);
		}).toThrow();
	});

	it("parses --port flag", () => {
		const output = execFileSync(
			"npx", ["tsx", CLI, "dev", "--help"],
			{ encoding: "utf-8" },
		);
		expect(output).toContain("--port");
	});
});
