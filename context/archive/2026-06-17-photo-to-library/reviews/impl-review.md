<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Add a game via photo (S-03, north star)

- **Plan**: context/changes/photo-to-library/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated gates re-run live on review: `npm run build` ✅, `npm run lint` ✅, `npx prettier --check` ✅, 103/103 unit tests ✅.

All 8 planned changes verified MATCH — no DRIFT, no MISSING. The two load-bearing risks the plan flagged both hold: the `persist` flag correctly inverts the `no_match→unsure` fold (`identify.ts:184-219`), and the harness path (GET + POST-without-persist) is byte-for-byte unchanged. DB write is auth-gated (`identify.ts:136`) and RLS-scoped via the cookie anon client (no service-role bypass); exactly one IGDB lookup on the persist path (`identify.ts:175`); MediaStream torn down on all four exit paths (`CameraCapture.tsx:69-137`). The Phase-3 getUserMedia camera pivot is fully documented in the plan's "What We're NOT Doing" (OBSOLETE note); `.gitignore`/`.prettierignore` edits are intentional and documented.

## Findings

### F1 — No in-flight guard on submitBlob → possible double-persist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/library/PhotoCapture.tsx:125-165
- **Detail**: submitBlob() persists a library_entries row on every confident read. The full-screen pending overlay (z-50, fixed inset-0) and disabled buttons block the gallery path well, and CameraCapture stops its stream on capture — so the realistic window is narrow. But there is no ref-based guard at the top of submitBlob itself: two rapid camera captures (or a timeout-then-retry where the server actually saved) can each POST with persist=true and create a duplicate entry. No server-side idempotency catches it.
- **Fix**: Add a `useRef` in-flight flag — early-return at the top of submitBlob if already pending — instead of relying on the overlay/disabled state to serialize calls.
- **Decision**: FIXED — added `inFlightRef` latch (set before, released in `finally`); early-return at top of `submitBlob`. PhotoCapture.tsx.

### F2 — IdentifyResponse type declared twice (route + island)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/identify.ts:31-46 & src/components/library/PhotoCapture.tsx:20-30
- **Detail**: IdentifyResponse is defined in the route and hand-copied as a structural mirror in the island (the PhotoCapture comment at :15-18 acknowledges the duplication). Project convention is "shared types go in src/types.ts" — LibraryEntry / MetadataStatus / IgdbLookupResult are correctly shared, but this response shape is not, so the two copies can silently drift. The plan made the types.ts change conditional ("only if a shared type is warranted"); a type consumed on both client and server is the warranting case.
- **Fix**: Lift IdentifyResponse into src/types.ts and import it on both sides.
- **Decision**: FIXED — `IdentifyResponse` now lives in src/types.ts (full route shape incl. optional `debug`); imported by identify.ts and PhotoCapture.tsx. Removed the now-unused `MetadataStatus` import from both.

### F3 — Abort-but-saved leaves a duplication seam

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/components/library/PhotoCapture.tsx:155-160
- **Detail**: On the 30s AbortError, the server may have already completed the insert; the row exists but the response was dropped. The UX copy ("your game may already be saved") mitigates this honestly, but a user retry yields a duplicate. Acceptable for the slice — same root seam as F1, which a server-side idempotency key would close later.
- **Fix**: None now — flagged for a future idempotency pass.
- **Decision**: SKIPPED — accepted as a known seam for a future server-side idempotency pass (F1's client-side latch narrows but does not close it).
