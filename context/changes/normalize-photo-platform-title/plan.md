# Normalize Photo-Extracted Platform Aliases and Title Casing Implementation Plan

## Overview

Photo-add reads (`identifyGameFromPhoto` in `src/lib/services/vision.ts`) return the vision
model's raw strings verbatim — platform `"PC DVD"` and ALL-CAPS titles like
`"MAFIA THE OLD COUNTRY"`. Those raw strings flow straight into IGDB grounding **and** into the
saved `library_entries` row, so a collector's shelf shows shouty titles and media-format platform
labels. This plan adds two pure normalization helpers to `src/lib/platforms.ts` — a platform
alias→canonical-label map and an all-caps title-casing function — and calls them inside the vision
service so the returned `identified` result already carries clean values. Every downstream consumer
(the `/api/identify` route, the persist-save path, and the accuracy harness) inherits the
normalized fields with no route change.

## Current State Analysis

- **The raw strings are persisted, not just displayed.** `vision.ts:130-134` returns
  `parsed.title` / `parsed.platform` verbatim. `src/pages/api/identify.ts` passes
  `vision.title` / `vision.platform` to both `lookupGameMetadata` (grounding) and
  `createLibraryEntryFromGrounding` (`library.ts:137-138`), which writes them straight into the
  `title` / `platform` columns. So the bug lands in stored data, not just one screen.
- **Grounding already tolerates aliases — this change cannot regress it.** `resolvePlatformIds`
  (`igdb.ts:124`) already maps `"pc dvd"`→`[6]`, `"psvita"`→`[46]`, etc., and `normalizeBaseTitle`
  (`igdb.ts:220`) lowercases titles for matching. Normalizing `"PC DVD"`→`"PC"` before grounding
  resolves to the **same** id set `[6]`; title-casing is invisible to `normalizeBaseTitle`. The IGDB
  id the harness scores on is therefore invariant under this normalization.
- **No existing helper does alias→canonical *display* label.** `KNOWN_PLATFORMS` (`platforms.ts`)
  is the human picklist; `PLATFORM_IDS_BY_NAME` (`igdb.ts:62-102`) is alias→IGDB-id. Neither maps an
  alias to a canonical *label*. This change adds that third map to `platforms.ts`.
- **`PLATFORM_IDS_BY_NAME` is hand-duplicated** in `scripts/identify-harness.mjs` (`igdb.ts:59-61`).
  This plan does **not** touch that map, so the duplication is not a concern here (see Critical
  Implementation Details).
- **Tests** run with `npm test` (`vitest run`); `src/lib/platforms.test.ts` already exercises
  `KNOWN_PLATFORMS` against `resolvePlatformIds` and is the natural home for the new cases.

## Desired End State

A confident photo read returns — and saves — a canonical platform label and human-cased title:

- `platform: "PC DVD"` → `"PC"`, `"PSVita"` → `"PlayStation Vita"`, and every other alias the
  grounding map already recognizes resolves to a canonical display label.
- `title: "MAFIA THE OLD COUNTRY"` → `"Mafia the Old Country"`, while correctly-cased reads
  (`"inFAMOUS"`, `"LittleBigPlanet"`) and embedded acronyms (`"Portal RTX"`) pass through untouched.
- The grounded IGDB id is unchanged for every input (verified by the existing `igdb` tests still
  passing and the harness scoring identically).

Verify by: `npm test` green (new table-driven cases), `npm run lint` and `npm run build` clean, and
a manual photo add of an all-caps / `PC DVD` box showing the normalized values in the saved entry.

### Key Discoveries:

- Persisted verbatim at `vision.ts:130-134` → `identify.ts:158,175-178` → `library.ts:137-138`.
- Grounding is alias- and case-tolerant already: `resolvePlatformIds` (`igdb.ts:124`),
  `normalizeBaseTitle` (`igdb.ts:220`) — so normalization is cosmetic-but-persisted, zero grounding risk.
- `normalizePlatform` (`igdb.ts:105`) is the canonical normalize-for-lookup shape (lowercase, trim,
  collapse whitespace) — the new `normalizePlatformLabel` mirrors it for its map key.
- Vision service is the single choke point: normalizing there means the route needs no edit.

## What We're NOT Doing

