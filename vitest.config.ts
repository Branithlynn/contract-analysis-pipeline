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
  },
});
