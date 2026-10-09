import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist/", "**/node_modules/", "data/"]),
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "error",
    },
  },
  {
    files: ["scripts/**", "evals/**"],
    rules: { "no-console": "off" },
  },
  {
    // The web bundle must never pull in node-only code (better-sqlite3, pino, bullmq).
    files: ["apps/web/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@nexus/shared/node", message: "Node-only entry point, not for the browser." },
          ],
        },
      ],
    },
  },
  {
    // The "." entry of @nexus/shared is imported by web, so it has to stay browser safe.
    files: [
      "packages/shared/src/index.ts",
      "packages/shared/src/status.ts",
      "packages/shared/src/schemas/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(node:|better-sqlite3(/|$)|pino(/|$)|bullmq(/|$))",
              message: "Node-only module, keep it in @nexus/shared/node.",
            },
            {
              regex: "(^|/)node\.js$|(^|/)db(/|$)",
              message: "Node-only code, import it through @nexus/shared/node instead.",
            },
          ],
        },
      ],
    },
  },
]);
