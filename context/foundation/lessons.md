# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Astro 6 / @astrojs/cloudflare v13 removed `locals.runtime.env`

- **Context**: src/env.d.ts, worker-configuration.d.ts (igdb-metadata-enrichment, Phase 2 KV binding typing)
- **Problem**: The plan specified augmenting `App.Locals` with the @astrojs/cloudflare `Runtime` type to access the KV binding via `locals.runtime.env`. That API was removed in Astro 6 / @astrojs/cloudflare v13, so the planned contract was no longer valid and had to be adapted at implementation time.
- **Rule**: On this stack, do NOT type or access Cloudflare bindings via `Astro.locals.runtime.env`. Type bindings with generated `worker-configuration.d.ts` (`npm run cf-typegen` / `wrangler types`) and access them through `import { env } from "cloudflare:workers"`.
- **Applies to**: Any change that wires a new Cloudflare binding (KV, R2, D1, queues, secrets) — planning and implementation.
