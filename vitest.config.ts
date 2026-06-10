import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for unit tests.
 *
 * - `@` resolves to `src/` (mirrors the tsconfig path alias).
 * - `astro:env/server` is a build-time virtual module that doesn't exist under Node, so
 *   it's aliased to a stub (see `test/stubs/astro-env-server.ts`).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "astro:env/server": fileURLToPath(new URL("./test/stubs/astro-env-server.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
