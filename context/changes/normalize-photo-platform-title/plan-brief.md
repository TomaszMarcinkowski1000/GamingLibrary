# Normalize Photo-Extracted Platform Aliases and Title Casing — Plan Brief

> Full plan: `context/changes/normalize-photo-platform-title/plan.md`

## What & Why

Photo adds currently save the vision model's raw strings verbatim — platform `"PC DVD"` and ALL-CAPS
titles like `"MAFIA THE OLD COUNTRY"` — into the user's library. This change normalizes those reads
(platform aliases → canonical labels, shouty titles → Title Case) so a collector's shelf shows clean
data. (Roadmap v1 Hardening H-03 / GitHub #24, type: bug.)

## Starting Point

`identifyGameFromPhoto` (`vision.ts:130-134`) returns the model's `title`/`platform` unchanged, and
`/api/identify` passes them into both IGDB grounding and the saved `library_entries` row
(`library.ts:137-138`). Grounding already tolerates aliases and case (`resolvePlatformIds`,
`normalizeBaseTitle`), so the defect is purely in what gets stored and shown.

## Desired End State

A confident photo read returns and saves `"PC"` (not `"PC DVD"`) and `"Mafia the Old Country"` (not
`"MAFIA THE OLD COUNTRY"`), while correctly-cased reads (`inFAMOUS`, `LittleBigPlanet`) and embedded
acronyms (`Portal RTX`) pass through untouched. The grounded IGDB id is identical to before for every
input — normalization cannot regress grounding.

## Key Decisions Made

| Decision              | Choice                                              | Why (1 sentence)                                                                 | Source |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Title-case algorithm  | Smart (minor words lowercased, roman numerals kept) | Produces real-looking titles, not naive per-word capitalization.                 | Plan   |
| Casing gate           | Per-word all-caps + short-acronym guard             | Fixes partial shouts and preserves stylization/acronyms.                         | Plan   |
| Acronym-guard scope   | Mixed-case titles only                              | A length-only guard would freeze real 3-letter words (`OLD`) in shouty titles.   | Plan   |
| Platform alias map    | Mirror the existing alias→id set, → canonical label | Display normalizes exactly what grounding already recognizes — no gaps/over-reach.| Plan   |
| Placement             | In `vision.ts`, helpers in `platforms.ts`           | Service owns its output; route, save, and harness inherit it from one call site. | Plan   |
| Testing               | Table-driven unit tests on both pure helpers        | Locks the rules cheaply; grounding tests cover id-invariance.                    | Plan   |

## Scope

**In scope:**
- `normalizePlatformLabel()` + alias→label map in `platforms.ts`.
- `normalizeTitleCasing()` (two-mode gate) in `platforms.ts`.
- Table-driven Vitest cases.
- Two-line wiring in `vision.ts`.

**Out of scope:**
- Manual-add path (`createLibraryEntry`) — uses canonical picklist + user-typed title.
- Editing `PLATFORM_IDS_BY_NAME` / its harness mirror — grounding already works.
- Backfilling already-saved rows; read/display-time normalization.
- Heuristic acronym recovery for fully-shouty titles (`FIFA 23` → `Fifa 23` is accepted).

## Architecture / Approach

Two pure string helpers in `src/lib/platforms.ts`, unit-tested in isolation, then applied to the model
read inside `identifyGameFromPhoto` before it returns `identified`. Because the vision service is the
single choke point, `/api/identify` (grounding, persist-save, harness, both response bodies) inherits
normalized fields with no route edit. Grounding-id invariance — guaranteed by `resolvePlatformIds`
and `normalizeBaseTitle` already collapsing aliases/case — is what makes normalizing before grounding
safe and lets us skip the harness-map mirror.

## Phases at a Glance

| Phase                            | What it delivers                                              | Key risk                                                              |
| -------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| 1. Normalization helpers + tests | Two pure helpers + alias map + table-driven Vitest cases     | Acronym-guard scoping: a length-only guard breaks `MAFIA THE OLD …`. |
| 2. Wire into the vision service  | Normalized `identified` result; consumers inherit it         | A consumer re-deriving from a raw source (none expected — verify).   |

**Prerequisites:** None — self-contained, no schema/binding/env changes.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- A fully-shouty acronym title (`FIFA 23`) loses its caps (`Fifa 23`) — accepted tradeoff, documented.
- Assumes no consumer re-reads title/platform from a raw source bypassing the vision result
  (Phase 2 verifies this; `identify.ts` confirms it).
- `Xbox Series S` reads are preserved as `"Xbox Series S"` though grounding still collapses them to
  one id — a deliberate display choice.

## Success Criteria (Summary)

- Photo-adding an ALL-CAPS box saves a Title-Case title; a `PC DVD` box saves platform `"PC"`.
- The grounded game is identical to before normalization (no recall/precision regression).
- `npm test`, `npm run lint`, `npm run build` all green.
