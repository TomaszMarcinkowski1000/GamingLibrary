# Photo-identification spike (F-03) Implementation Plan

## Overview

A throwaway-friendly **spike** whose binding deliverable is a *number*, not a shipped UI: prove (or disprove) that a vision model can identify a video game's **title + platform at ≥90%** on the collector's own shelf, within **10s p95** — the hard pass/fail gate for FR-005 that currently keeps the north-star slice S-03 `blocked`.

The pipeline is the cheapest credible one the research converged on: **Astro API route → OpenRouter (Gemini Flash), structured JSON `{title, platform, confidence}` → ground through the already-shipped `lookupGameMetadata` → a Node CLI accuracy harness** that scores a labeled shelf sample and reports the guardrail number, abstain rate, and latency.

## Current State Analysis

Every server primitive the spike needs already exists and is in active use:

- **Route template** — `src/pages/api/library/index.ts` is a near-exact shape: `export const prerender = false`, auth gate via `locals.user`, module-level zod schema + `safeParse`, `Response.json({...}, { status })`. The `identify` route mirrors it.
- **Multipart upload precedent** — `src/pages/api/auth/signin.ts:5` / `signup.ts:5` already call `await request.formData()`. The image route uses the same API; the only net-new step is `File.arrayBuffer()` → base64 data URL (Web-API-only, workerd-safe).
- **Server-only secret plumbing** — `astro.config.mjs:17-24` declares four secrets via `envField.string({ context: "server", access: "secret", optional: true })`; consumed through `astro:env/server`. Adding `OPENROUTER_API_KEY` is a one-line mirror of the TWITCH wiring.
- **Grounding leg is shipped** — `src/lib/services/igdb.ts` `lookupGameMetadata(title, platform, kv)` returns a discriminated `{ status: "matched", igdbId, … } | { status: "no_match" }`, never throws on no-match. `resolvePlatformIds` (igdb.ts:101) maps free-text platform → IGDB ids. The spike feeds vision output straight in and reads back `igdbId`.
- **Runtime binding access** — `import { env } from "cloudflare:workers"` is the sanctioned path (foundation lesson: never `locals.runtime.env`); `env.IGDB_TOKENS` is the KV namespace grounding needs.

What's **missing** (all net-new, all additive):
- No route accepts an uploaded image; no OpenRouter integration exists.
- No vision service.
- No accuracy harness / fixtures infrastructure; no `scripts/` dir for dev tooling.
- `OPENROUTER_API_KEY` is not declared or set anywhere.

## Desired End State

A developer can drop ~30–50 labeled shelf photos into a gitignored `fixtures/shelf/`, run one command, and get a scored report stating:
1. **accuracy-when-answered** (IGDB-id + platform correct, over non-abstained cases) vs the ≥90% bar — the FR-005 pass/fail;
2. **abstain rate** (how often the model returned `unsure`);
3. **latency p50/p95** for the 10s NFR check;
4. an **angled-vs-straight breakdown** that says whether skew is dragging accuracy (i.e. whether deferred opencv.js rectification is needed later).

That number is recorded in a results doc with an explicit go/no-go: **≥90% → unblock S-03; <90% → photo path cut, S-01 manual entry becomes primary.**

Verification: the `identify` route returns a validated `{title, platform, confidence, igdbId, …}` (or `unsure`) for a posted photo, `npm run lint` and `npm run build` pass, and the harness produces a report against the real shelf.

### Key Discoveries:

- `src/pages/api/library/index.ts` — route template (prerender, auth, zod, Response.json).
- `src/lib/services/igdb.ts:142` — `lookupGameMetadata` returns `igdbId` on match; reuse as-is for grounding.
- `src/lib/services/igdb.ts:101` — `resolvePlatformIds` (vision platform string → IGDB ids).
- `astro.config.mjs:17-24` — where `OPENROUTER_API_KEY` slots in (mirror TWITCH).
- `src/pages/api/auth/signin.ts:5` — `request.formData()` upload precedent **and** the endpoint the harness logs in through.
- `docs/openrouter.md` — auth, base64 data URL (Worker-friendly), `response_format: json_schema strict`, model slug `google/gemini-2.5-flash`, full `fetch` example.
- Services convention: first arg an authenticated `SupabaseClient`; external handles (KV) passed in explicitly; zod at the boundary; discriminated-union results; best-effort external calls wrapped so a flaky API never costs user data.

## What We're NOT Doing

