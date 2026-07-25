<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: API Route Contracts + Cross-User Isolation (Test Rollout Phase 3)

- **Plan**: `context/changes/testing-route-contracts-isolation/plan.md`
- **Scope**: Full plan — Phases 1–6 of 6 (all Progress boxes `[x]`)
- **Date**: 2026-07-25
- **Verdict**: NEEDS ATTENTION → **APPROVED after triage** (triaged 2026-07-25)
- **Findings**: 0 critical, 3 warnings, 4 observations — all 7 triaged; 3 fixed, 4 accepted

## Verification run

| Check | Result |
|---|---|
| `npm test` | green — 11 files / 228 tests, 2.78s (baseline was 9 / 172) |
| `npm run lint` | clean (0 errors) |
| `npm run typecheck` | 0 errors, 0 warnings, 5 pre-existing hints in `eslint.config.js` |
| `npm run test:db` | PASS — 17 tests |
| Falsification, reproduced independently | widen SELECT+UPDATE → 5 red (2,4,6,8,9); widen UPDATE alone → **17/17 green** |
| Local DB after review | all four policies restored narrow, 0 leftover fixtures, tree clean |

18 of 18 planned changes land. No production (non-test) source file changed, no CI
change, no migration, no `.tsx`, no Miniflare, no second vitest project, no
`supabase/seed.sql` — every "What We're NOT Doing" boundary verified respected.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Triage outcome (2026-07-25)

| Finding | Decision |
|---|---|
| F1 — suite green over widened UPDATE; cookbook over-generalizes | **FIXED** — test 8 added, log re-measured, three docs narrowed |
| F2 — Progress 4.2 ticked with unsatisfiable wording | **FIXED** — annotated in the plan's existing correction style |
| F3 — `rejects.toBeDefined()` where exact was available | **FIXED** — all three sites tightened to `toEqual` |
| F4 — nothing runs the pgTAP suite automatically | ACCEPTED — deferred to rollout Phase 5 as already scoped |
| F5 — §6.7-renumbering premise was wrong (harmlessly) | ACCEPTED as-is |
| F6 — `QueryResult` not exported | ACCEPTED as-is — export when a caller needs it |
| F7 — redundant `not.toBe` | ACCEPTED as-is — deliberate documentation |

Post-triage verification: `npm test` 228/228 green (11 files), `npm run test:db` **18/18**
green (was 17), `npm run lint` clean, `npm run typecheck` clean. Local DB left with all
four policies narrow and no leftover fixtures — every falsification injection ran inside a
rolled-back transaction.

The three fixes changed **Plan Adherence** and **Safety & Quality** from WARNING to PASS;
the remaining four decisions are accepts, not deferrals of unaddressed risk. Post-triage
verdict: **APPROVED**.

## Findings

### F1 — The pgTAP suite stays fully green over a widened UPDATE policy, and the cookbook generalizes that into a rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/tests/database/library_entries_rls.test.sql:32-38,63-70`; `context/foundation/test-plan.md:552-558,143`
- **Detail**: Measured against the local stack during this review. Widening the UPDATE
  policy alone to `using (true) with check (true)`, leaving SELECT narrow, leaves the
  suite at **17/17 green** — which confirms the plan's mid-flight correction
  (`plan.md:188-198`) as far as it goes. But the conclusion drawn from it is too broad.
  A `WHERE`-less, `RETURNING`-less statement is not covered by the SELECT-policy
  composition the correction relies on:

  ```
  set local role authenticated;
  set local request.jwt.claim.sub = '<B>';
  update public.library_entries set title = 'PWNED';   -- no WHERE, no RETURNING
  reset role;
  -- A's row title after the write => PWNED
  ```

  A's row is modified. So "widening UPDATE alone changes nothing"
  (`test-plan.md:556`, and the suite header at `:35`) holds only for statements
  carrying `WHERE`/`RETURNING`. Group (b) issues its writes with a `WHERE`, so the
  suite cannot see this state, and the falsification log has **no row for
  "UPDATE widened alone"** — the one breach class it misses is also the one the log
  does not record, which is what makes the gap invisible. Consequently
  `test-plan.md:143`'s gate row overstates its catch list: a policy "widened to
  `using (true)`" is *not* caught when only UPDATE is widened.

  Mitigating: not exploitable through the app today — every application write goes
  through `.eq("id", id)` (`library.ts:164,183`), so it always carries a `WHERE`.
  But that is an app-layer argument, and this suite exists precisely because
  ownership is "100% Postgres, 0% TypeScript" — the DB must hold on its own terms.
