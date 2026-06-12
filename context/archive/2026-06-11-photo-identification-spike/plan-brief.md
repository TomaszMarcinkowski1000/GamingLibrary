# Photo-identification spike (F-03) — Plan Brief

> Full plan: `context/changes/photo-identification-spike/plan.md`
> Research: `context/changes/photo-identification-spike/research.md`
> Solution survey: `context/changes/photo-identification-spike/external-research.md`

## What & Why

A **spike** to answer one binding question: can a vision model identify a video game's **title + platform at ≥90%** on the collector's own shelf, within **10s p95**? That threshold is the hard pass/fail gate for FR-005 and the only thing keeping the north-star slice S-03 (photo-to-library) `blocked`. The deliverable is a *number + verdict*, not a shipped feature.

## Starting Point

Every server primitive already exists: `api/library/index.ts` is a route template (prerender, auth, zod), `lookupGameMetadata` is a shipped IGDB grounding service, and secret plumbing mirrors the existing TWITCH wiring. Nothing does image upload or vision yet, and there's no measurement harness.

## Desired End State

A developer drops ~30–50 labeled shelf photos into a gitignored `fixtures/shelf/`, runs one command, and gets a report: accuracy-when-answered vs ≥90%, abstain rate, latency p50/p95, and an angled-vs-straight breakdown. That number is recorded with an explicit go/no-go — **≥90% → unblock S-03; <90% → photo path cut, S-01 manual entry becomes primary.**

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Vision provider | OpenRouter → Gemini Flash (`google/gemini-2.5-flash`), structured JSON | Cheapest model that reads stylized title fonts in context; one key to A/B others later | Research |
| Grounding | Reuse shipped `lookupGameMetadata` (first-match) | Kills ~20% hallucinated titles; already in-repo, zero build | Research |
| Harness form | Node CLI script + gitignored fixtures folder | No throwaway UI; cheap reruns; keeps private shelf photos out of the repo | Plan |
| Correctness metric | IGDB-id match (post-grounding) + platform | Deterministic, automatable, matches what the user actually sees | Plan |
| Abstain policy | Report accuracy-when-answered **and** abstain rate; 90% applies to answered | Separates "wrong" from "honestly unsure" (S-03 falls back to manual on abstain) | Plan |
| Sample | ~30–50 hand-labeled photos, angled subset flagged | Enough for 90% to be meaningful; angled flag enables the rectification A/B | Plan |
| Rectification (opencv.js) | Defer | Build the multi-MB WASM island only if angled shots drag accuracy below 90% | Research |
| Downscaling | In the harness, before upload | Realistic payload for latency; keeps the route a simple decode surface | Plan |

## Scope

**In scope:** OpenRouter secret plumbing · `vision.ts` service (`identified | unsure`) · auth-gated `/api/identify` upload route with IGDB grounding · Node CLI accuracy harness + fixtures · real-shelf run + results/verdict doc.

**Out of scope:** opencv.js rectification · Path B (CLIP+pgvector) · photo storage / cover-art grid · persistence to `library_entries` · capture UI / mobile camera (S-03) · GPT-4o escalation · S-09 top-N grounding.

## Architecture / Approach

`harness (downscale + auth) → POST /api/identify (multipart → base64 data URL) → vision.ts (Gemini Flash, structured JSON, confidence gate) → lookupGameMetadata (IGDB-id) → scored report`. Server path is auth-gated so S-03 reuses it; the harness runs over HTTP against local `npm run dev` (workerd) to get real secrets + the `IGDB_TOKENS` KV binding without re-implementing the runtime in Node.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Vision service | `OPENROUTER_API_KEY` plumbed + `identifyGameFromPhoto` (`identified`/`unsure`) | Confirming the live Gemini Flash slug + structured-output support |
| 2. Route + grounding | Auth-gated `/api/identify`: upload → vision → IGDB-id | Base64 of large images (stack-blow); best-effort grounding must not 500 |
| 3. Harness + fixtures | Node CLI: score, abstain, latency, angled breakdown | Harness auth to dev server; resolving truth IGDB ids cleanly |
| 4. Run + verdict | Real-shelf number + go/no-go in `results.md` | Small-sample variance; latency excludes real mobile uplink |

**Prerequisites:** `OPENROUTER_API_KEY` (owner: user) in `.dev.vars`; existing TWITCH creds for grounding; ~30–50 labeled shelf photos. No blocking slices (F-01/F-02/S-01 done).
**Estimated effort:** ~2 sessions — one to build service+route+harness, one to gather the shelf sample and run.

## Open Risks & Assumptions

- **The decisive unknown is real-shelf title accuracy on stylized fonts** — exactly what the harness measures; can't be known until the run.
- Small sample (~30–50) means the % is directional, not precise — a handful of misses swings it.
- Latency p95 is server+model only; the real phone→Worker uplink is unmodeled (noted in results).
- First-match grounding may under-resolve some real games (counts as abstain, not wrong) — if it drags the number, S-09 top-N grounding is the parked lever.

## Success Criteria (Summary)

- A scored report exists from the real shelf with accuracy-when-answered, abstain rate, and latency p50/p95.
- `results.md` states an unambiguous go/no-go against the ≥90% guardrail and 10s-p95 NFR.
- The decision is reflected back to the roadmap — S-03 unblocked, or the photo path cut in favor of S-01.
