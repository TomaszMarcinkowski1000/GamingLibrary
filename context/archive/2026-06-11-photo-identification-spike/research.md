---
date: 2026-06-11T00:00:00+02:00
researcher: Tomasz Marcinkowski
git_commit: 42f9123992d18dfe9535c37dff6e91dd19e9a6c7
branch: plan/edit-and-delete-entry
repository: GamingLibrary
topic: "Is opencv.js box rectification + OpenRouter vision game/platform ID compatible with our codebase?"
tags: [research, codebase, photo-identification-spike, opencv-js, openrouter, vision, igdb, cloudflare-workers]
status: complete
last_updated: 2026-06-11
last_updated_by: Tomasz Marcinkowski
last_updated_note: "Added follow-up research for storing the photo + showing it in a catalog/grid view, and how that changes the opencv.js case"
---

# Research: opencv.js rectification + OpenRouter vision ID — codebase compatibility

**Date**: 2026-06-11T00:00:00+02:00
**Researcher**: Tomasz Marcinkowski
**Git Commit**: 42f9123992d18dfe9535c37dff6e91dd19e9a6c7
**Branch**: plan/edit-and-delete-entry
**Repository**: GamingLibrary

## Research Question

Review `context/changes/photo-identification-spike/docs` and `external-research.md`, then decide whether using **opencv.js** to trim video-game covers to a rectangle (client-side rectification) and **recognizing game + platform via OpenRouter** (server-side vision) is **compatible with our codebase**.

## Summary

**Verdict: Yes — compatible, with one small new capability to build and one optional client-side piece to gate on measured benefit.**

- **OpenRouter server-side path → fully compatible, low-friction.** Every primitive the `openrouter.md` doc relies on already exists and is in active use: SSR API routes with `prerender = false`, server-only secrets via `astro:env/server` declared in `astro.config.mjs` `env.schema`, raw `fetch` to external APIs, `zod` validation at the boundary, and `cloudflare:workers` `env` access. The only genuinely new thing is **handling an uploaded image** (`multipart/formData` → `File` → base64 data URL); no route does file upload today. That's additive, not a conflict.
- **opencv.js client-side path → feasible but unprecedented; keep it optional.** The React-island + Vite + Cloudflare-adapter stack supports a client-only WASM island, and the adapter structurally guarantees WASM never reaches workerd. But there is **no WASM/heavy-client precedent** in the repo, all islands currently hydrate with `client:load` (no lazy `client:only`/`client:visible` usage yet), and `@techstark/opencv-js` adds ~2–3 MB gzipped that **must** be lazy-loaded. This matches the docs' own "optional, measure first" stance — adopt only if the accuracy harness shows angled shots dragging below 90%.
- **Grounding is a bonus we already own.** The external research's highest-leverage recommendation — verify the vision `{title, platform}` against IGDB before trusting it — is **already a working, shipped service** (`lookupGameMetadata`). The spike can feed vision output straight into it. No build required for the grounding leg.
- **Out of scope for v1 (and the research agrees):** the CLIP + pgvector reverse-image "Path B" is greenfield — **zero vector infrastructure exists** today. `external-research.md §8.5` explicitly scopes Path B to v1.1+, not the minimum spike.

**Bottom line for the spike:** Build the cheapest experiment — Astro API route → OpenRouter (Gemini Flash) → zod-validated `{title, platform, confidence}` → ground via existing `lookupGameMetadata` → accuracy harness. Defer opencv.js and Path B until the harness numbers justify them.

## Detailed Findings

### A. OpenRouter server-side vision call — drop-in compatible

Every building block in `docs/openrouter.md` maps to an existing, in-use pattern.

