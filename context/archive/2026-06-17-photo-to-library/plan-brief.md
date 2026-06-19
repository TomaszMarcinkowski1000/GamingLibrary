# Add a game via photo (S-03, north star) — Plan Brief

> Full plan: `context/changes/photo-to-library/plan.md`

## What & Why

The north-star slice: a collector captures or uploads a single-game box photo from a browser (including the mobile camera), the system identifies game + platform, and the identified entry is **auto-saved** into the library with IGDB metadata attached — then reopened for review/correction. If it can't be identified, the user is offered manual entry instead of an auto-saved guess. This is the validation milestone (`market-feedback` goal): it proves the core product bet — affordable photo entry — and carries the binding ≥90% identify guardrail (already cleared by S-09 at 92.9%).

## Starting Point

Nearly every primitive exists. `POST /api/identify` (auth-gated) already runs vision (Gemini Flash, ~95% read) → IGDB grounding (S-09 edition-collapse), but **persists nothing**. The unified `GameDialog` already reopens a just-created entry in edit mode for review — the exact correction seam this slice needs — but is trigger-driven and can't be opened programmatically. The create-with-enrichment service, RLS-isolated `library_entries` table, and env/KV plumbing are all shipped. The genuinely new work is capture UI + persistence glue + the mobile-camera NFR.

## Desired End State

From the library page, "Add via photo" (the primary add affordance) lets the user pick an existing phone photo or shoot a new one; within a few seconds the identified, metadata-attached entry opens in the review dialog already saved — or, on a confident read with no IGDB match, saved with a no-metadata flag — or, when unidentifiable, the empty manual-add form opens. Works end-to-end on mobile Chrome/Firefox/Safari/Edge with no desktop step.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Save UX | Auto-save then auto-open review | FR-006 literal smooth path, plus a correction nudge via the existing add→edit seam | Plan |
| Persistence locus | Identify route persists server-side | One round trip, one IGDB lookup (reuses the grounding already computed) | Plan |
| No-match handling | Confident read + IGDB no_match still auto-saves (`metadata_status='no_match'`); only vision `unsure` → manual | Preserves a confident game+platform read; mirrors S-01 | Plan |
| Capture control | Native `<input type="file" accept="image/*">`, **no** `capture` attr | One control gives BOTH gallery-upload and camera across all four browsers; `capture` would block gallery picks | Plan |
| Downscaling | Client-side canvas (~1024px, JPEG, EXIF orientation) | Required (workerd can't resize) + cuts mobile uplink and stays under the 10 MB cap | Plan |
| Entry point | "Add via photo" primary, "Add manually" secondary | Foregrounds the killer feature; manual stays one tap away | Plan |
| Acceptance bar | Ship on S-09's 92.9% + manual E2E (no harness re-run gate) | Identify path unchanged since S-09; re-run only re-confirms a known number | Plan |

## Scope

**In scope:** opt-in persistence on `/api/identify` (+ `createLibraryEntryFromGrounding`); photo-capture island (file input, client downscale, identify wiring, branch to review/manual); `GameDialog` controlled-open mode; library-header primary photo affordance + empty-state CTA; cross-browser mobile validation.

**Out of scope:** edition precision; multi-game/shelf scanning; photo storage; vision/grounding changes; harness re-run as a gate; opencv.js rectification; `getUserMedia` live capture; confirm-before-save gate.

## Architecture / Approach

`PhotoCapture` island: select/shoot → `downscaleImage` (canvas) → `POST /api/identify` (multipart `photo` + `persist`) → route runs the shipped vision→grounding path and, when persist is on and the read is confident, inserts via `createLibraryEntryFromGrounding` (matched **or** no_match) and returns the created `LibraryEntry`. Island branches: identified → open `GameDialog` (controlled) seeded with the entry; unsure/error → empty manual add. The harness path (POST without `persist`) is byte-for-byte unchanged, including its `no_match → unsure` fold.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Server: persist-on-identify | Opt-in `persist` flag + `createLibraryEntryFromGrounding`; harness untouched | Branching the no_match fold per persist flag without breaking the harness metric |
| 2. Client: photo-capture island | File-input capture, canvas downscale, identify wiring, controlled `GameDialog` | EXIF orientation; controlled-open without regressing existing dialog usages |
| 3. Page integration + validation | Primary photo affordance, empty-state CTA, refresh; cross-browser matrix | The binding mobile-camera NFR across four browsers |

**Prerequisites:** all done — F-01/F-02/F-03/S-01/S-02/S-09. Production needs `wrangler secret put OPENROUTER_API_KEY`; local manual tests need `.dev.vars` creds + a phone on the same network (or tunneling) for the mobile matrix.
**Estimated effort:** ~2–3 sessions across 3 phases (Phase 3's cross-browser pass is the long pole).

## Open Risks & Assumptions

- **Mobile-camera cross-browser behavior** is the residual unknown — the native file input is the lowest-risk choice but the four-browser matrix is still where breakage would surface (the NFR guardrail).
- **EXIF orientation** must be applied in the downscale or portrait shots tank the read; browser support for `imageOrientation: "from-image"` is assumed and verified in Phase 2.
- **Assumption:** persisting from the already-computed `IgdbLookupResult` needs no second IGDB call — confirmed by the route already holding the full result.

## Success Criteria (Summary)

- A user captures/uploads a box photo and an identified, IGDB-enriched entry lands in their library, open for review — end-to-end on mobile, no desktop step.
- Unidentifiable photos route to manual entry, never an auto-saved guess; confident-but-no-match reads still save (with a no-metadata flag).
- `npm run build` / `npm run lint` and the unit tests pass; the existing `npm run harness` still runs unchanged.
