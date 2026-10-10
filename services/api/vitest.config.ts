import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@nexus/api",
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test-support/warm-fastify.ts"],
  },
});
