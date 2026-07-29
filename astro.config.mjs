// @ts-check
import { defineConfig, envField, sessionDrivers } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

/**
 * Emit source maps for the SSR/Worker build only.
 *
 * Sentry needs them to un-minify production stack traces, and `wrangler deploy` copies
 * `dist/server` through module-for-module, so these maps describe the code that actually runs.
 * Scoping to the SSR build is deliberate: `dist/client` is uploaded to Cloudflare as public
 * static assets, so a client `.map` there would serve our sources to anyone who asks.
 *
 * @returns {import("vite").Plugin}
 */
function serverOnlySourcemaps() {
  return {
    name: "gaming-library:server-only-sourcemaps",
    config(_config, { isSsrBuild }) {
      return isSsrBuild ? { build: { sourcemap: true } } : undefined;
    },
  };
}

// https://astro.build/config
export default defineConfig({
  output: "server",
  // Deliberately no `@sentry/astro` here. Source maps are uploaded from wrangler's own bundle
  // instead (`npm run deploy` -> scripts/deploy-worker.mjs); that is the artifact that actually
  // runs, and it is what Sentry's Cloudflare Workers guide targets. The Astro integration would
  // also inject the ~269 kB browser SDK into every page and re-bundle sentry.server.config.ts
  // into the SSR output — both unwanted here. See context/changes/sentry-error-monitoring/plan.md.
  integrations: [react(), sitemap()],
  // The Astro dev toolbar (bottom-of-screen island, dev-only) is unused; disable it.
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss(), serverOnlySourcemaps()],
  },
  adapter: cloudflare({ imageService: "compile" }),
  // Astro sessions are unused. The Cloudflare adapter otherwise auto-enables a
  // KV-backed session store and injects a "SESSION" binding, which collides with
  // our own KV bindings at deploy time. Pin a lightweight in-memory driver so the
  // adapter skips the SESSION binding entirely. (sessionDrivers.null exists at
  // runtime but is missing from Astro's exported types, so it fails typed lint.)
  session: {
    driver: sessionDrivers.lruCache(),
  },
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      TWITCH_CLIENT_ID: envField.string({ context: "server", access: "secret", optional: true }),
      TWITCH_CLIENT_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
      OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Arms the e2e determinism seam in `src/lib/services/vision.ts` (see .env.example). Optional is
      // load-bearing: builds, CI, and production must proceed without it — and unset means disarmed,
      // so leaving it out is the production configuration, not a missing one.
      E2E_VISION_STUB_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // Error-monitoring sink. Read only at the Worker entrypoint (`sentry.server.config.ts`),
      // never from app code — it is declared here so it is a known part of the config surface.
      // Optional is load-bearing the same way: unset means the SDK no-ops, which is the correct
      // local and CI configuration (see .env.example).
      SENTRY_DSN: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