**API route shape** — the doc wants a Worker-side Astro route (`prerender = false`) hit with raw `fetch`. Exact precedent:
- `src/pages/api/library/index.ts:7` — `export const prerender = false;`
- `src/pages/api/library/index.ts` — `export const POST: APIRoute = async (context) => {…}`, reads `await request.json()`, validates with `safeParse`, returns `Response.json({ entry }, { status: 201 })`.
- Auth routes already read `multipart` form data: `src/pages/api/auth/signin.ts:5` and `signup.ts:5` use `await context.request.formData()` — the same API the image upload will use.

**Server-only secret plumbing** — the doc requires `OPENROUTER_API_KEY` as a server secret. Established pattern:
- `astro.config.mjs:17-24` — `env.schema` declares `SUPABASE_URL`, `SUPABASE_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, all `envField.string({ context: "server", access: "secret", optional: true })`.
- Access via `astro:env/server`: `src/lib/supabase.ts:3` and `src/lib/services/igdb.ts:2` import secrets directly.
- Local dev secrets live in `.dev.vars` (TWITCH creds already there); `.env.example` documents the Node ones.
- **To add OpenRouter:** one line in `astro.config.mjs` `env.schema`, one line in `.dev.vars`, a `wrangler secret put OPENROUTER_API_KEY` for prod. Mirrors the TWITCH wiring exactly.

**Raw fetch to external APIs** — the doc insists on raw `fetch` (no SDK in workerd). Already the house style:
- `src/lib/services/igdb-token-cache.ts:58,83` — `globalThis.fetch()` to `id.twitch.tv`.
- `src/lib/services/igdb.ts` uses the `@api-wrappers/igdb-wrapper` client built per request, but token mint and HTTP are raw fetch underneath.

**zod validation** — `zod@^4.4.3` is a dependency. Schemas are defined at module level next to consumers, validated with `safeParse`:
- `src/pages/api/library/index.ts:14-17` — `createEntrySchema = z.object({ title, platform })`.
- `src/lib/services/igdb.ts:45-48` — `lookupInputSchema`.
- The doc's `{title, platform, confidence}` JSON (returned as a string by OpenRouter `response_format: json_schema`) is `JSON.parse`d then zod-validated — identical to how the codebase treats untrusted input.

**Cloudflare runtime access** — `import { env } from "cloudflare:workers"` is the sanctioned binding-access path (the removed `locals.runtime.env` is captured as a foundation lesson):
- `src/pages/api/library/index.ts:2,49` — `env.IGDB_TOKENS`.
- `context/foundation/lessons.md` — "do NOT type or access Cloudflare bindings via `Astro.locals.runtime.env`; use `import { env } from 'cloudflare:workers'`."

**The one new thing:** no existing route accepts an uploaded image. The new route adds `multipart/formData` → `File.arrayBuffer()` → base64 data URL (the Worker-friendly snippet in `openrouter.md §2`). This is additive and Web-API-only (workerd-safe); no Node `fs`/`Buffer` needed. Watch the doc's stack-overflow caveat on `btoa(String.fromCharCode(...))` for large images — chunk the encode, and/or downscale client-side first.

### B. opencv.js client-side rectification — feasible, unprecedented, keep optional

`docs/opencv-js.md` correctly scopes opencv.js as **client-only** (workerd has no DOM `canvas`/`HTMLImageElement` that `cv.imread` expects). The codebase supports a client island for it, but there's no precedent and a real bundle cost.

**Island + hydration** — React 19 islands are mature, but all hydrate eagerly:
- `src/components/library/AddGameDialog.tsx` — stateful dialog, `useState`/`useRef`, client `fetch` to `/api/library`.
- `src/pages/library/index.astro:71,93` — `<AddGameDialog … client:load />`.
- `src/pages/auth/signin.astro:16` — `<SignInForm … client:load />`.
- **Only `client:load` is used anywhere.** A multi-MB WASM island should hydrate with `client:only="react"` (or `client:visible`) so the WASM download is deferred to the photo screen — a new directive for this repo, but standard Astro.

**Bundler** — `astro.config.mjs` runs `output: "server"`, `@astrojs/cloudflare` adapter, Vite with only the Tailwind plugin (no `optimizeDeps`/`exclude`, no WASM config). Vite 7 (`overrides.vite ^7.3.2`) handles WASM natively. `@techstark/opencv-js` (recommended in the doc for bundler integration) has no peer-dep overlap with current deps.

**No WASM/ML precedent** — grep across the repo finds no app-level `.wasm`, no onnx/tensorflow/opencv, no Web Workers, no `React.lazy`/`Suspense`, and only a single non-dynamic `import()`. The Astro compiler's `astro.wasm` is build-time only. So a lazy WASM island is **net-new infrastructure** for the project (feasible, just first-of-kind).

**Bundle impact** — `@techstark/opencv-js` is ~2–3 MB gzipped. Acceptable **only** if lazy-loaded onto the photo route; it must not touch the library/auth bundles. The doc already calls this out (load lazily, multi-MB).

**Footguns the doc flags and the codebase doesn't insulate you from:**
- Manual `cv.Mat`/`cv.MatVector` `.delete()` — no GC. Needs disciplined cleanup in a `useEffect` teardown.
- Corner ordering (port the `order_points` sum/diff routine) and a graceful fallback to the original photo when no clean quad is found.
- Hooks convention: `src/components/hooks/` is named in `CLAUDE.md:40` but **doesn't exist yet** (hooks are inline today). A `useOpenCV`/`useImageRectifier` hook would be the first resident.

**Recommendation:** treat rectification as `external-research.md §6`'s "optional, measured pre-step." Ship v1 without it (the LLM-vision path tolerates mild skew); add the island only if the harness shows angled shots below 90%.

### C. IGDB grounding — already shipped, reuse as-is

The external research's single highest-leverage finding (§4: ground the vision result against a real game DB to kill ~20% hallucinated titles) is **already a working primitive** in the repo (foundation F-02, archived 2026-06-08):

- `src/lib/services/igdb.ts` — `lookupGameMetadata(title, platform, kv)` returns a discriminated `IgdbLookupResult` (`{ status: "matched", igdbId, genre[], developer[], series[], releaseYear, releaseDate, lengthHours } | { status: "no_match" }`); never throws on no-match.
- `src/lib/services/igdb.ts:58-103` — `resolvePlatformIds(platform)` maps free-text platform strings → IGDB v4 platform ids (~30 console names). **A vision-proposed platform string grounds through this exact helper.**
- `src/lib/services/igdb-token-cache.ts` — Twitch app-token caching in Cloudflare KV (`IGDB_TOKENS`, `wrangler.jsonc:15-20`), graceful degradation on cache miss/failure.
- `src/lib/services/library.ts:33-86` — `createLibraryEntry(supabase, kv, { title, platform })` already calls `lookupGameMetadata` best-effort at save time.

**Gap vs. the research's ideal grounding:** the service returns the **first** match only (`.limit(1).first()`, `igdb.ts:169`) with **no confidence/score**. The research's "snap to nearest catalog entry + emit `unsure` below threshold" wants top-N + scoring — which overlaps the parked optional slice **S-09 (enrichment-match-precision)**. For the spike, first-match grounding is enough to measure the guardrail.

### D. Data model — vision output maps onto existing types unchanged

- `src/types.ts:13-19` — `LibraryEntry`; required columns `title` and `platform` (free text) are exactly the vision output. `igdb_id`, `metadata_status`, and array enrichment fields already exist (migrations `20260606150950`, `20260608183408`).
- An identified `{title, platform}` flows straight into `createLibraryEntry`, which enriches via IGDB and fills the rest; `user_id`/`play_status`/`date_bought` fall to defaults. **No schema change** is needed to persist a vision-identified entry — so the eventual S-03 photo-to-library persist step reuses the S-01 service untouched.
- The F-03 spike itself is **upstream of persistence** — it only needs to *produce* `{title, platform}` and *measure* accuracy; it need not write to `library_entries` at all.

### E. Reverse-image "Path B" (CLIP + pgvector) — greenfield, correctly deferred

- `supabase/migrations/` has 3 migrations, all on `public.library_entries`; **no `create extension vector`, no vector columns, no embeddings**. The only "vector" hit is `supabase/config.toml:142-148` `[storage.vector] enabled = false` (S3 vector buckets, unrelated to pgvector, and off).
- `external-research.md §8.5` scopes Path B to **v1.1+**, explicitly out of the minimum v1 spike. Nothing blocks v1; pgvector is pure future work.

## Code References

- `src/pages/api/library/index.ts:7` — `export const prerender = false` (route template for the vision endpoint)
- `src/pages/api/library/index.ts:2,49` — `import { env } from "cloudflare:workers"`; `env.IGDB_TOKENS`
- `src/pages/api/library/index.ts:14-17` — module-level zod schema + `safeParse` pattern
- `src/pages/api/auth/signin.ts:5` — `await context.request.formData()` (image-upload precedent)
- `astro.config.mjs:17-24` — `env.schema` secret declarations (where `OPENROUTER_API_KEY` slots in)
- `src/lib/supabase.ts:3` / `src/lib/services/igdb.ts:2` — `astro:env/server` secret access
- `src/lib/services/igdb-token-cache.ts:58,83` — raw `globalThis.fetch()` to external API
- `src/lib/services/igdb.ts:142-214` — `lookupGameMetadata` (the grounding primitive)
- `src/lib/services/igdb.ts:58-103` — `resolvePlatformIds` (vision platform → IGDB ids)
- `src/lib/services/library.ts:33-86` — `createLibraryEntry` (persist + enrich; reusable by S-03)
- `src/components/library/AddGameDialog.tsx` + `src/pages/library/index.astro:71,93` — `client:load` island precedent
- `astro.config.mjs` — `output: "server"`, `@astrojs/cloudflare`, Vite (Tailwind-only, no WASM config)
- `wrangler.jsonc:15-20` — `IGDB_TOKENS` KV binding; `worker-configuration.d.ts` typing
- `supabase/config.toml:142-148` — `[storage.vector] enabled = false` (NOT pgvector)
- `src/types.ts:13-19` — `LibraryEntry` (title/platform map target)
- `context/foundation/lessons.md` — no `locals.runtime.env`; use `cloudflare:workers` env

## Architecture Insights

- **Services pattern is uniform and the vision service should follow it:** first arg is an already-authenticated `SupabaseClient` (RLS does user isolation — never filter `user_id` in queries); external handles (KV) passed in explicitly, request-scoped; zod at the boundary; discriminated-union results for fallible external calls; best-effort enrichment wrapped in try/catch so a flaky API never costs user data (`library.ts:55-72`). A `identifyGameFromPhoto(image, env)` returning `{ status: "identified", title, platform, confidence } | { status: "unsure" }` fits this shape exactly.
- **Secrets are `optional: true` by design** so CI builds without live creds (`astro.config.mjs:21-22`); the service throws loudly only at call time if the key is absent. Mirror this for `OPENROUTER_API_KEY`.
- **The client/server split the docs draw matches the runtime split the stack enforces:** opencv.js (DOM/WASM) on the client, OpenRouter `fetch` (secret-bearing) on the Worker. No tension with the architecture.
- **The spike is deliberately minimal:** F-03's binding deliverable is the **accuracy harness** measuring ≥90% game+platform correctness and 10s-p95 latency on the collector's own shelf — not a shipped UI. Everything beyond "vision → ground → score" is optional headroom.

## Historical Context (from prior changes)

- IGDB integration (`src/lib/services/igdb.ts`, token cache, `IGDB_TOKENS` KV) shipped as foundation **F-02**, archived 2026-06-08 — the grounding leg pre-dates this spike.
- `context/foundation/lessons.md` — the `locals.runtime.env` removal lesson (Astro 6 / @astrojs/cloudflare v13) directly governs how the new vision route reads any binding.
- Optional slice **S-09 (enrichment-match-precision)** already scopes top-N IGDB scoring/confidence — the richer grounding the research wants is a known, parked follow-up, not a spike concern.
- `context/changes/edit-and-delete-entry` (S-02, current branch) is the correction path S-03 depends on, but **not** a prerequisite of the F-03 spike — F-03 has no blocking prerequisites and can run now (F-01/F-02/S-01 all done).

## Roadmap Fit

- **F-03 (this spike)** is a foundation carrying the project's **binding guardrail** (FR-005): ≥90% correct game+platform on the collector's own shelf; secondary NFR 10s p95. It is `ready` in the roadmap.
- It **unblocks S-03 (photo-to-library — ★ north star)**, currently `blocked`, and resolves the `external` top-blocker. Per the roadmap risk note: **if accuracy < 90%, the photo path is cut and S-01 manual entry becomes primary.** This is precisely why the spike should be the *cheapest* experiment that produces the number.

## Related Research

- `context/changes/photo-identification-spike/external-research.md` — full solution-space survey (Exa/web); recommends Gemini-Flash-via-OpenRouter + IGDB grounding as the v1 path, opencv.js rectification as an optional measured pre-step (§6), CLIP+pgvector as v1.1 (§7–§8).
- `context/changes/photo-identification-spike/docs/{openrouter.md,opencv-js.md,README.md}` — library/API reference for the two technologies under evaluation.

## Open Questions

1. **Image size / latency:** what downscale target keeps base64 upload + Flash round-trip inside 10s p95? (Measure in the harness; downscale client-side regardless.)
2. **Confidence threshold for "unsure":** what `confidence` cutoff and/or IGDB no-match rule routes to abstain vs. guess? Needed so the harness can separate *wrong* from *abstained*.
3. **First-match grounding sufficiency:** is `lookupGameMetadata`'s single-result, score-less match good enough to lift accuracy to ≥90%, or does the spike already need S-09's top-N scoring?
4. **Gemini Flash slug:** confirm the live OpenRouter model id + vision/structured-output support before wiring (`openrouter.md §5` flags the listing changes).
5. **Rectification necessity:** does the un-rectified LLM path clear 90% on the real shelf, or do angled shots force the opencv.js island? (The A/B the harness exists to answer — `external-research.md §8.6`.)

## Follow-up Research 2026-06-11 — storing the photo + catalog/grid view

**Question:** if we want to *store* the captured image and *display* it in a nicer catalog view, does opencv.js then become feasible/worth it?

**Short answer:** opencv was always technically feasible — what was missing was *justification*. Storing + displaying gives rectification a **second reason to exist (display quality) that no longer depends on the ≥90% accuracy harness**, so the case for it genuinely strengthens. But two facts temper that: (1) for *matched* games, **IGDB official cover art is a cheaper, nicer source than any rectified phone photo**, and (2) display-grade rectification raises the bar from "silent optional pre-step" to "**confirm/adjust crop UX**," which is more scope than the spike implied. Net: build the catalog grid on IGDB covers first; store the user photo for the gaps; add opencv last and only with a confirm step.

### What exists today (all greenfield for this feature)
- **No image storage.** No R2 bucket binding in `wrangler.jsonc` (only `IGDB_TOKENS` KV; the `R2Bucket` symbols in `worker-configuration.d.ts:2012+` are type defs, not bindings). All Supabase Storage buckets are commented out (`supabase/config.toml:114-115`). Storing a user photo needs new infra either way.
- **No cover art fetched.** `src/lib/services/igdb.ts` queries metadata only (genre/developer/series/year/length) — it never requests `cover.image_id`. Adding it is **one extra field** on a query that's already authenticated and cached.
- **Catalog is a text table** — `src/pages/library/index.astro:103-132` renders title/platform/genre/year columns, no images. A visual grid is new UI regardless of opencv.
- **No image column** on `library_entries` (`src/types.ts:13-19`).

### How storing+displaying changes the opencv calculus
- **Before:** opencv only paid off if rectification lifted *recognition* accuracy → entirely gated on the harness, easy to cut.
- **Now:** a clean, head-on, background-stripped crop is a materially better catalog thumbnail than a skewed phone snap with shelf clutter → rectification earns its keep on *UX* even if the LLM never needed it. This is a real upgrade to the case.
- **But the failure mode inverts.** For recognition, a bad auto-crop is harmless (fall back to original; the LLM tolerates skew). For *display*, a wrong crop is **permanently ugly and user-visible**. That pushes toward an **interactive cropper** — show the detected 4-corner quad, let the user drag corners to confirm/fix — which is meaningfully more work than the spike's "silent fire-and-forget pre-step." opencv.js gives you the detected quad and the `warpPerspective`; the corner-handle UI is the new build.

### The cheaper alternative that covers most of the need: IGDB cover art
- The grounding leg already resolves matched entries to an `igdb_id`. Adding `cover.image_id` to the lookup yields a **pristine, uniform-aspect, CDN-hosted** cover (`images.igdb.com/.../t_cover_big/{hash}.jpg`) at **zero storage cost on our side**.
- For the **majority of the catalog (matched games), the IGDB cover is the better grid image** — uniform, high-quality, no per-photo processing. You need neither the user's photo nor opencv to get a beautiful grid for those.
- The user's (rectified) photo earns its place only for: **(a) no-match games** (no IGDB cover to fall back on), and **(b) "show my actual copy"** — condition, regional/special edition, loose vs. boxed. That's a smaller, optional slice — exactly where rectification's display payoff is real.

### Storage backend decision (needed before either path)
Two viable homes for the user photo; pick one:
- **Supabase Storage** — lowest friction: client already wired (`src/lib/supabase.ts`), RLS-style bucket policies mirror the existing `library_entries` RLS, built-in CDN + image transforms. Just uncomment a bucket in `config.toml` + a migration/policy. **Recommended default at collector volume.**
- **Cloudflare R2** — native to Workers, cheaper at scale, no egress fees; costs a new binding in `wrangler.jsonc` (mirrors the `IGDB_TOKENS` KV wiring) + you build access control yourself. Better if volume ever grows.
Either way: add an image-reference column (e.g. `cover_source 'igdb'|'user_photo'`, `user_photo_path text?`, `igdb_cover_id text?`) to `library_entries`, and a `multipart` upload route (the same new file-handling the OpenRouter route already introduces — they can share it).

### Recommended layering (cheapest visual win first, opencv last)
1. **IGDB cover in the grid** — add `cover.image_id` to the IGDB query, store id/URL on the entry, render a cover grid. Biggest visual upgrade, no image storage of user photos, no opencv. Independent of the F-03 spike result.
2. **Store the user's original photo** (Supabase Storage) — fallback cover for no-match games + a "my copy" option. Needs the storage backend + column + upload route.
3. **opencv.js rectification of the stored user photo** — now justified by display, but ship it **with a confirm/adjust crop step** and the graceful "keep original if no clean quad" fallback. Last and optional.

### Updated open questions
6. **Where to store user photos** — Supabase Storage (recommended) vs R2? (Decision needed before steps 2–3 above.)
7. **Is IGDB cover art enough** for the catalog view, making user-photo storage + opencv a niche "show my actual copy" feature rather than the main path?
8. **Silent vs. interactive crop** — if rectification is for display, does it need a corner-drag confirm UI (recommended) rather than the spike's silent pre-step? That sizing decides whether opencv is a small or medium piece of work.
