import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    settings: {
      next: {
        rootDir: ["apps/web/", "apps/showcase/"],
      },
    },
  },
  globalIgnores([
    "**/.next/**",
    "**/coverage/**",
    "**/out/**",
    "**/build/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/next-env.d.ts",
    "packages/database/drizzle/**",
  ]),
]);