- **No opencv.js rectification** (client WASM island). Deferred per research §6/§8.5 — the harness's angled flag tells us later whether it's needed. The multi-MB lazy WASM island is net-new infra we build only if the numbers demand it.
- **No Path B** (CLIP + pgvector reverse-image search). Greenfield, scoped to v1.1+ (research §8.5).
- **No photo storage** (Supabase Storage / R2), no image column, no catalog cover-art grid. Those are S-03+ concerns.
- **No persistence** — the spike *produces and measures* `{title, platform}`; it does not write to `library_entries`. (`createLibraryEntry` is reused later by S-03, untouched here.)
- **No capture UI / mobile camera flow** — that's S-03 (FR-004). The harness exercises the server + model path, not the browser.
- **No GPT-4o escalation, no parallel-reconcile, no S-09 top-N grounding.** First-match grounding is enough to measure the guardrail; richer grounding is a parked follow-up.
- **No multi-game-per-photo, no edition/barcode recognition.** PRD non-goals.

## Implementation Approach

Build the reusable server path first (service → route), then the measurement tooling (harness → run). The route is auth-gated like the rest of the app so S-03 can reuse it verbatim; the harness authenticates through the existing signin endpoint the same way a real client would, so nothing throwaway leaks into the production path.

The harness runs over HTTP against a local `npm run dev` (workerd) instance — that gives the service real `astro:env/server` secrets and the `IGDB_TOKENS` KV binding without re-implementing the runtime in plain Node. Downscaling happens **in the harness before upload**, so the route stays a simple decode-what-it-receives surface and the latency reading reflects a realistic mobile-sized payload.

## Critical Implementation Details

- **Model latency dominates; the harness can't fully model the mobile uplink.** The 10s-p95 NFR is "on mobile broadband." The harness measures server-side + OpenRouter round-trip (the controllable part) against a local dev server — it does not include a real phone→Worker network leg. Record the p95 as the *server+model* figure and note the caveat; the model call (~0.8–1.5s for Flash) is the same wherever the route runs.
- **Large-image base64 footgun** (`docs/openrouter.md §2`): `btoa(String.fromCharCode(...))` over a huge byte spread can blow the stack. Harness-side downscaling to ~1024px keeps payloads small; still chunk the encode if needed.
- **Confidence threshold is the abstain gate** and must be a single named constant in the vision service so the harness's "answered vs abstained" split is reproducible and tunable in one place. Below threshold (or IGDB no-match, see Phase 2) → `unsure`.
- **Secrets are `optional: true` by design** (CI builds without live creds): the vision service throws loudly only at call time if `OPENROUTER_API_KEY` is absent — mirror the `createIgdbClient` pattern (igdb.ts:25).

## Phase 1: Plumb OpenRouter secret + vision service

### Overview

Add the OpenRouter secret and a server-side `identifyGameFromPhoto` service that calls Gemini Flash with a structured-JSON prompt and returns a discriminated `identified | unsure` result. No route yet — this phase is unit-testable in isolation against the live API.

### Changes Required:

#### 1. OpenRouter secret declaration

**File**: `astro.config.mjs`, `.dev.vars`, `.env.example`

**Intent**: Make `OPENROUTER_API_KEY` available as a server-only secret in every runtime (build, local Node, Cloudflare local dev, prod), mirroring the existing TWITCH wiring so CI still builds without live creds.

**Contract**: One `envField.string({ context: "server", access: "secret", optional: true })` line in `astro.config.mjs` `env.schema`; one `OPENROUTER_API_KEY=` line in `.dev.vars` (gitignored) and a documented placeholder in `.env.example`. Production set via `wrangler secret put OPENROUTER_API_KEY` (owner: user — note in results/handoff). Owner-action only; no code depends on the prod secret to build.

#### 2. Vision identification service

**File**: `src/lib/services/vision.ts` (new)

**Intent**: Given an image as a base64 data URL, ask Gemini Flash (via OpenRouter, raw `fetch`) for `{title, platform, confidence}`, validate the response, and collapse low-confidence answers into an explicit abstain. Follows the services convention (raw fetch, zod at the boundary, discriminated-union result, throws loudly only on missing secret / transport failure).

**Contract**: Export `identifyGameFromPhoto(imageDataUrl: string): Promise<VisionIdentifyResult>` where `VisionIdentifyResult = { status: "identified"; title: string; platform: string; confidence: number } | { status: "unsure"; confidence: number }`. Internally: POST `https://openrouter.ai/api/v1/chat/completions` with `model: "google/gemini-2.5-flash"`, a text-first + `image_url` content array, and `response_format: { type: "json_schema", json_schema: { name, strict: true, schema: {title, platform, confidence} } }` (see `docs/openrouter.md §3-4`). `JSON.parse` `choices[0].message.content`, then zod-validate. A named `CONFIDENCE_THRESHOLD` constant gates `identified` vs `unsure`. Reads the key via `astro:env/server`; throws if absent (mirror `createIgdbClient`). Non-2xx OpenRouter responses throw with the error body so callers/harness surface a clean failure.