- **Not touching the manual-add path** (`createLibraryEntry`, `library.ts:55`). It seeds platforms
  from the canonical `KNOWN_PLATFORMS` picklist and takes a user-typed title — neither is a shouty
  model artifact. Normalizing user input there is out of scope.
- **Not editing `PLATFORM_IDS_BY_NAME`** (`igdb.ts`) or its harness mirror — grounding already works
  and ids are invariant under this change.
- **Not normalizing on read/display** of existing rows — no backfill/migration of already-saved
  entries. This fixes new photo adds going forward only.
- **Not building heuristic acronym detection for fully-shouty titles.** A fully ALL-CAPS read like
  `"FIFA 23"` becomes `"Fifa 23"` (documented tradeoff); we do not try to recover that it was an
  acronym.
- **Not word-listing the roman-numeral guard.** Real words made only of roman-numeral letters
  (`"MIX"`, `"DIM"`, `"CIVIC"`, `"MILD"`) stay uppercase (e.g. `"DJ MIX"` → `"Dj MIX"`). Same
  regex-can't-infer-intent class as the FIFA tradeoff; over-preserving instead of over-folding, and
  rare for game titles, so we accept it rather than maintain a word list.
- **Not changing the vision prompt, model, or confidence gate.**

## Implementation Approach

Two pure, side-effect-free string helpers in `src/lib/platforms.ts`, fully unit-tested in isolation,
then a two-line wiring change in `vision.ts` that applies them to the model read before it returns an
`identified` result. Because the vision service owns its output contract, the route, the persist
path, and the harness all inherit normalized fields with no further edits.

## Critical Implementation Details

- **Acronym guard is scoped to mixed-case titles only — this is the load-bearing rule.** A pure
  "keep all-caps tokens ≤3 chars uppercase" guard misfires on real short words: `"MAFIA THE OLD
  COUNTRY"` would yield `"Mafia the OLD Country"` (`OLD` mistaken for an acronym). So
  `normalizeTitleCasing` first classifies the whole title: **fully shouty** (no token contains a
  lowercase letter) vs **mixed** (at least one token does). In the fully-shouty branch every token is
  re-cased uniformly (minor-word and roman-numeral rules apply, **no** acronym guard). In the mixed
  branch the acronym guard applies, protecting genuine embedded acronyms (`Portal RTX`) while still
  re-casing longer shouty tokens (`Call of DUTY` → `Call of Duty`). Get this ordering wrong and the
  headline bug example regresses.
- **Per-token precedence (both branches):** (1) if the token is a minor word and not first → lowercase;
  (2) else if it is a roman numeral → keep uppercase; (3) [mixed branch only] else if its alphabetic
  length ≤ 3 → keep uppercase (acronym); (4) else → title-case (first upper, rest lower). Checking
  minor-word *before* the acronym guard is what keeps `THE`/`AND`/`FOR` (3-letter minor words) from
  being frozen as acronyms.
- **Grounding-id invariance is the safety property.** Normalizing before grounding is only safe
  because `resolvePlatformIds` and `normalizeBaseTitle` already collapse aliases/case. Do not move
  normalization to *after* grounding, and do not change `PLATFORM_IDS_BY_NAME` — either would break
  the invariant that lets us skip the harness-mirror update.

## Phase 1: Normalization helpers + tests

### Overview

Add the two pure helpers and their supporting data to `src/lib/platforms.ts`, and cover them with
table-driven Vitest cases in `src/lib/platforms.test.ts`. No caller is wired yet — the phase is fully
verifiable in isolation.

### Changes Required:

#### 1. Platform alias→canonical-label map + lookup

**File**: `src/lib/platforms.ts`

**Intent**: Add a map from normalized platform alias to a canonical display label, plus a
`normalizePlatformLabel(raw)` helper that returns the canonical label on a hit and the trimmed input
unchanged on a miss. Covers exactly the alias set `PLATFORM_IDS_BY_NAME` already recognizes, so what
grounding accepts and what we display stay in lockstep.

**Contract**: New exports `PLATFORM_DISPLAY_BY_ALIAS: ReadonlyMap<string, string>` and
`normalizePlatformLabel(raw: string): string`. The lookup key is produced by the same normalization
shape as `igdb.ts`'s `normalizePlatform` (lowercase, trim, collapse internal whitespace) — replicate
it locally rather than importing from the IGDB service (keep `platforms.ts` free of an `igdb` import).
Canonical targets prefer `KNOWN_PLATFORMS` wording. Alias → label coverage:

