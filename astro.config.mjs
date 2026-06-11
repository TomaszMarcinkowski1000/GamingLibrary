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
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare({ imageService: "compile" }),
  // Astro sessions are unused. The Cloudflare adapter otherwise auto-enables a
  // KV-backed session store and injects a "SESSION" binding, which collides with
  // our own KV bindings at deploy time. Pin a no-op driver to opt out cleanly.
  session: {
    driver: sessionDrivers.null(),
  },
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      TWITCH_CLIENT_ID: envField.string({ context: "server", access: "secret", optional: true }),
      TWITCH_CLIENT_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