- **Fix**: Add one assertion to group (b) — as B, an unfiltered
  `update public.library_entries set title = '…'` must leave A's rows unchanged
  (assert the effect after `reset role`, consistent with the group's existing style)
  — then bump `plan(17)` → `plan(18)`, add the "UPDATE widened alone" row to the
  falsification log, and narrow the wording at `test-plan.md:556` and the suite
  header `:35` to "changes nothing *for statements carrying `WHERE`/`RETURNING`*".
  - Strength: Closes the one policy-regression class the suite claims to catch and
    doesn't, using the group's own effect-check idiom; costs ~4 lines.
  - Tradeoff: The suite's headline "the app can't reach this" nuance has to be
    written down so the new assertion isn't later read as dead weight.
  - Confidence: HIGH — both states measured directly on the local stack this review.
  - Blind spot: Whether PostgREST rejects unfiltered `PATCH` at the API edge is not
    verified here; that would bound real-world exposure but not the suite's claim.
- **Decision**: FIXED — added test 8 (group (b) effect check on an unfiltered
  `update … set play_time_hours = 999`, a column no later assertion reads), bumped
  `plan(17)` → `plan(18)`, narrowed the suite header at `:32-38` and cookbook rule 2,
  and added §6 cookbook rule 3 ("assert one write with neither `WHERE` nor `RETURNING`",
  renumbering the old rule 3 → 4). Gate row `test-plan.md:143` now names the case.
  **Falsification log re-measured in full**, not inferred: `UPDATE widened alone → 8 ONLY`
  (new row); every pre-existing row reproduced exactly under its original injection,
  shifted by the one inserted index. Two subtleties found while measuring and written
  into the file: the `for all` row is a *blanket* four-policy replacement (which is why it
  reddens INSERT/DELETE assertions too), and test 8 is vacuous under that blanket case
  because test 5's delete has already removed A's rows — so the two breaches are caught by
  disjoint assertions and neither covers for the other. Suite green at 18/18.

### F2 — Progress 4.2 is ticked with wording the implementation could not satisfy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/testing-route-contracts-isolation/plan.md:670,970`; `src/pages/api/library/index.test.ts:29-46`
- **Detail**: Criterion 4.2 reads "the 400-path tests run without the KV mock and
  without the fetch router". Vitest hoists `vi.mock` per *file*, so the
  `cloudflare:workers` mock at `:39-46` applies to every test — the KV half is not
  expressible as written. The implementation handled this well: it substitutes a
  stronger per-test claim (a counting getter, with every 400/401 test asserting
  `kv.reads === 0`), leaves the 400 block with no fetch router so
  `test/setup/no-network.ts`'s deny-all stays armed, and explains all of it at
  `:29-37` and in commit `e6004b2`. The gap is only that `plan.md`'s Progress item is
  ticked with its original wording, while two comparable mid-flight corrections in
  the same plan *were* annotated in-document (`:188-198`, `:363-370`).
- **Fix**: Annotate criterion 4.2 and Progress 4.2 in `plan.md` with the same
  "Adjusted during implementation" note style already used twice in this plan.
- **Decision**: FIXED — added an "Adjusted during implementation" block under the Phase 4
  success criteria (matching the `:188-198` style) recording that `vi.mock` hoists per file
  so "without the KV mock" is not an available state, and that the counting-getter
  `kv.reads === 0` claim is *stronger* than the original wording, not a climbdown. Progress
  4.2 restated to the claim actually proven, with a pointer to the note.
  Additionally, while fixing F1 the `:188-198` annotation was found to carry the same
  over-broad claim ("widening UPDATE alone leaves the suite fully green"); it now carries a
  "Further narrowed during impl review" paragraph bounding it to `WHERE`/`RETURNING`
  statements and citing test 8.

### F3 — `rejects.toBeDefined()` where an exact assertion was available

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/library.test.ts:307`; `src/lib/services/recommendation.test.ts:598` (and pre-existing `library.test.ts:330`)
- **Detail**: `listAllEntries` rethrows the raw PostgREST error (`library.ts:344-346`),
  so the test knows it receives `{ message: "boom" }`. A truthiness assertion also
  passes if the production code starts throwing an unrelated `TypeError` — e.g. a
  chain reorder that makes the stub blow up would keep the test green while proving
  nothing about error *propagation*. This is the same class the plan itself hunts
  (Critical Implementation Detail #4: assert the outgoing thing, not the proxy).
- **Fix**: `await expect(...).rejects.toEqual({ message: "boom" })` at all three sites.
- **Decision**: FIXED (all three sites, including the pre-existing `library.test.ts:330`).
  Confirmed first that each path rethrows the raw PostgREST object — `listAllEntries`
  (`library.ts:344-346`) and `getLibraryFacets` (`library.ts:379-381`) both `throw error`,
  and `getRecommendations` calls `listAllEntries` at `recommendation.ts:225` with nothing
  catching in between — so `toEqual({ message: "boom" })` asserts identity, not a coincidence.
  Added a comment at the two propagation sites recording *why* the exact object matters, so
  the assertion isn't loosened back later. 228 tests green.

### F4 — Nothing runs the pgTAP suite automatically

- **Severity**: 💭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `.github/workflows/ci.yml`; `package.json:15`
- **Detail**: CI runs `npm ci` → `astro sync` → `lint` → `build`. It does not run
  `npm test`, let alone `npm run test:db`; `lint-staged`'s `vitest related` can never
  match a `.sql` file. So the only layer that can prove Risk #5 runs solely when a
  developer remembers it, and a policy widened `to anon` in a migration would merge
  green. **This is a sanctioned deferral, not drift** — the plan scopes CI wiring to
  rollout Phase 5 (`plan.md:132-134`) and `test-plan.md:143` records the gate as
  "**local only**". Recorded here because it compounds F1: an un-gated suite with a
  known blind spot is two steps from silent policy drift, which argues for fixing F1
  now rather than bundling it into Phase 5.
- **Fix**: None in this change — carry into rollout Phase 5. Consider adding plain
  `npm test` to CI as a cheap interim step, since it needs no Docker.
- **Decision**: ACCEPTED — deferred to rollout Phase 5 as scoped. The deferral is already
  recorded in both `plan.md:132-134` and `test-plan.md:143` ("local only"), so it is
  visible to the next phase rather than lost. The compounding argument this finding rested
  on is now weaker: F1 closed the suite's known blind spot, so what ships un-gated is at
  least a suite that catches what it claims to.

### F5 — The plan's §6.7-renumbering premise was factually wrong (harmlessly)

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/testing-route-contracts-isolation/plan.md:812`
- **Detail**: The plan asserted "nothing references §6.7 by number today" to justify
  renumbering §6.7 → §6.8. Several documents did. The renumber was nonetheless
  executed correctly: the one live reference (`identify.test.ts:312-313`) was updated
  and now explains the move. All remaining hits are frozen archive plans and this
  plan's own text — historical records, not live pointers.
- **Fix**: None required. Noted so a future renumber checks `context/archive/` before
  claiming a symbol is unreferenced.
- **Decision**: ACCEPTED as-is — the renumber landed correctly; the premise was wrong but
  the outcome was not. Recorded here only.

### F6 — `supabase-mock.ts` does not export its public result type

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `test/helpers/supabase-mock.ts:27-30`
- **Detail**: The sibling helper `test/helpers/fetch-mock.ts` exports every public type
  (`RecordedRequest`, `RouteResult`, `Route`, `RouteResponder`, `FetchRouter`) so
  callers can name them; `supabase-mock.ts` keeps `QueryResult<T>` unexported, so a
  caller cannot annotate a fixture. It contains no `any`, the `as never` is documented
  at `:16-17` and is a faithful lift of the inline originals, and its JSDoc coverage is
  better than the sibling's — so this is a small consistency gap, not a defect.
- **Fix**: Export `QueryResult` if a caller ever needs to name a fixture; otherwise accept.
- **Decision**: ACCEPTED as-is — no caller needs to name a fixture today; export it at the
  point one does, rather than widening the helper's public surface speculatively.

### F7 — Redundant `not.toBe` after an exact assertion

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/library/index.test.ts:203`
- **Detail**: `expect(payload()?.platform).not.toBe("PlayStation 5")` follows `:202`'s
  exact `toMatchObject({ platform: "ps5", … })`, which already forbids that value.
  Strictly redundant rather than weak — unlike F3, the exact assertion *is* present.
- **Fix**: Keep only if the redundancy is intended as documentation of the behaviour
  record's point; otherwise drop the line.
- **Decision**: ACCEPTED as-is — kept deliberately. The line reads as documentation of the
  behaviour record's point (the platform is stored verbatim, *not* normalized to the IGDB
  display name), which is the thing a future reader is most likely to "fix" by mistake.
  It is redundant, not weak — F3's concern does not apply here.

## Unplanned changes (all benign, all documented)

| Change | Assessment |
|---|---|
| `src/lib/services/igdb.test.ts` (+8) — one test pinning `resolvePlatformIds("ps5") === [167]` | Justified support work. `index.test.ts`'s verbatim-platform behaviour record depends on `ps5` still *grounding* while being stored un-normalized; the comment states a route suite is the wrong sole tripwire for a platform-map entry. Test-only, reasoned in commit `e6004b2`. |
| `selectLimitClient` — a 6th builder beyond the planned five | Written for Phase 5's `listAllEntries`, which had no inline original to lift. Self-documented at `supabase-mock.ts:13-14,120-130`. |
| 23 validation assertions vs the planned "~16"; 2 extra 404-vs-500 tests | Phase 6 triage output, within the plan's own "at most one assertion per business-relevant survivor" allowance, logged in-file. |

## What verified well

- **The positive control is real, and it matters.** Group (a) is genuinely first, and
  the header records the measurement that justifies it: with impersonation corrupted,
  8 isolation assertions stay green over a `NULL auth.uid()`. That is the vacuous pass
  documented in the flesh, and an earlier undercount in that same bullet was found and
  corrected in-file (`:77-78`).
- **The falsification log is the strongest artifact in the change** — seven injected
  breaches mapped to the exact test numbers that redden. I reproduced two rows
  independently and both matched.
- **`is_empty` over `results_ne`** applied consistently (`:156,162,196,267`);
  `results_ne` appears only in the prose explaining why it was rejected.
- **Boundary discipline held.** `[id].test.ts:4-22` states "THIS SUITE PROVES
  TRANSLATION, NOT OWNERSHIP" and that every assertion would return the same result
  with RLS disabled, pointing at the pgTAP file.
- **Documentation-of-behaviour labelling is honest throughout** — the fractional
  `length_hours`, the int4 `release_year`, the 500-before-401 guard order, the
  verbatim `ps5` platform (with its archive citation) are each marked as a decision to
  re-take rather than a requirement.
- **The helper extraction is clean**: no shared mutable module state, per-call capture
  allocation, and the 172 pre-existing tests stayed green through the migration.