- `pc`, `windows`, `microsoft windows`, `pc dvd`, `pc dvd-rom`, `pc cd`, `pc cd-rom` → `"PC"`
- `ps5`, `playstation 5` → `"PlayStation 5"`; `ps4` → `"PlayStation 4"`; `ps3` → `"PlayStation 3"`;
  `ps2` → `"PlayStation 2"`
- `ps vita`, `psvita`, `playstation vita` → `"PlayStation Vita"`; `psp`, `playstation portable` →
  `"PlayStation Portable"`
- `switch 2`, `nintendo switch 2` → `"Nintendo Switch 2"`; `switch`, `nintendo switch` →
  `"Nintendo Switch"`
- `wii u` → `"Wii U"`; `wii` → `"Wii"`
- `nintendo 3ds`, `3ds` → `"Nintendo 3DS"`; `nintendo ds` → `"Nintendo DS"`
- `xbox series s` → `"Xbox Series S"`; `xbox series x`, `xbox series x|s`, `xbox series x/s`,
  `xbox series` → `"Xbox Series X"`; `xbox one` → `"Xbox One"`; `xbox 360` → `"Xbox 360"`

  (Series X/S: preserve a standalone `Series S` read; collapse the ambiguous combined forms to the
  `KNOWN_PLATFORMS` default `"Xbox Series X"`.)

An unrecognized platform (e.g. `Evercade`, or any string the map lacks) returns the trimmed input —
never an empty string or a throw.

#### 2. All-caps title-casing helper

**File**: `src/lib/platforms.ts`

**Intent**: Add `normalizeTitleCasing(raw)` that converts shouty model reads to human Title Case while
preserving intentional intra-word stylization and embedded acronyms, per the two-mode design in
Critical Implementation Details.

