import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // 10k-tick sim tests are pure compute: under parallel-worker CPU load the
    // default 5s timeout fires spuriously (the round-7/9 "determinism flake"
    // was exactly this). Assertions gate correctness; the clock guards hangs.
    testTimeout: 120_000,
  },
});