**Note**: Confirm the live slug + vision/structured-output support at `https://openrouter.ai/models?q=gemini+flash` before wiring — `docs/openrouter.md §5` flags that the listing changes.

#### 3. Shared vision result type

**File**: `src/types.ts`

**Intent**: Co-locate the `VisionIdentifyResult` discriminated union with the other domain types, alongside `IgdbLookupResult`.

**Contract**: Export the `VisionIdentifyResult` union (or define it in `vision.ts` and re-export — match whatever the route + harness import). Keep the discriminant field name `status` consistent with `IgdbLookupResult`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint` (type-checked ESLint).
- Production build passes without the secret present: `npm run build`.

#### Manual Verification:

- With a real `OPENROUTER_API_KEY` in `.dev.vars`, a one-off call to `identifyGameFromPhoto` on a sample box photo returns a plausible `{title, platform, confidence}` and a low-confidence/garbage image collapses to `unsure`.
- Calling without the secret throws a clear, named error (not a silent 401 downstream).

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation that a live call returns sensible structured output before proceeding.

---

## Phase 2: Upload route + IGDB grounding

### Overview

Expose the vision service over an auth-gated upload route, and ground every `identified` result through the existing `lookupGameMetadata` so the response carries the resolved `igdbId` the harness scores on.

### Changes Required:

#### 1. Identify API route

**File**: `src/pages/api/identify.ts` (new)

**Intent**: Accept a single uploaded photo, run it through the vision service, ground a successful identification against IGDB, and return the proposed entry plus its grounded id — or an honest `unsure`. Auth-gated and runtime-correct so S-03 reuses it unchanged.

**Contract**: `export const prerender = false`. `export const POST: APIRoute`. Auth gate via `locals.user` → 401 (mirror `api/library/index.ts:32`). Read `request.formData()`, pull the image `File` under a fixed field name (e.g. `photo`), validate presence/type with zod → 400 on bad input. Build the base64 data URL from `File.arrayBuffer()` (Web APIs only; `docs/openrouter.md §2`). Call `identifyGameFromPhoto`. On `identified`, call `lookupGameMetadata(title, platform, env.IGDB_TOKENS)` (`import { env } from "cloudflare:workers"`); fold the result into the response (`igdbId` + `metadataStatus`, or null on `no_match`). On `unsure`, return the abstain without grounding. Response shape: `{ status: "identified", title, platform, confidence, igdbId: number | null, metadataStatus } | { status: "unsure", confidence }`. Grounding failure (thrown by IGDB transport) must not 500 the identification — wrap best-effort like `createLibraryEntry` (library.ts:55) and degrade `igdbId` to null. OpenRouter failures surface as a clean non-2xx with a JSON error body.

**Decision — abstain on IGDB no-match (load-bearing for the metric):** Because correctness is scored on IGDB-id agreement (Q2), a successful vision read that grounds to `no_match` has no id to score and should be treated as **`unsure`** in the response, not a confident answer — this keeps "wrong" (grounded to the *wrong* id) distinct from "couldn't ground" (abstain). The harness relies on this split.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`.
- Production build passes: `npm run build`.

#### Manual Verification:

- `curl`/REST-client POST of a multipart photo (with a signed-in session cookie) to `/api/identify` returns a grounded `{title, platform, confidence, igdbId}` for a recognizable game.
- An unauthenticated POST returns 401.
- A photo of a real game returns a non-null `igdbId`; an unidentifiable image returns `unsure`.
- A deliberately broken `OPENROUTER_API_KEY` yields a clean error response, not a stack trace.

**Implementation Note**: After this phase and automated verification passes, pause for manual confirmation that the end-to-end route (upload → vision → ground) returns a grounded id before building the harness.

---

## Phase 3: Accuracy harness + fixtures

### Overview

A Node CLI script that drives the `identify` route over the labeled shelf sample and emits the scored report — the spike's measurement engine.

### Changes Required:

#### 1. Fixtures layout + gitignore

**File**: `fixtures/shelf/` (new, gitignored), `fixtures/shelf/labels.csv`, `.gitignore`

