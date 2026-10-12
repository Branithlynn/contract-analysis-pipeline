import { defineConfig } from "vitest/config";

// Its own config, so `npm test` never picks it up: it needs a real redis.
export default defineConfig({
  test: {
    name: "e2e",
    environment: "node",
    include: ["tests/e2e/**/*.e2e.test.ts"],
    // One step can wait up to 20s for the worker.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
