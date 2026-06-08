// Cloudflare runtime bindings (e.g. the IGDB_TOKENS KV namespace) are typed via the
// generated `worker-configuration.d.ts` (`npm run cf-typegen`), and accessed at runtime
// through `import { env } from "cloudflare:workers"` — `Astro.locals.runtime.env` was
// removed in Astro 6 (@astrojs/cloudflare v13).
declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
  }
}
