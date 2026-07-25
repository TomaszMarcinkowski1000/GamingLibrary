import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for unit tests.
 *
 * - `@` resolves to `src/` and `@test` to `test/` (both mirror tsconfig path aliases), so test
 *   files reach shared helpers by alias instead of `../../../test/...` traversal.
 * - `astro:env/server` is a build-time virtual module that doesn't exist under Node, so
 *   it's aliased to a stub (see `test/stubs/astro-env-server.ts`).
 * - `test/setup/no-network.ts` installs a deny-all `globalThis.fetch` around every test, so an
 *   unstubbed network call fails loudly instead of hitting a live provider.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@test": fileURLToPath(new URL("./test", import.meta.url)),
      "astro:env/server": fileURLToPath(new URL("./test/stubs/astro-env-server.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: [fileURLToPath(new URL("./test/setup/no-network.ts", import.meta.url))],
  },
});
