# Fix Decimal Game Length — Plan Brief

> Full plan: `context/changes/fix-decimal-game-length/plan.md`

## What & Why

IGDB game length is computed as `seconds / 3600`, producing decimals (e.g. `14.2`, `42.51666…`). The Add/Edit "Length (hours)" input is integer-only (HTML5 `step="1"`), so a game with a fractional length can't be saved (Roadmap v1 Hardening H-02, GitHub #23). We fix it at the source by rounding IGDB length **up** to whole hours — sub-hour "time to beat" precision is noise for a library.

## Starting Point

`src/lib/services/igdb.ts:514` divides the IGDB `normally` seconds by `SECONDS_PER_HOUR` (3600) and stores the raw float on `lengthHours`. The form, zod schema, and `numeric` DB column already accept decimals; only the form's implicit integer step rejects them. The local DB has no existing decimal rows.

## Desired End State

A confident IGDB lookup returns `lengthHours` as a non-negative integer (rounded up) or `null` when there's no time-to-beat data. The form pre-fills that integer and saves cleanly, with no change to the form, schema, or database.

## Key Decisions Made

| Decision                        | Choice                                              | Why (1 sentence)                                                            | Source |
| ------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| Where to fix                    | IGDB mapping source, not the form                   | DB is clean and length is conceptually integer, so fixing at source is sufficient. | Plan   |
| Rounding strategy               | `Math.ceil` to whole hours                          | User: no value in 14.2 vs 15h; round up so a long game isn't understated.   | Plan   |
| Form / schema / DB changes      | None                                                | Integer input is fine once IGDB yields integers; no decimal data to migrate. | Plan   |
| Testability approach            | Extract conversion to a pure exported helper        | Matches `igdb.test.ts`'s pure-function pattern; avoids mocking the client.  | Plan   |
| Test coverage                   | IGDB ceil unit test only                            | The one piece of new logic; the rest is verified manually.                  | Plan   |

## Scope

**In scope:**
- Round IGDB-derived length up to whole hours at `igdb.ts:514`.
- Extract the conversion into a pure exported helper and unit-test it.

**Out of scope:**
- Any form change (`length_hours` / `play_time_hours` `step`), zod, DB, or migration work.
- Changes to `play_time_hours` (user-entered) or `release_year`.
- A client-mocking integration test of the full lookup.

## Architecture / Approach

Replace the inline `timeToBeat?.normally ? normally / 3600 : null` with a call to a new pure helper `lengthHoursFromSeconds(normallySeconds)` that returns `null` for falsy/non-positive input and `Math.ceil(seconds / 3600)` otherwise. Add a `describe` block in `igdb.test.ts` covering the ceil contract.

## Phases at a Glance

| Phase                                      | What it delivers                                  | Key risk                                        |
| ------------------------------------------ | ------------------------------------------------- | ----------------------------------------------- |
| 1. Ceil IGDB length + unit test            | Integer length from IGDB, locked by a unit test   | Edge values (0, sub-hour) must still map sanely |

**Prerequisites:** None.
**Estimated effort:** ~1 short session (one helper extraction + one test block).

## Open Risks & Assumptions

- Assumes the local/production DB has no existing decimal `length_hours` rows (stated: DB is clean). If decimal rows ever exist, editing them would still hit the integer-input block — out of scope here.
- A very small but positive time-to-beat (under one hour) ceils to `1`; acceptable.

## Success Criteria (Summary)

- A game with a fractional IGDB time-to-beat pre-fills a whole-number length and saves without error.
- A game with no time-to-beat pre-fills an empty length (no `0`, no error).
- `npm run lint`, `npm run build`, and the `igdb.test.ts` suite all pass.
