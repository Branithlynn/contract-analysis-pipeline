import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "services/*",
      "apps/web",
      { test: { name: "evals", environment: "node", include: ["evals/**/*.test.ts"] } },
    ],
    passWithNoTests: true,
    // No thresholds on purpose: the report is for reading, not a gate.
    coverage: {
      provider: "v8",
      include: ["services/*/src/**/*.ts", "packages/shared/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/test-support/**"],
      reporter: ["text", "html"],
    },
  },
});