**Intent**: A private home for the collector's own photos and their ground-truth labels that never enters version control.

**Contract**: `labels.csv` columns: `filename, true_title, true_platform, angled` (`angled` ∈ `{0,1}`) and optional `true_igdb_id` (lets the labeler pin an id when title+platform is ambiguous; otherwise the harness resolves it). Add `fixtures/shelf/` to `.gitignore`. Commit a tiny `fixtures/shelf/README.md` (and/or a `labels.example.csv`) documenting the format and that ~30–50 photos with an angled subset are expected; the photos themselves stay local.

#### 2. Harness script

**File**: `scripts/identify-harness.mjs` (new); a `package.json` script entry (e.g. `harness`)

**Intent**: For each labeled photo: downscale, POST to the running dev server, resolve the truth IGDB id, score the model's grounded id + platform, and aggregate the guardrail metrics.

**Contract**: Plain Node ESM (dev-only; native deps like a JS image lib are fine here — not workerd). Steps:
1. **Auth once** — POST collector dev creds (from env / `.dev.vars`) to `/api/auth/signin` as form data; capture and reuse the Supabase session cookies for subsequent requests (Node `fetch` + `Headers.getSetCookie()`).
2. **Per photo** — downscale to ~1024px long edge, JPEG (jimp or sharp — implementer's choice; prefer pure-JS to avoid native build friction on Windows); POST as multipart to `/api/identify`; record wall-clock latency.
3. **Resolve truth id** — use `true_igdb_id` if present; else resolve `true_title`+`true_platform` to an id (call `/api/identify` is not it — instead hit a tiny grounding path: simplest is to add a dev-only `GET /api/identify?title=&platform=` grounding shortcut, OR resolve truth ids once via the same `lookupGameMetadata` exposed through a minimal script-only endpoint). Keep this mechanism minimal and dev-only.
4. **Score** — a case is *answered* if the route returned `identified` with a non-null `igdbId`; *correct* if that id equals the truth id **and** platform matches (normalize platform the way `igdb.ts` does). `unsure`/no-id cases count toward the **abstain** bucket, not wrong.
5. **Report** — write `report.json` (+ console summary): accuracy-when-answered (% and n), abstain rate, latency p50/p95, and the same accuracy split for `angled=1` vs `angled=0`. Flag pass/fail vs ≥90% and vs 10s p95.

**Note — truth-id resolution:** the cleanest minimal approach is to reuse `lookupGameMetadata` for *both* sides (truth and model output). If exposing a dev-only grounding shortcut feels heavier than warranted, the harness may instead require `true_igdb_id` in the CSV and skip auto-resolution — decide during implementation, keeping the spike minimal. Either way, the scoring rule (id + platform over answered cases) is unchanged.

### Success Criteria:

#### Automated Verification:

- Harness runs end-to-end against a 2–3 photo smoke fixture without error: `npm run harness` (with `npm run dev` running).
- Type/lint clean on the script per repo config: `npm run lint`.

#### Manual Verification:

- Against the smoke fixture, the printed report shows sensible per-photo rows (proposed vs truth, correct flag, latency) and correct aggregate math.
- Abstain and angled breakdowns populate correctly when the fixture includes an unidentifiable and an angled photo.

**Implementation Note**: After this phase and the smoke run passes, pause for confirmation before the full real-shelf run.

---

## Phase 4: Run against the real shelf + record the verdict

### Overview

The binding deliverable: run the harness over ~30–50 of the collector's own labeled games and record the go/no-go.

### Changes Required:

#### 1. Real-shelf run

**File**: (operational — collector populates `fixtures/shelf/` + `labels.csv`)

**Intent**: Produce the guardrail number on real data.

**Contract**: ~30–50 front-of-box photos labeled with title+platform, an angled subset flagged. Run `npm run harness`; archive the generated `report.json` outside the gitignored fixtures (e.g. paste figures into the results doc — do not commit the private photos).

#### 2. Results + verdict doc

**File**: `context/changes/photo-identification-spike/results.md` (new)

**Intent**: Record the measured numbers and the explicit decision so S-03's `blocked` status can be resolved (or the photo path cut) with an auditable basis.

**Contract**: Capture accuracy-when-answered (with n), abstain rate, latency p50/p95 (with the local-dev caveat), angled-vs-straight accuracy, and the **verdict**: ≥90% → recommend unblocking S-03 (note whether the angled subset suggests rectification is needed in S-03/v1.1); <90% → recommend cutting the photo path, S-01 manual entry becomes primary (per roadmap risk note). Cross-link the roadmap F-03 / S-03 entries.

### Success Criteria:

#### Automated Verification:

- `report.json` is generated from the full real-shelf run.

#### Manual Verification:

- `results.md` states the accuracy number, abstain rate, latency p95, angled finding, and an unambiguous go/no-go recommendation tied to the ≥90% guardrail and 10s-p95 NFR.
- The decision is reflected back to the roadmap (S-03 unblock or cut).

**Implementation Note**: This phase's output is the spike's reason for existing — the recorded number and verdict. After it, the change can be archived.

---

## Testing Strategy

### Unit Tests:

- No test runner is configured and the spike is exploratory — automated coverage is intentionally light. The vision service's zod validation and confidence gating are the only logic worth a focused manual check (sensible structured output in, `identified`/`unsure` out).

### Integration Tests:

- The harness *is* the integration test: it exercises auth → upload → vision → grounding → scoring end-to-end over real inputs. The smoke fixture (Phase 3) is the repeatable correctness check on the harness itself.

### Manual Testing Steps:

1. Set `OPENROUTER_API_KEY` (and confirm TWITCH creds for grounding) in `.dev.vars`; `npm run dev`.
2. POST a known game photo to `/api/identify`; confirm grounded `{title, platform, igdbId}`.
3. POST an unidentifiable image; confirm `unsure`.
4. Run the harness on the 2–3 photo smoke fixture; verify report math.
5. Run on the full shelf; record numbers in `results.md`.

## Performance Considerations

- Flash is the fast tier (~0.8–1.5s typical); the 10s-p95 budget is comfortable for a single call. Harness-side downscaling to ~1024px keeps base64 upload small. The harness latency figure excludes the real phone→Worker uplink — record it as server+model latency with that caveat.

## Migration Notes

- None. No schema changes, no data written. `OPENROUTER_API_KEY` must be set as a prod Worker secret (`wrangler secret put`) only when the route is exercised in production — not required for the spike's local measurement.

## References

- Codebase research: `context/changes/photo-identification-spike/research.md`
- Solution-space survey: `context/changes/photo-identification-spike/external-research.md`
- API/library docs: `context/changes/photo-identification-spike/docs/{openrouter.md, opencv-js.md, README.md}`
- Route template: `src/pages/api/library/index.ts`
- Grounding service: `src/lib/services/igdb.ts:142` (`lookupGameMetadata`), `:101` (`resolvePlatformIds`)
- Best-effort enrichment pattern: `src/lib/services/library.ts:55-72`
- Secret wiring precedent: `astro.config.mjs:17-24`, `src/lib/services/igdb.ts:25`
- Roadmap: `context/foundation/roadmap.md` (F-03, S-03); PRD FR-005 + `§Success Criteria > Guardrails`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Plumb OpenRouter secret + vision service

#### Automated

- [x] 1.1 Type checking passes: `npm run lint`
- [x] 1.2 Production build passes without the secret present: `npm run build`

#### Manual

- [x] 1.3 Live call returns plausible `{title, platform, confidence}`; garbage image collapses to `unsure`
- [x] 1.4 Calling without the secret throws a clear, named error

### Phase 2: Upload route + IGDB grounding

#### Automated

- [ ] 2.1 Type checking passes: `npm run lint`
- [ ] 2.2 Production build passes: `npm run build`

#### Manual

- [ ] 2.3 Authenticated multipart POST to `/api/identify` returns grounded `{title, platform, confidence, igdbId}`
- [ ] 2.4 Unauthenticated POST returns 401
- [ ] 2.5 Real game → non-null `igdbId`; unidentifiable image → `unsure`
- [ ] 2.6 Broken `OPENROUTER_API_KEY` yields a clean error response, not a stack trace

### Phase 3: Accuracy harness + fixtures

#### Automated

- [ ] 3.1 Harness runs end-to-end on a 2–3 photo smoke fixture: `npm run harness`
- [ ] 3.2 Type/lint clean per repo config: `npm run lint`

#### Manual

- [ ] 3.3 Smoke report shows sensible per-photo rows and correct aggregate math
- [ ] 3.4 Abstain and angled breakdowns populate correctly

### Phase 4: Run against the real shelf + record the verdict

#### Automated

- [ ] 4.1 `report.json` generated from the full real-shelf run

#### Manual

- [ ] 4.2 `results.md` states accuracy, abstain rate, latency p95, angled finding, and a clear go/no-go
- [ ] 4.3 Decision reflected back to the roadmap (S-03 unblock or cut)
