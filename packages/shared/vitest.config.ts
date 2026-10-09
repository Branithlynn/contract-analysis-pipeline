import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@nexus/shared",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
