<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Photo-identification spike (F-03)

- **Plan**: context/changes/photo-identification-spike/plan.md
- **Scope**: Phases 1–4 (all)
- **Date**: 2026-06-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated re-run: `npm run lint` ✅ (clean; only pre-existing astro-parser notices) · `npm run build` ✅ (8.96s). All 13 Progress checkboxes `[x]` with commit evidence; harness ran on 116 real photos (report.json + results.md verdict). All 7 planned changes (Phases 1–3) verified MATCH — no drift, no missing. Every "What We're NOT Doing" guardrail confirmed absent (no opencv, no library_entries persistence, no photo storage, no GPT-4o escalation, no multi-game). Load-bearing decision (IGDB `no_match` → `unsure`) correctly implemented at identify.ts:161-163.

## Findings

### F1 — Stray tool-wrapper tags in results.md (the binding deliverable)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/photo-identification-spike/results.md:114-115
- **Detail**: The spike's reason-for-existing document ends with two stray XML tags — `</content>` and `</invoke>` — leaked from a tool-call wrapper when the file was written. The verdict content above is intact and correct, but the binding deliverable has garbage trailing lines.
- **Fix**: Delete lines 114–115 (`</content>` and `</invoke>`); file should end at line 113.
- **Decision**: FIXED

### F2 — Route base64-encodes uploads with no size cap / server downscale

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/pages/api/identify.ts:131
- **Detail**: Downscaling lives only in the harness (sharp → 1024px). The route decodes raw uploaded bytes with no max `file.size`. Correct for the spike (only client is the pre-shrinking harness), but S-03's real mobile-camera client has no such guard. sharp is not workerd-safe, so a server-side downscale needs a Worker-compatible path.
- **Fix**: For S-03, enforce a max `file.size` in `uploadSchema` or add a workerd-safe downscale before the OpenRouter call.
- **Decision**: FIXED — added 10 MB `MAX_UPLOAD_BYTES` cap to `uploadSchema`; workerd-safe downscale still deferred to S-03.

### F3 — OpenRouter error body propagated verbatim to client

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Security)
- **Location**: src/lib/services/vision.ts:104-107 → src/pages/api/identify.ts:139-142
- **Detail**: A non-2xx OpenRouter response throws the full upstream `errorBody`, which the route surfaces as a 502 to the caller. Helpful for the auth-gated spike; in S-03 it could leak provider/account detail (model slugs, quota hints) to end users.
- **Fix**: For S-03, log the body server-side and return a generic message.
- **Decision**: FIXED — body now `console.error`'d server-side; thrown message is status-only (no upstream body).

### F4 — Unguarded JSON.parse of model content

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/services/vision.ts:113
- **Detail**: `choices[0].message.content` is `JSON.parse`'d directly. strict structured output should guarantee valid JSON, but a refusal/malformed payload throws `SyntaxError` instead of folding to `unsure`. The route's try/catch still catches it (→ clean 502, no stack trace), so this is robustness, not a hole.
- **Fix**: For S-03, wrap the parse and collapse malformed output to `unsure`.
- **Decision**: FIXED — `JSON.parse` + schema validation wrapped in try/catch; malformed payload now folds to `{ status: "unsure", confidence: 0 }`.

### F5 — Harness duplicates igdb.ts platform map ("keep in sync" risk)

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/identify-harness.mjs:42-92
- **Detail**: `PLATFORM_IDS_BY_NAME` is copied from igdb.ts (intentional — throwaway dev tooling can't import the TS service, documented at :38-40). If the production map grows and this copy doesn't, harness scoring diverges silently. The results.md verdict already named platform-string gaps (PSVita/PSP/multi-platform) as one of the false-negative buckets.
- **Fix**: Acceptable for a closing-out spike. If the harness outlives it, fold the platform-normalization fix here when S-09 grounding lands.
- **Decision**: FIXED — added a reciprocal "DUPLICATED / mirror the harness" pointer to igdb.ts so the drift risk is visible from the production side, not just the harness side.
