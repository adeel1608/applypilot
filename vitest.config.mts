import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const webRoot = fileURLToPath(new URL("./apps/web", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: "@web", replacement: webRoot }],
  },
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
