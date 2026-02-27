/**
 * Benchmark: vinuxt production build times
 *
 * Spawns `vinuxt build` in the fixture directory and captures the
 * client/server/total timings printed by cli.ts.
 */
import { describe, bench } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/basic-app");
const CLI_PATH = path.resolve(
  FIXTURE_DIR,
  "../../../packages/vinuxt/src/cli.ts",
);

describe("production build", () => {
  bench(
    "full build (client + server)",
    () => {
      const result = spawnSync("npx", ["tsx", CLI_PATH, "build"], {
        cwd: FIXTURE_DIR,
        encoding: "utf-8",
        env: { ...process.env, NODE_ENV: "production" },
        timeout: 60_000,
      });

      const output = (result.stdout ?? "") + (result.stderr ?? "");

      // Parse sub-timings from CLI stdout
      const match_client = output.match(/Client:.*\((\d+\.\d+)s\)/);
      const match_server = output.match(/Server:.*\((\d+\.\d+)s\)/);
      const match_total = output.match(/Total:\s+(\d+\.\d+)s/);

      if (match_client && match_server && match_total) {
        console.log(
          `  Build breakdown: client ${match_client[1]}s, server ${match_server[1]}s, total ${match_total[1]}s`,
        );
      }
    },
    { iterations: 3, warmupIterations: 0, time: 0 },
  );
});
