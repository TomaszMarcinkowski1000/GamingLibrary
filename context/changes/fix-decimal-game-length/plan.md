# Fix Decimal Game Length (ceil IGDB length to whole hours) Implementation Plan

## Overview

IGDB-derived game length is computed by dividing a "time to beat" value in seconds by 3600, producing arbitrary-precision decimals (e.g. `14.2`, `42.51666…`). The Add/Edit form's "Length (hours)" input is `<Input type="number">` with no `step`, so HTML5 defaults to `step="1"` and rejects any non-integer value — the game can't be saved (Roadmap v1 Hardening H-02, GitHub #23).

Rather than make the form accept decimals, we round IGDB length **up** to whole hours at the mapping source. Sub-hour "time to beat" precision carries no real meaning for a library (no value in distinguishing 14.2h vs 15h), and an integer length flows cleanly through the existing integer-only input. The database is clean (no existing decimal rows), so no form, schema, or data-migration work is required.

## Current State Analysis

- **Mapping source** (`src/lib/services/igdb.ts:514`): `const lengthHours = timeToBeat?.normally ? timeToBeat.normally / SECONDS_PER_HOUR : null;`. `SECONDS_PER_HOUR = 3600` (line 155). The division yields a float whenever `normally` is not an exact multiple of 3600. This value is returned on the `IgdbLookupResult` as `lengthHours` (line 546) and pre-fills the form.
- **Form input** (`src/components/library/GameFormFields.tsx:197-205`): `<Input type="number" min={0}>` with no `step`. Parse helper `toNumberOrNull` (line 52) uses `Number()` (handles floats), and zod `length_hours: z.number().min(0).nullable()` (`src/lib/validation/library.ts:41`) and the DB column (`numeric`) both already accept decimals. The integer-only HTML5 step is the sole blocker — and once IGDB yields integers, the blocker never triggers.
- **Test pattern** (`src/lib/services/igdb.test.ts`): every test targets a **pure exported function** (`resolvePlatformIds`, `platformsOverlap`, `normalizeBaseTitle`, `collapseToBaseGame`, `isConfidentMatch`). The IGDB network client is never mocked. The length conversion is currently inline inside the network-bound lookup function, so it has no unit test and can't get one without a client mock.

## Desired End State

A confident IGDB lookup returns `lengthHours` as a non-negative **integer** (rounded up) or `null` when no time-to-beat data exists. The Add/Edit form pre-fills with that integer and saves without error. A unit test covers the rounding contract.

Verify: `npm run lint`, `npm run build`, and `npx vitest run src/lib/services/igdb.test.ts` all pass; manually, identifying a game with known fractional time-to-beat pre-fills a whole-number length that saves successfully.

### Key Discoveries:

- IGDB length is a raw `seconds / 3600` division (`igdb.ts:514`), not a clean half-hour value — so "round to 1 decimal" would not fully tidy it; integer ceil does.
- The form/zod/DB layers already accept decimals; the only enforcement of integers is the implicit HTML5 `step="1"`. Fixing at the source means the form needs no change.
- `igdb.test.ts` only tests pure exported helpers — extracting the conversion into a small exported function is the idiomatic way to make it testable here.

## What We're NOT Doing

- **No form changes** — `step` stays as-is on `length_hours` and `play_time_hours`; the integer input is acceptable once IGDB yields integers.
- **No schema, zod, DB, or migration changes** — local DB is clean (no decimal rows to back-fill), and `numeric`/`z.number()` already tolerate any value.
- **No change to `play_time_hours`** (user-entered) or `release_year`.
- **No client-mocking integration test** for the full IGDB lookup.

## Implementation Approach

Extract the seconds→hours conversion at `igdb.ts:514` into a small **pure exported helper** that applies `Math.ceil` while preserving the existing "null when no usable `normally`" behavior, call it from the lookup, and unit-test the helper in `igdb.test.ts` (matching the file's pure-function test pattern).

## Phase 1: Ceil IGDB length to whole hours + unit test

### Overview

Round IGDB-derived length up to an integer at the mapping source and lock the behavior with a unit test.

### Changes Required:

#### 1. IGDB length mapping

**File**: `src/lib/services/igdb.ts`

**Intent**: Extract the inline length conversion (line 514) into a pure, exported helper that converts a raw `normally` seconds value to whole hours rounded **up**, returning `null` when there is no usable value (preserving today's falsy→null behavior). Replace the inline expression at line 514 with a call to the helper so `lengthHours` becomes an integer or `null`.

**Contract**: New exported function, e.g. `lengthHoursFromSeconds(normallySeconds: number | null | undefined): number | null` — returns `null` for falsy/non-positive input, otherwise `Math.ceil(normallySeconds / SECONDS_PER_HOUR)`. Called at the current line-514 site as `const lengthHours = lengthHoursFromSeconds(timeToBeat?.normally);`. No change to the `IgdbLookupResult` shape (`lengthHours` stays `number | null`).

#### 2. Unit test for the rounding helper

**File**: `src/lib/services/igdb.test.ts`

**Intent**: Add a `describe` block for the new helper asserting the ceil contract, in the same style as the existing pure-function tests. Import the new export alongside the existing ones (line 3).

**Contract**: Cases — fractional rounds up (e.g. `51120 → 14.2h → 15`); exact-multiple stays put (`3600 → 1`, `151200 → 42`); sub-hour positive rounds up to `1`; and `null`/`undefined`/`0` → `null`.

### Success Criteria:

#### Automated Verification:

- Type checking + linting passes: `npm run lint`
- IGDB unit tests pass: `npx vitest run src/lib/services/igdb.test.ts`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Identifying a game whose IGDB time-to-beat is fractional pre-fills the "Length (hours)" field with a whole number and the game saves without the input rejecting the value.
- A game with no time-to-beat data still pre-fills an empty length (no `0`, no error).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `lengthHoursFromSeconds`: fractional→ceil, exact-multiple→unchanged, sub-hour→1, and falsy (`null`/`undefined`/`0`)→`null`.

### Manual Testing Steps:

1. Add/identify a game known to have a fractional time-to-beat; confirm the length field shows a whole number and the game saves.
2. Add/identify a game with no time-to-beat; confirm the length field is empty and saving works.

## Migration Notes

None. The local database has no existing decimal `length_hours` rows, so no back-fill or migration is needed.

## References

- Change identity: `context/changes/fix-decimal-game-length/change.md`
- IGDB length mapping: `src/lib/services/igdb.ts:514` (and `SECONDS_PER_HOUR`, line 155)
- Existing pure-function test pattern: `src/lib/services/igdb.test.ts`
- Form input (unchanged, context): `src/components/library/GameFormFields.tsx:197-205`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Ceil IGDB length to whole hours + unit test

#### Automated

- [x] 1.1 Type checking + linting passes: `npm run lint`
- [x] 1.2 IGDB unit tests pass: `npx vitest run src/lib/services/igdb.test.ts`
- [x] 1.3 Production build succeeds: `npm run build`

#### Manual

- [x] 1.4 Fractional time-to-beat pre-fills a whole-number length that saves
- [x] 1.5 Game with no time-to-beat pre-fills an empty length with no error