**Contract**: New export `normalizeTitleCasing(raw: string): string`, plus module-private support:
a `MINOR_WORDS` set (`the, of, and, a, an, to, in, on, for, or, nor, but, at, by, from, with, as`)
and a roman-numeral matcher (`/^[ivxlcdm]+$/i`, applied to the token's letters). Algorithm:

1. Split on whitespace into tokens; classify the title as **fully shouty** (no token contains
   `[a-z]`) vs **mixed**.
2. For each token, leave it untouched if it contains any lowercase letter (mixed-branch stylization
   guard: `inFAMOUS`, `LittleBigPlanet`, `DmC`).
3. For an all-caps (no-lowercase) token, apply per-token precedence: minor-word-and-not-first →
   lowercase; else roman numeral → keep uppercase; else (mixed branch only) alphabetic length ≤ 3 →
   keep uppercase; else title-case.
4. Rejoin with single spaces.

A non-shouty, already-cased title is returned effectively unchanged.

#### 3. Table-driven tests

**File**: `src/lib/platforms.test.ts`

**Intent**: Lock the exact rules for both helpers with table-driven cases, matching the existing
file's Vitest style.

**Contract**: Two new `describe` blocks. `normalizePlatformLabel` cases: each documented alias →
its label (at minimum one PC media-format variant, one PlayStation shorthand, one Nintendo shorthand,
one Xbox Series form), a `KNOWN_PLATFORMS`-label round-trip (already-canonical input unchanged),
and an unknown passthrough (`"Evercade"`, mixed-case/whitespace input trimmed not blanked).
`normalizeTitleCasing` cases: `"MAFIA THE OLD COUNTRY"` → `"Mafia the Old Country"`;
`"GRAND THEFT AUTO IV"` → `"Grand Theft Auto IV"`; `"Call of DUTY"` → `"Call of Duty"`;
`"Portal RTX"` → `"Portal RTX"`; `"inFAMOUS"` and `"LittleBigPlanet"` unchanged; a minor-word-first
case (first word never lowercased); and `"FIFA 23"` → `"Fifa 23"` (documents the tradeoff).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Spot-check the new helpers against a few real shelf titles/platforms not in the test table and
  confirm the output reads naturally.

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Wire into the vision service

### Overview

Apply both helpers to the model read inside `identifyGameFromPhoto` so the returned `identified`
result carries normalized `title` and `platform`. No route or persistence edit is needed — every
consumer reads these fields off the vision result.

### Changes Required:

#### 1. Normalize before returning the identified result

**File**: `src/lib/services/vision.ts`

**Intent**: Pass `parsed.title` through `normalizeTitleCasing` and `parsed.platform` through
`normalizePlatformLabel` when building the `{ status: "identified", ... }` return value
(`vision.ts:130-135`). The abstain paths (`unsure`) are unaffected.

**Contract**: Import both helpers from `@/lib/platforms`; the returned object uses the normalized
`title` and `platform`. Confidence and status logic unchanged. No change to `identify.ts` — it reads
`vision.title` / `vision.platform`, which are now normalized for both the persist and harness paths.

#### 2. Confirm consumers inherit normalization

**File**: `src/pages/api/identify.ts` (verification only — no code change expected)

**Intent**: Confirm by reading that the grounding call (`identify.ts:158`), the persist save
(`identify.ts:175-178`), and both response bodies use `vision.title` / `vision.platform` and so
receive normalized values automatically.

**Contract**: No edit. If review reveals any consumer that re-derives title/platform from a raw source
instead of the vision result, normalize at that point too — but none is expected.

### Success Criteria:

#### Automated Verification:

- Unit tests pass (including the unchanged `igdb` grounding tests, proving id-invariance): `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Add a game via photo of an ALL-CAPS box (e.g. a "MAFIA"-style title) and confirm the saved entry
  shows Title Case.
- Add a game via photo of a `PC DVD` / older PC box and confirm the saved platform reads `"PC"`.
- Confirm the grounded result (cover art / metadata) is the same game it was before normalization —
  no grounding regression.

**Implementation Note**: After completing this phase and all automated verification passes, pause for
final manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- `normalizePlatformLabel`: every documented alias→label class; already-canonical passthrough;
  unknown passthrough with trimming.
- `normalizeTitleCasing`: fully-shouty re-case, roman-numeral preservation, mixed-case acronym guard
  (`Portal RTX`), partial-shout re-case (`Call of DUTY`), intra-word stylization passthrough
  (`inFAMOUS`, `LittleBigPlanet`), minor-word-first guard, and the `FIFA 23` tradeoff.

### Integration Tests:

- None added. The existing `igdb` grounding tests serve as the regression guard for id-invariance;
  they must remain green unchanged.

### Manual Testing Steps:

1. Photo-add an ALL-CAPS box → saved title is Title Case with correct minor-word casing.
2. Photo-add a `PC DVD` / `PSVita` box → saved platform is the canonical label.
3. Confirm the grounded game (metadata/cover) matches what grounding produced before the change.

## Performance Considerations

Negligible — two synchronous string passes over a short title/platform per photo add, off the network
path.

## Migration Notes

No data migration. Existing rows keep their stored values; only new photo adds are normalized.

## References

- Change identity: `context/changes/normalize-photo-platform-title/change.md`
- Raw-string source: `src/lib/services/vision.ts:130-134`
- Persistence path: `src/pages/api/identify.ts:158,175-178`; `src/lib/services/library.ts:137-138`
- Alias/case tolerance in grounding: `src/lib/services/igdb.ts:124` (`resolvePlatformIds`),
  `igdb.ts:220` (`normalizeBaseTitle`), `igdb.ts:105` (`normalizePlatform`)
- Existing test pattern: `src/lib/platforms.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Normalization helpers + tests

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 37729f8
- [x] 1.2 Type checking passes: `npm run typecheck` — 37729f8
- [x] 1.3 Linting passes: `npm run lint` — 37729f8
- [x] 1.4 Production build succeeds: `npm run build` — 37729f8

#### Manual

- [x] 1.5 Spot-check helpers against real shelf titles/platforms not in the test table — 37729f8

### Phase 2: Wire into the vision service

#### Automated

- [x] 2.1 Unit tests pass (including unchanged `igdb` grounding tests): `npm test` — b42743f
- [x] 2.2 Type checking passes: `npm run typecheck` — b42743f
- [x] 2.3 Linting passes: `npm run lint` — b42743f
- [x] 2.4 Production build succeeds: `npm run build` — b42743f

#### Manual

- [x] 2.5 Photo-add an ALL-CAPS box → saved title is Title Case — b42743f
- [x] 2.6 Photo-add a `PC DVD` box → saved platform reads `PC` — b42743f
- [x] 2.7 Grounded result matches pre-change grounding (no regression) — b42743f
