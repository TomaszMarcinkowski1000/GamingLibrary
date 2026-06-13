# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Astro 6 / @astrojs/cloudflare v13 removed `locals.runtime.env`

- **Context**: src/env.d.ts, worker-configuration.d.ts (igdb-metadata-enrichment, Phase 2 KV binding typing)
- **Problem**: The plan specified augmenting `App.Locals` with the @astrojs/cloudflare `Runtime` type to access the KV binding via `locals.runtime.env`. That API was removed in Astro 6 / @astrojs/cloudflare v13, so the planned contract was no longer valid and had to be adapted at implementation time.
- **Rule**: On this stack, do NOT type or access Cloudflare bindings via `Astro.locals.runtime.env`. Type bindings with generated `worker-configuration.d.ts` (`npm run cf-typegen` / `wrangler types`) and access them through `import { env } from "cloudflare:workers"`.
- **Applies to**: Any change that wires a new Cloudflare binding (KV, R2, D1, queues, secrets) — planning and implementation.

## Make IGDB relation-collapse platform-aware

- **Context**: IGDB grounding / edition-variant collapse — any code that resolves an IGDB search hit to a "base" game via `version_parent`/`parent_game` relations (e.g. `collapseToBaseGame` in `src/lib/services/igdb.ts`), especially when a downstream platform-agreement gate can veto the result.
- **Problem**: IGDB's `parent_game` is broader than "edition of" — it also links remakes/remasters/ports to their *original* game on older consoles. Blindly following it lands on the original, whose platform set excludes the boxed console, and the platform-agreement gate then rejects it as `no_match` — a silent recall regression (worse than the first-match grounding it replaced). Surfaced in `enrichment-match-precision` Phase 4 on remakes like Dead Space, Super Mario RPG, OoT 3D.
- **Rule**: When collapsing an IGDB hit to a base via `version_parent`/`parent_game`, only follow the relation if the related base still covers the query platform; otherwise keep the platform-correct candidate. Treat `parent_game` as remake/port/expansion-capable, not edition-only. Emit per-case "what collapsed to what" debug output so such regressions stay visible.
- **Applies to**: plan, implement, impl-review
