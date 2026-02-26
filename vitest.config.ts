import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
    passWithNoTests: true,
    reporters: process.env.CI ? ["default", "github-actions"] : ["default"],
  },
});
