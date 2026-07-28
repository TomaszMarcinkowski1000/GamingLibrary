// @ts-check
import { defineConfig, envField, sessionDrivers } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  // The Astro dev toolbar (bottom-of-screen island, dev-only) is unused; disable it.
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
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
