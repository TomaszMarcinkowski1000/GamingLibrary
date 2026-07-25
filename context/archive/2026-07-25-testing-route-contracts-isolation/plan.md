# API Route Contracts + Cross-User Isolation (Test Rollout Phase 3) — Implementation Plan

## Overview

Rollout Phase 3 of `context/foundation/test-plan.md` covers Risk #5 (cross-user
library exposure) and Risk #6 (input-boundary regressions in add/edit). It stands
up a **new test layer** — pgTAP policy tests under `supabase/tests/database/`, run
by `supabase test db` — because that is the only layer that can prove Risk #5, and
extends the Phase 1 route-test harness across the library routes for Risk #6.

`/10x-research` (2026-07-25) **inverted the test plan's response guidance for both
risks, in opposite directions**, and this plan is built on the corrected reading:

- **Risk #5** — the route deliberately does *not* enforce ownership. RLS is the
  sole gate, by a ratified decision. So a stubbed-Supabase route test proves
  nothing about isolation while reading as coverage.
- **Risk #6** — two of the three original probes are inverted or unbuilt. "A
  decimal length saves" passes at the schema layer while the browser still blocks
  it; "platform aliases normalize" asserts a feature H-03 deliberately scoped out.

This is a test-writing phase: **it changes no production behaviour.** Three real
code gaps are recorded rather than fixed, per the Phase 1 and Phase 2 precedent.

## Current State Analysis

**Baseline**: 9 test files, 172 tests, green in ~2.7s on `e2de924`. Vitest 4.1.10.

**What exists:**

- A route-test harness — `src/pages/api/identify.test.ts:24-34,90-104` imports the
  exported handler and hands it a hand-built, cast `APIContext`. No Astro
  machinery, no HTTP, no Miniflare.
- A fetch-edge mock — `test/helpers/fetch-mock.ts` → `installFetchRouter`, with
  `test/setup/no-network.ts` denying unrouted fetch suite-wide.
- Five inline Supabase chain builders, duplicated across two files:
  `library.test.ts:23-35` (`insertClient`, copied at `identify.test.ts:43-52`),
  `:179-197` (`updateClient`), `:219-231` (`deleteClient`), `:249-265`
  (`listClient`), `:289-325` (`filterListClient`). No shared helper exists.
- Six `updateEntrySchema` assertions at `src/lib/validation/library.test.ts:20-56`.
- A healthy local Supabase stack (11 containers), `config.toml:210`
  `enable_confirmations = false`, `[db.seed] sql_paths` pre-declared.

**What does not exist:**

- `supabase/tests/` — no directory, no pgTAP suite, no `test:db` script. pgTAP
  **1.3.3** is *available but not installed* in the local database.
- Any test file for `src/pages/api/library/**`. No component tests anywhere.
- Any test for `patchEntrySchema` (including its `.refine()`), `createEntrySchema`,
  `lookupRequestSchema`, `length_hours`, `listAllEntries`, or `getRecommendations`.
- Any `npm test` step in CI — `.github/workflows/ci.yml` runs lint + build only.

**Constraints discovered:**

- `library_entries.user_id` FKs to `auth.users(id)` (migration `:9`), so a pgTAP
  fixture must create real auth rows. Verified against the live database: only
  `id`, `is_sso_user`, `is_anonymous` are NOT NULL and the last two default, so
  `insert into auth.users (id, email)` suffices.
- `test/stubs/astro-env-server.ts` leaves `SUPABASE_*` undefined **on purpose**,
  and all four library handlers check `if (!supabase)` *before* `if (!locals.user)`
  — so an unauthenticated request returns 500, not 401, unless `@/lib/supabase` is
  mocked. Any 401 assertion without that mock is vacuous.
- `src/pages/api/library/index.ts:2` imports `env` from `cloudflare:workers` and
  really calls `lookupGameMetadata`; `[id].ts` imports neither. The two route files
  are not the same price.
- `createEntrySchema` is defined **inline and unexported** at `index.ts:14-17`. The
  route is the only layer that can reach it.

## Desired End State

Risk #5 is defended at the layer that owns it: a pgTAP suite proves that as user B,
writes against user A's rows leave A's data **provably unchanged**, reads return
none, both facet RPCs return only B's values, a foreign-`user_id` insert is
refused, and the `anon` role — which holds full table grants — sees nothing. The
suite runs via `npm run test:db` and is documented in §6.

Risk #6 is defended at the two layers that can see it: the uncovered schemas hold
against their PRD oracles, and the route contract translates them into the right
status codes. The three genuine divergences are recorded as
documentation-of-behaviour, annotated in-file, with the FR-010 violation flagged
for a follow-up change.

**Verification**: `npm test` green with the new files; `npm run test:db` green;
`npm run lint` and `npm run typecheck` clean; `test-plan.md` §6.4 filled in and a
new pgTAP cookbook section present.

### Key Discoveries

- **Ownership is 100% Postgres, 0% TypeScript** — `src/lib/services/library.ts:31-33`
  states the rule in production code; `.eq("id", id)` is the only predicate the
  application writes (`:164`, `:183`).
- **The 404 is derived from an empty RETURNING set**, not from a permission error
  (`PGRST116` on `.single()`, `[]` on `.select("id")`). "It returned 404" is
  therefore not "isolation held".
- **`anon` holds full table grants** (`DELETE,INSERT,SELECT,UPDATE,…`) — the
  *absence* of an `anon` policy is the entire defense, not a second line of it.
- **`auth.uid()` in this database** is
  `coalesce(current_setting('request.jwt.claim.sub'), current_setting('request.jwt.claims')::jsonb->>'sub')`
  — verified directly — so `set local role authenticated` + `set local
  request.jwt.claim.sub` genuinely drives RLS. **And if it silently fails,
  `auth.uid()` is NULL and every isolation assertion passes for the wrong reason.**
- **`recommend()` reads six entry fields** — `length_hours` (`:74`), `play_status`
  (`:90,92,104,115`), `date_bought` + `created_at` (`:128`), `release_date`
  (`:131`), `id` (`:148,203`). That set, derived from the engine, is the oracle for
  the column assertion — not the `RECOMMENDATION_COLUMNS` string.
- **The manual and photo write paths persist `platform` differently** — a photo
  read of `PS5` persists as `PlayStation 5`; a user who types `ps5` persists `ps5`
  (`vision.ts:137-138` are the *only* production call sites of the normalizers).

## What We're NOT Doing

**No production behaviour change.** Three code gaps are recorded, not fixed:

1. **A fractional `length_hours` row is wholly un-editable** — the browser's
   implicit `step="1"` blocks the entire form submit, so no field can be changed.
   This violates `prd.md:140` FR-010 ("edit any field", **must-have**).
   **Flagged for a follow-up change** — it is the only one of the three with a
   must-have spec oracle behind it. Not fixed here: the fix is an HTML5 attribute
   (`GameFormFields.tsx:196`), and no layer in this phase can verify it — only a
   browser can (Phase 4).
2. **Manual-path platform normalization** — deliberately scoped out by H-03
   (`archive/2026-06-19-normalize-photo-platform-title/plan.md:61-63`). Asserting
   it would test an unbuilt feature and fail against correct code. Characterized,
   not corrected. No PRD oracle exists.
3. **`22003` / `22P02` → 500 instead of 400** — an out-of-`int4` `release_year` or
   a non-UUID `params.id` reaches Postgres and lands in the catch-all. Pinned as
   documentation-of-behaviour. No PRD oracle bounds these.

Also out of scope:

- **Reordering the config/auth guards.** The 500-before-401 inconsistency
  (`prd.md:188` tension) is pinned as behaviour and recorded, not fixed.
- **CI wiring.** `npm run test:db` is a local script + documentation. §5 assigns
  gate wiring to Phase 5; adding a Supabase job here would absorb Phase 5's work on
  top of a `npm test` gate that still does not exist.
- **A second vitest project / Docker in `npm test`.** The pgTAP decision (research
  Open Question 1) removed the need — `test/setup/no-network.ts` stays global.
- **Miniflare / `@cloudflare/vitest-pool-workers`** — per Cloudflare's own docs,
  `vi.mock` cannot intercept the injected entry point, which would discard this
  repo's entire mocking strategy. **Astro Container API** — ceremony, not signal.
- **Component tests / `.tsx` in Stryker.** There are zero component tests; widening
  the mutate glob would produce a wall of uncovered survivors that says nothing.
- **Extracting `library/index.astro` frontmatter** (param whitelisting, the
  platform merge, the page clamp, the empty-state selection). Flagged by research
  as the next extraction candidate; not required by Risks #5/#6.
- **Enumerating one isolation assertion per filter dimension.** Search/filter is
  the same single RLS dependency reached through zero extra machinery — no raw
  PostgREST filter strings exist anywhere in `src/`.
- **Auth internals** (§7). pgTAP impersonates via `set local`, never touching
  gotrue, so §7 needs no carve-out.
- **Asserting `RECOMMENDATION_MAX_ROWS = 5000`** — a defensive cap with no PRD
  anchor; asserting the literal is the mirror anti-pattern.

## Implementation Approach

Six sub-phases. Sub-phase 1 is SQL-only and touches no TypeScript, so the highest-
priority risk lands first without any chance of destabilizing the 172 green tests.
Sub-phases 2–5 then run cheapest-first through the Vitest layers, each leaving the
suite green. Sub-phase 6 hardens and documents.

Each sub-phase below states, for every test group: **Behaviour asserted**,
**Regression caught**, **Research source**, **Edge/error/boundary**, and
**Anti-pattern avoided** — the five things a reviewer needs to judge whether a test
earns its place.

## Critical Implementation Details

Four gotchas that will silently produce green-but-worthless tests if missed. Each
is a *structural* hazard, not a style preference.

**1. The vacuous-pass hazard in pgTAP.** If `set local request.jwt.claim.sub` does
not take effect, `auth.uid()` returns NULL, `auth.uid() = user_id` evaluates to
NULL, and *every* row is hidden from *everyone*. Every "B cannot see A's rows"
assertion then passes while proving nothing. The suite must therefore open with a
**positive control**: assert `auth.uid()` equals B's uuid, and that B can see and
update B's *own* row. Isolation assertions are only meaningful downstream of a
proven-live impersonation. This is the pgTAP analogue of Phase 2's finding that a
green test over an undiscriminating fixture is the failure mode worth hunting.

**2. A `returning`-based "zero rows affected" check asserts a proxy, so assert the
effect too.** The documented pgTAP idiom is
`results_ne($$ update … returning 1 $$, $$ values(1) $$)`. Two problems: `results_ne`
passes for *any* set differing from `{(1)}`, including a two-row breach (use
`is_empty`); and an empty RETURNING set is evidence about the statement's output,
not about the table. So the suite also asserts the **effect**: after B's attempted
write, `reset role` (back to the superuser the test connects as) and verify A's row
still carries its original title and still exists.

> **Corrected during implementation (2026-07-25, measured against the local stack).**
> An earlier draft of this item — and research A4 item 1 — claimed that a widened
> UPDATE policy over a narrow SELECT policy lets the write **land** while `returning`
> filters to empty, producing "a 404 over a mutated row". **That state is not
> reachable.** Postgres applies SELECT policies to UPDATE/DELETE carrying a `WHERE`
> or `RETURNING` clause, so widening UPDATE alone leaves those statements fully green
> with A's rows provably unchanged, and dropping SELECT blocks the write outright (0 rows
> returned, row unmodified — verified on B's *own* row, the app-level shape). The
> effect check is kept on the two reasons above, and because it states the claim in
> the PRD's own terms (`prd.md:171`) — not on the disproved scenario. The full
> falsification battery is recorded in the suite's file header.
>
> **Further narrowed during impl review (2026-07-25).** "Widening UPDATE alone changes
> nothing" holds only for statements that carry a `WHERE` or `RETURNING` clause — which
> was every assertion this suite had. A bare `update … set <col> = …;` gets no
> SELECT-policy composition and **does** cross users under a widened UPDATE policy;
> measured. Test 8 was added to cover it and is the only assertion that reddens on that
> injection. The app cannot issue such a statement today (every write goes through
> `.eq("id", id)`), but the suite owns the database's terms, not the app's.

**3. Guard ordering makes a naive 401 assertion vacuous.** All four library
handlers check `if (!supabase)` before `if (!locals.user)`, and the vitest env stub
leaves `SUPABASE_*` undefined deliberately. Without
`vi.mock("@/lib/supabase", …)` returning a client, a no-user request returns 500
and a `expect(res.status).toBe(401)` test fails — or worse, a `not.toBe(200)` test
passes for the wrong reason. Both faces get asserted, each labelled.

**4. A best-effort `catch` can make a route test pass with the mock removed.**
Phase 1's impl-review recorded this (F2). Every route assertion must read the
*outgoing* request — the captured `.eq()` args, the captured patch payload — not
only the final status code.

---

## Phase 1: Cross-user isolation — pgTAP policy suite (Risk #5)

### Overview

Stand up the database-policy test layer and prove isolation at the only layer that
owns it. SQL only — no TypeScript changes, so `npm test` cannot regress.

### Changes Required:

#### 1. The pgTAP suite

**File**: `supabase/tests/database/library_entries_rls.test.sql` (new)

**Intent**: Prove that RLS — the sole ownership gate — actually isolates two users
across every access path the app uses, and that the proof itself cannot pass
vacuously.

**Contract**: One transactional pgTAP file, run by `supabase test db`. Structure is
non-obvious enough to pin, because the ordering carries the correctness argument:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(N);

-- fixture: two real auth users (FK target), then rows for each
insert into auth.users (id, email) values ('…A…','a@test.local'), ('…B…','b@test.local');
insert into public.library_entries (user_id, title, platform, genre, series, play_status) values …;

set local role authenticated;
set local request.jwt.claim.sub = '…B…';
-- POSITIVE CONTROL FIRST — everything below is meaningless without it
select is(auth.uid(), '…B…'::uuid, 'impersonation is live');
--   … B sees exactly B's own rows; B's update of B's own row affects one row …

-- isolation, asserted by EFFECT not by RETURNING set
--   … attempt update/delete of A's row as B, then: reset role; assert A's row
--       still has its original title and still exists …

select * from finish();
rollback;
```

Test groups in the file:

**(a) Positive control — impersonation is live.**
- *Behaviour asserted*: `auth.uid()` equals B's uuid; B sees exactly B's own row
  count; B's update of B's own row affects one row.
- *Regression caught*: a broken or silently-ignored impersonation, which would turn
  every assertion below into a tautology.
- *Research source*: `auth.uid()` definition verified live (2026-07-25); pgTAP
  impersonation idiom per Supabase docs (Context7 `/supabase/supabase`,
  **checked: 2026-07-25**).
- *Edge/error/boundary*: NULL `auth.uid()` — the boundary between "isolated" and
  "invisible to everyone", which look identical from any isolation assertion.
- *Anti-pattern avoided*: the green-over-undiscriminating-fixture failure mode
  (§6.7 Phase 2) — here it would make the whole suite decorative.

**(b) Cross-user write is refused, proven by effect.**
- *Behaviour asserted*: as B, `update` and `delete` against A's row affect zero
  rows **and** A's row is afterwards unchanged and still present (checked with the
  role reset).
- *Regression caught*: an UPDATE/DELETE policy dropped or widened. Critically, the
  effect check also catches the widened-UPDATE-with-narrow-SELECT state in which
  the write lands but the route still answers 404.
- *Research source*: research A2 (the `.eq("id")`-only predicate), A4 item 1;
  `archive/2026-06-11-edit-and-delete-entry/plan.md:23,52` (the ratified RLS-only
  decision), `:249` (the *manual* two-user check this automates).
- *Edge/error/boundary*: the write-succeeds-but-returns-nothing state — the sharpest
  face, and the one a `returning`-only assertion cannot see.
- *Anti-pattern avoided*: proving isolation with a stubbed client (a tautology that
  reads as coverage); and accepting an empty RETURNING set as proof of refusal.

**(c) Cross-user read returns nothing.**
- *Behaviour asserted*: as B, a select over A's rows returns zero; a select over
  the whole table returns exactly B's own rows.
- *Regression caught*: the SELECT policy dropped or widened — which also breaks the
  page list read and both RPCs.
- *Research source*: research A4 item 1; `prd.md:171` ("no view, search,
  recommendation, or filter ever returns an entry the requesting user does not
  own").
- *Edge/error/boundary*: covers the list-read vector that has no API route at all —
  every read happens in `.astro` frontmatter, unreachable from a route test.
- *Anti-pattern avoided*: enumerating one assertion per filter dimension. One
  whole-table read is the same single RLS dependency; the filters add no surface.

**(d) Both facet RPCs return only the caller's values.**
- *Behaviour asserted*: as B, `list_used_platforms()` and `library_facets()` return
  B's platform/genre/series/status values and **not** A's (fixture gives them
  disjoint values).
- *Regression caught*: an RPC's explicit `user_id` predicate removed, or the RPC
  switched to a non-invoker security context without the predicate holding.
- *Research source*: research A1 (the two RPCs are read vectors);
  migrations `20260611120000:21`, `20260616120000:29`.
- *Edge/error/boundary*: `library_facets()` unnests `text[]` columns — the fixture
  gives A a genre/series value B does not have, so a leak is a *present extra
  value*, not a count mismatch.
- *Anti-pattern avoided*: asserting counts only. A count can match while the values
  are wrong; assert the values.
- **Honest limitation to record in-file**: both RPCs carry an explicit
  `user_id = (select auth.uid())` predicate *in addition* to RLS, so this group
  proves the predicate holds — it does **not** independently prove a
  `security invoker` → `definer` flip would be caught (research A4 item 4).

**(e) Foreign-`user_id` insert is refused.**
- *Behaviour asserted*: as B, inserting a row with an explicit `user_id` of A raises
  (the INSERT `WITH CHECK`).
- *Regression caught*: `WITH CHECK` dropped — the only thing preventing a row
  transfer if `user_id` were ever added to `updateEntrySchema`.
- *Research source*: research A4 item 5; migration `:38`;
  `archive/2026-06-06-library-entry-store/plan.md:47` (named at foundation time,
  never given an automated test).
- *Edge/error/boundary*: the explicit-`user_id` path, distinct from the
  `default auth.uid()` path the app actually uses.
- *Anti-pattern avoided*: relying on the column default. The default is not a
  constraint; the `WITH CHECK` is.

**(f) The `anon` role sees nothing.**
- *Behaviour asserted*: as `anon`, a select over `library_entries` returns zero rows
  and a write is refused.
- *Regression caught*: **a policy widened to `to anon` or `for all using (true)`** —
  one line of SQL from a full breach, and completely invisible to a suite that only
  impersonates authenticated users.
- *Research source*: research A3 — `anon` holds `DELETE,INSERT,SELECT,UPDATE,…`
  table grants, so the *absence of a policy is the whole wall*.
- *Edge/error/boundary*: the unauthenticated role, which no route test reaches (the
  route's own auth guard short-circuits first).
- *Anti-pattern avoided*: testing only the roles the happy path uses.

**What this suite cannot prove** (record in the file header): a `SUPABASE_KEY`
swapped for the service key (`rolbypassrls = t`). pgTAP never goes through the
app's client, so no database test can see it; `deployment-plan.md:107` already
flags it as a deployment concern.

#### 2. The runner script

**File**: `package.json`

**Intent**: Make the new layer discoverable — an undocumented `npx supabase test db`
is a layer nobody runs.

**Contract**: add `"test:db": "supabase test db"` alongside `test` / `test:watch`.
`npm test` stays Docker-free and unchanged.

### Success Criteria:

#### Automated Verification:

- `npm run test:db` passes with the local stack up
- The suite fails as expected when isolation is broken. **Adjusted during
  implementation**: dropping the UPDATE policy is a *more* restrictive change, so it
  turns the **positive control** red (group (a), "B updates B's own row"), not group
  (b). To falsify group (b) the policy must be **widened** — `for all using (true)`
  over SELECT+UPDATE turns tests 4–7 red. Run the full battery (widen-all,
  widen-select, `to anon`, `with check (true)`, RPC-predicate-dropped) and confirm
  every group has at least one breach that reddens it; record the results in the
  suite header
- The positive control fails as expected — temporarily corrupt the
  `request.jwt.claim.sub` value and confirm group (a) goes red before anything else
- `npm test` still green at 172 tests (this sub-phase touches no TypeScript)

#### Manual Verification:

- The file reads as an argument, not a list: the positive control is unmistakably
  first, and the effect-check comment explains *why* `returning` alone is not enough
- The recorded limitations (service-key swap; the RPC predicate caveat) are present
  in the file header, so a future reader does not over-read the coverage

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 2: Validation schemas (Risk #6, cheapest layer)

### Overview

Cover the uncovered schemas at the layer that owns them, and record the divergences
that have no spec behind them as documentation-of-behaviour.

### Changes Required:

#### 1. `patchEntrySchema` — the schema with zero tests

**File**: `src/lib/validation/library.test.ts`

**Intent**: Prove the partial-update contract holds, including the `.refine()` rule
and the deliberate `null`-vs-omitted distinction its docstring promises.

**Contract**: assertions against `patchEntrySchema` (`validation/library.ts:63-70`).

- *Behaviour asserted*: an empty object is rejected with the "at least one field"
  message; either key alone is accepted; **`{ play_time_hours: null }` alone is
  accepted** — explicit-clear is a present key, not an absent one; `-1` rejected,
  `12.5` rejected, `0` accepted; an unknown key (e.g. a body-supplied `user_id`) is
  stripped rather than carried into the patch.
- *Regression caught*: a `.refine()` rewritten with a truthiness test — which would
  reject `{ play_time_hours: null }` and silently break "clear my hours", the one
  behaviour the docstring calls out as deliberately distinguished. Also: a schema
  gaining a `user_id` key, after which `WITH CHECK` is the only remaining defense.
- *Research source*: research B4 item 1 (`patchEntrySchema` has zero tests,
  including its `.refine()`); `validation/library.ts:54-61` (the docstring naming
  the null-vs-omitted rule); `prd.md:70` (non-negative integer) for the value rules.
- *Edge/error/boundary*: `0` accepted vs `-1` rejected pins the inclusive edge of
  `min(0)` in both directions (§6.6: "test the exact boundary, inclusively");
  `null` vs `undefined` pins the refine's discriminator.
- *Anti-pattern avoided*: mirroring the schema's constants. Nothing asserts "the
  minimum is 0" — the assertions are `-1` rejected / `0` accepted, traceable to
  `prd.md:70`'s "non-negative integer", not to the source line.

#### 2. `updateEntrySchema` — the uncovered fields

**File**: `src/lib/validation/library.test.ts`

**Intent**: Close the named gaps in the existing six assertions and record the
client/server divergence honestly.

**Contract**: extend the existing block (`:20-56`).

- *Behaviour asserted*: `platform: "   "` rejected (`prd.md:94` — title and platform
  required); `length_hours: 12.5` **accepted** — labelled
  documentation-of-behaviour; `release_year` beyond `int4` **accepted** by zod —
  labelled documentation-of-behaviour with the DB-column ceiling named.
- *Regression caught*: `platform`'s `min(1)` after trim being dropped — a required
  field silently becoming blank-able. The two behaviour records catch nothing by
  design; they exist so a future change to either is a **decision to re-take**.
- *Research source*: research B2 (the four-layer decimal table and the `step`
  audit — zero `step=`/`parseFloat`/`toFixed` hits anywhere in `src/`); B4 item 2
  (server looser than the DB on integer columns); B5 (what `library.test.ts`
  already covers, and does not).
- *Edge/error/boundary*: whitespace-only input (trim-then-min, not min-then-trim);
  the `int4` overflow boundary, where the failure surfaces two layers later as a
  500 rather than a 400.
- *Anti-pattern avoided*: **asserting at a layer that structurally cannot see the
  bug.** "A decimal length saves" passes here trivially — the actual defect is that
  such a row becomes wholly un-editable in the browser (FR-010), which no schema
  test can observe. The assertion is therefore explicitly labelled as recording the
  server's half of a divergence, with a pointer to the recorded gap, rather than
  posing as coverage of the bug.

### Success Criteria:

#### Automated Verification:

- `npm test` green; `src/lib/validation/library.test.ts` grows from 6 to ~16
  `updateEntrySchema`/`patchEntrySchema` assertions
- `npm run lint` and `npm run typecheck` clean

#### Manual Verification:

- Every documentation-of-behaviour assertion is annotated in-file as such, naming
  what would make it a decision to re-take — not left to look like a requirement
- No assertion restates a constant that appears in `validation/library.ts`

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Route contracts — `[id].ts` (PUT / PATCH / DELETE)

### Overview

Extract the duplicated Supabase builders into a shared helper, then prove the route
translates the service's outcomes into the right HTTP contract. **This suite proves
translation, not ownership** — a boundary the file must state in its header so no
reader mistakes the 404 test for isolation coverage.

### Changes Required:

#### 1. Shared Supabase mock helper

**File**: `test/helpers/supabase-mock.ts` (new)

**Intent**: Lift the five inline chain builders into one place and de-duplicate the
two `insertClient` copies, so the new route tests consume a helper rather than
adding a third copy.

**Contract**: export the builders currently inlined at `library.test.ts:23-35`,
`:179-197`, `:219-231`, `:249-265`, `:289-325` — each returning a chainable stub
that captures its arguments (patch payload, `.eq()` args). Migrate `library.test.ts`
and `identify.test.ts:43-52` to import from it; the existing 172 green tests are the
proof the extraction was faithful. Known limitation to carry over: no builder
captures `select("*", { count, head })`'s second argument, so `head: true` vs
`false` stays unobservable — note it, do not fix it speculatively.

#### 2. `[id].ts` route contract suite

**File**: `src/pages/api/library/[id].test.ts` (new)

**Intent**: Pin the request → (status, body, outgoing call) contract for all three
verbs. Roughly a five-line delta from the `identify.test.ts` context factory: add
`params: { id }`, drop the `cloudflare:workers` mock (this route imports neither it
nor IGDB), send JSON instead of `FormData`.

**Contract**: direct handler invocation with a cast `APIContext`, per
`identify.test.ts:24-34,90-104`.

**(a) Not-found translation across all three verbs.**
- *Behaviour asserted*: when the service throws `EntryNotFoundError`, PUT, PATCH and
  DELETE each answer **404** — and the id the handler passed into `.eq("id", …)` is
  the unmodified `params.id`.
- *Regression caught*: `PGRST116` / the empty-delete-set no longer mapping to
  `EntryNotFoundError`, which would surface as a 500 or — worse for DELETE — a
  misleading 204 on a row that was never deleted.
- *Research source*: research A2 (`library.ts:164-172`, `:183-189`);
  `[id].ts:45,91,123`.
- *Edge/error/boundary*: the 404-vs-500 discrimination — a generic catch must not
  swallow `EntryNotFoundError`, and the catch-all path is asserted separately.
- *Anti-pattern avoided*: **letting this read as isolation coverage.** The file
  header states that ownership is not enforced here at all (`library.ts:31-33`) and
  points to the pgTAP suite. Also, per Phase 1's F2 lesson, the `.eq` args are
  asserted — not just the status — so the test cannot pass with the stub removed.

**(b) Success contracts.**
- *Behaviour asserted*: PUT and PATCH answer 200 with `{ entry }`; DELETE answers
  **204 with an empty body**; PATCH forwards *only* the provided keys, leaving the
  omitted columns out of the patch entirely.
- *Regression caught*: PATCH degrading into a full-row write (clobbering fields the
  inline control never touched — the exact thing `patchEntrySchema` exists to
  prevent); a 204 gaining a body.
- *Research source*: `[id].ts:43,89,121`; `validation/library.ts:54-61`.
- *Edge/error/boundary*: 204-with-no-body is a protocol boundary, asserted on the
  body, not just the status.
- *Anti-pattern avoided*: asserting only status codes — the captured patch payload
  is what proves partiality.

**(c) Guards, both faces.**
- *Behaviour asserted*: with `@/lib/supabase` mocked to a client and no
  `locals.user` → **401** (`prd.md:188`). With `createClient` returning null and no
  user → **500 "Supabase is not configured"** — labelled documentation-of-behaviour,
  with the `prd.md:188` tension named in-file and recorded as a code gap.
- *Regression caught*: the auth guard being removed or reordered. Also documents
  that a misconfigured deploy leaks a config message to anonymous callers.
- *Research source*: research A5 (the guard-order trap and the vacuity it causes);
  `[id].ts:15-22`.
- *Edge/error/boundary*: the unconfigured-Supabase path — the case the vitest env
  stub produces *by default*, which is exactly why the naive 401 test is vacuous.
- *Anti-pattern avoided*: a vacuous assertion that passes for the wrong reason.

**(d) Malformed input.**
- *Behaviour asserted*: a non-JSON body → 400 "Invalid JSON body"; a schema failure
  → 400 carrying *a* message (not a specific literal); a stub-returned Postgres
  `22P02` → **500, not 400** — labelled documentation-of-behaviour, pinning the
  recorded gap.
- *Regression caught*: an unparseable body escaping into the service as `undefined`;
  the zod branch being bypassed.
- *Research source*: research A4 (non-UUID `params.id` → `22P02` → 500; no UUID
  validation anywhere — `[id].ts:25,70,114` only check `if (!id)`); B4 item 2.
- *Edge/error/boundary*: the database-error class that the route's catch-all maps to
  the wrong status — reproducible hermetically by having the stub return the code.
- *Anti-pattern avoided*: asserting the exact zod message string, which would mirror
  the library's wording and break on a zod upgrade while proving nothing.

### Success Criteria:

#### Automated Verification:

- `npm test` green — including `library.test.ts` and `identify.test.ts` after the
  helper migration (unchanged assertion count is the proof the extraction was faithful)
- `src/pages/api/library/[id].test.ts` covers PUT, PATCH and DELETE
- `npm run lint` and `npm run typecheck` clean

#### Manual Verification:

- The file header states plainly that this layer proves contract translation and
  **not** ownership, with a pointer to `supabase/tests/database/`
- No test in this file would change its result if RLS were disabled entirely

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Route contract — POST `/api/library`

### Overview

The most harness-expensive file, and the only layer that can reach
`createEntrySchema`. Also the only place the manual-vs-photo platform asymmetry can
be observed as an executable record.

### Changes Required:

#### 1. POST route suite

**File**: `src/pages/api/library/index.test.ts` (new)

**Intent**: Cover the create contract end-to-end, including the enrichment path,
without asserting anything the grounding tests already own.

**Contract**: direct handler invocation plus two pieces the `[id]` suite does not
need — `vi.mock("cloudflare:workers", () => ({ env: { IGDB_TOKENS: {} } }))` (a
`{}`-shaped KV forces a token-cache miss) and `installFetchRouter` for the IGDB
edge. The 400-path tests need neither and should run without them.

**(a) `createEntrySchema` boundaries.**
- *Behaviour asserted*: `{}` → 400; whitespace-only title → 400 "title is required";
  missing platform → 400; both present → proceeds.
- *Regression caught*: the inline create contract drifting from
  `lookupRequestSchema`, which it duplicates — the two can diverge silently because
  nothing imports one from the other.
- *Research source*: research B5 (`createEntrySchema` defined inline at
  `index.ts:14-17`, unexported, zero tests, a duplicate of
  `validation/library.ts:79-82`); `prd.md:94`.
- *Edge/error/boundary*: whitespace-only input, and the empty-body case the
  docstring explicitly calls a client error rather than a degraded `no_match`.
- *Anti-pattern avoided*: asserting at a layer that cannot see it — the schema is
  unexported, so a "unit test the schema" instinct would require a production edit
  to export it. The route is the honest layer.

**(b) The enriched 201, and what it persists.**
- *Behaviour asserted*: with the router answering the Twitch token and `/v4/games`,
  a create returns **201** with `{ entry }`, and the **captured insert payload
  carries the user's platform string verbatim** (`ps5`, not `PlayStation 5`).
- *Regression caught*: the route not forwarding `env.IGDB_TOKENS`; the create path
  silently gaining or losing normalization. The platform assertion is a **behaviour
  record**: if the manual path is ever normalized deliberately, this test goes red
  and is a decision to re-take, not a regression.
- *Research source*: research B3 — `vision.ts:137-138` are the *only* production
  call sites of the normalizers, verified by direct grep;
  `archive/2026-06-19-normalize-photo-platform-title/plan.md:61-63` (the manual path
  deliberately excluded).
- *Edge/error/boundary*: the asymmetry itself is the boundary — two write paths, one
  console, two stored strings, and an exact-match `.in()` platform filter
  (`library.ts:269`) that keeps them as two buckets.
- *Anti-pattern avoided*: **asserting an unbuilt feature.** A test asserting
  `PlayStation 5` on this path would fail against correct code. The assertion
  characterizes what is, labelled as documentation-of-behaviour with no PRD oracle
  behind it (the words "normalize"/"alias" do not appear in `prd.md` in a platform
  context).

**(c) Enrichment failure does not cost the user their input.**
- *Behaviour asserted*: when the router answers the IGDB games query with a 500, the
  request still returns 201 and the captured payload carries
  `metadata_status: "no_match"` with a null `igdb_id`.
- *Regression caught*: a flaky external API turning into a failed save — the exact
  promise `index.ts:20-25` makes.
- *Research source*: `index.ts:51-55` (the catch comment: enrichment never reaches
  here); §6.7 Phase 1's "assert on shape, not presence" rule.
- *Edge/error/boundary*: the upstream-failure branch — a sad path, asserted on the
  persisted *shape* rather than on "an insert ran".
- *Anti-pattern avoided*: happy-path-only coverage; and asserting insert
  *invocation*, which passes equally for a correct save and an un-grounded guess.

**(d) Guards.**
- *Behaviour asserted*: same two faces as Phase 3(c) — 401 with a mocked client,
  500 unconfigured — confirming the ordering is consistent across all four handlers.
- *Regression caught*: divergent guard behaviour between the create and edit routes.
- *Research source*: research A1 (the guard-order table), A5.
- *Edge/error/boundary*: as Phase 3(c).
- *Anti-pattern avoided*: as Phase 3(c) — no vacuous 401.

### Success Criteria:

#### Automated Verification:

- `npm test` green with the new file
- The 400-path tests run without the `cloudflare:workers` mock and without the fetch
  router (proving they genuinely never reach the IGDB edge)
- `npm run lint` and `npm run typecheck` clean

> **Adjusted during implementation (2026-07-25).** The second criterion is not
> expressible as written. `vi.mock` is hoisted per *file*, not per test, so the
> `cloudflare:workers` mock (`index.test.ts:39-46`) necessarily applies to every test in
> the suite — there is no "without the KV mock" state to run the 400-path tests in. The
> substituted claim is **stronger than the original**, not weaker: the KV binding is a
> counting getter, and every 400/401 test asserts `kv.reads === 0`, which proves the KV
> was never *consulted* rather than merely never *bound*. The fetch half stands as
> written — the 400 block installs no fetch router, so `test/setup/no-network.ts`'s
> deny-all remains armed and any real IGDB call fails the test. Rationale in-file at
> `index.test.ts:29-37`.

#### Manual Verification:

- The platform assertion is unmistakably labelled as a behaviour record, with the
  archive citation, so a reader does not read it as "normalization is correct here"
- No assertion duplicates what `igdb.integration.test.ts` already owns about grounding

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Recommender Supabase boundary (§6.6 carry-over)

### Overview

Close the hole Phase 2's mutation pass named in-file: `getRecommendations`' Supabase
boundary is uncovered and `listAllEntries` has no test anywhere in the repo.

### Changes Required:

#### 1. `listAllEntries`

**File**: `src/lib/services/library.test.ts`

**Intent**: Prove the all-entries fetch returns what the engine needs and fails
loudly when the database does.

**Contract**: reuse the chainable stub pattern (now in `test/helpers/supabase-mock.ts`).

- *Behaviour asserted*: the selected column list **contains every field
  `recommend()` reads** — `length_hours`, `play_status`, `date_bought`,
  `created_at`, `release_date`, `id` — asserted as containment, not equality; a
  Supabase `{ error }` result **throws** rather than returning garbage.
- *Regression caught*: a column dropped from the select. A missing `length_hours`
  would silently collapse every entry into one bucket and break FR-016 with no other
  test noticing. The throw keeps `play-next`'s `loadError` branch reachable.
- *Research source*: research section C; `recommendation.test.ts:67-69` (the Phase 2
  triage note naming this as a genuine hole); engine field reads at
  `recommendation.ts:74,90,92,104,115,128,131,148`.
- *Edge/error/boundary*: the error branch — a `{ data: null, error }` shape, which
  is the one case where returning instead of throwing would hand the engine
  `null` and produce a misleading empty state instead of the page's error state.
- *Anti-pattern avoided*: **mirroring the constant.** The expected columns are
  derived from what the engine reads, not copied from `RECOMMENDATION_COLUMNS`;
  containment (not equality) means adding a column is not a false failure. And
  `RECOMMENDATION_MAX_ROWS = 5000` is deliberately **not** asserted — a defensive
  cap with no PRD anchor, called out as having no behaviour impact at real scale in
  its own impl-review.

#### 2. `getRecommendations`

**File**: `src/lib/services/recommendation.test.ts`

**Intent**: Prove the thin wrapper wires the boundary to the engine faithfully.

**Contract**: stub the client, drive the real `recommend()`.

- *Behaviour asserted*: `limit` reaches the engine (observable in the returned item
  count); a throw from `listAllEntries` propagates; an empty result set yields
  `{ status: "empty", reason: "empty_library" }`.
- *Regression caught*: a swallowed error (which would render an empty library
  instead of an error state); a dropped `limit`.
- *Research source*: research section C — `getRecommendations` is an exported
  function in a plain `.ts` module, importable today with **zero production edits**
  (the Phase 2 `.astro` extraction precedent does not apply here).
- *Edge/error/boundary*: the zero-row boundary, which ties the I/O seam to the
  engine's `empty_library` contract that Phase 2 already pinned.
- *Anti-pattern avoided*: re-testing the engine. Everything about ranking is Phase
  2's; this asserts only the seam.

### Success Criteria:

#### Automated Verification:

- `npm test` green with both additions
- `npm run lint` and `npm run typecheck` clean

#### Manual Verification:

- The column assertion reads as derived-from-the-engine, not copied — a reviewer can
  trace each expected field to a line in `recommendation.ts`

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: Mutation pass + §6 cookbook update

### Overview

Harden the new Vitest assertions with Stryker, then write down what the phase
learned so the next contributor does not rediscover it.

### Changes Required:

#### 1. Selective mutation pass

**File**: (no source change expected; at most targeted test additions)

**Intent**: Find assertions that execute a line but would not fail if it broke —
the failure mode a stub-driven route suite is most prone to.

**Contract**: two invocations, one file each per §6.6's CLI quirk (a repeated
`--mutate` overrides rather than accumulates):
`npx stryker run --mutate "src/pages/api/library/[id].ts"`, then
`npx stryker run --mutate "src/lib/validation/library.ts"`. Read
`reports/mutation/index.html` between runs — it is overwritten. Triage every
survivor with §6.6's single question (*would this hurt a user or the business?*);
add at most one behavioural assertion per business-relevant survivor; log conscious
ignores in an in-file triage block, as `recommendation.test.ts:32-77` does.

**Scope limitation to state in the plan's own output**: Stryker cannot touch the
pgTAP layer, so **Risk #5's actual defense gets no mutation signal.** This pass
hardens Risk #6 and the route contract only. `.tsx` stays out of the mutate glob.

#### 2. §6.4 — the route-test recipe

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD — see §3 Phase 3" stub with the recipe this phase
actually shipped.

**Contract**: fill in §6.4 with: location/naming (co-located
`src/pages/api/library/<route>.test.ts`), the direct-handler-invocation pattern and
the context factory (including `params` for `[id].ts`), the shared
`test/helpers/supabase-mock.ts` builders, the two cost tiers (`[id].ts` needs no KV
mock or IGDB edge; `index.ts` needs both), **the vacuous-401 trap** (a 401
assertion without `vi.mock("@/lib/supabase")` fails or passes for the wrong reason
because the env stub leaves `SUPABASE_*` undefined), and the hard boundary: **this
layer proves contract translation, never ownership** — with a pointer to the pgTAP
section.

#### 3. New cookbook section — database policy (RLS) tests

**File**: `context/foundation/test-plan.md`

**Intent**: Document the new layer, which no existing section covers.

**Contract**: insert a new **§6.7 "Adding a database policy (RLS) test"** and
renumber the existing per-rollout-phase notes to §6.8 (nothing references §6.7 by
number today; §6.6 is referenced twice and is unaffected). Content: location
`supabase/tests/database/*.test.sql`; run with `npm run test:db` (Docker, separate
from `npm test`); the transactional skeleton (in-file `create extension … pgtap`,
`begin … rollback`, so no migration and no production schema change); the
`auth.users` insert (only `id` + `email` needed) because `user_id` FKs to it; the
impersonation idiom `set local role authenticated` + `set local
request.jwt.claim.sub`, with `auth.uid()`'s coalesce definition as the reason it
works — **source: Supabase docs via Context7 `/supabase/supabase`, checked:
2026-07-25**; and the three rules this phase learned:
1. **Positive control first** — assert `auth.uid()` is who you think, or a failed
   impersonation makes every isolation assertion pass vacuously.
2. **Assert the effect, not just the RETURNING set** — prefer `is_empty` over
   `results_ne` (which passes for any set differing from `{(1)}`, including a
   two-row breach), and then assert the table itself. **Do not repeat the disproved
   rationale**: a widened UPDATE policy over a narrow SELECT policy does *not*
   perform the write — Postgres applies SELECT policies to UPDATE/DELETE carrying a
   `WHERE`/`RETURNING` clause. Measured 2026-07-25; see Critical Implementation
   Detail #2 and the suite's falsification log.
3. **Include an `anon`-role assertion** — `anon` holds full table grants, so a
   policy widened `to anon` is invisible to an authenticated-only suite.
   Plus what the layer cannot prove: a service-key swap.

#### 4. §4, §5 and §6.8 housekeeping

**File**: `context/foundation/test-plan.md`

**Intent**: Keep the plan honest about what now exists.

**Contract**: §4's database-policy row moves from "none yet" to the shipped suite
(with the `npm run test:db` command); §5 gains a db-policy gate row — required after
Phase 3, enforced **locally** with CI wiring deferred to Phase 5, catching policy
drift; §6.8 gets a Phase 3 note covering the two inverted-guidance corrections, the
three recorded code gaps, and the mutation-pass scope limitation. §3's Phase 3 row
moves to `complete` and §8's freshness dates are stamped.

### Success Criteria:

#### Automated Verification:

- Both Stryker runs complete and the reports are read between runs
- `npm test` green after any assertions added by triage
- `npm run test:db` still green
- `npm run lint` and `npm run typecheck` clean

#### Manual Verification:

- §6.4 no longer says "TBD" and a reader could write a new route test from it alone
- The new pgTAP section carries the `checked: 2026-07-25` date on the
  externally-sourced idiom
- The Phase 3 note in §6.8 records the mutation pass's scope limitation rather than
  implying phase-wide hardening
- The three recorded code gaps are traceable from the test plan to this plan's
  "What We're NOT Doing"

---

## Testing Strategy

### Database policy tests (pgTAP):

- One suite, six groups: positive control, cross-user write refused (by effect),
  cross-user read empty, both facet RPCs scoped, foreign-`user_id` insert refused,
  `anon` sees nothing.
- Run: `npm run test:db` (requires the local stack).

### Unit tests:

- `patchEntrySchema` (incl. `.refine()` and the null-vs-omitted rule),
  `updateEntrySchema`'s uncovered fields, `listAllEntries`, `getRecommendations`.

### Integration tests (route contracts):

- `[id].ts` — PUT/PATCH/DELETE translation, guards both faces, malformed input.
- `index.ts` — `createEntrySchema`, the enriched 201 and what it persists, the
  enrichment-failure fold, guards.

### Manual Testing Steps:

1. Bring the local stack up (`npx supabase start`) and run `npm run test:db` —
   expect green.
2. In a scratch transaction, **widen** the policies (`for all using (true)`) and
   re-run — expect group (b) red (tests 4–7). Dropping the UPDATE policy instead
   reddens the positive control (test 3), which is also worth seeing. Restore.
3. Corrupt the `request.jwt.claim.sub` value in the fixture and re-run — expect the
   positive control red **before** any isolation assertion. Restore.
4. Run `npm test` — expect green, no Docker required.

## Performance Considerations

`npm test` stays hermetic and Docker-free (~3s). `npm run test:db` requires the
local stack (~60–120s cold) and is deliberately a separate command, so day-to-day
test runs are unaffected. CI cost is unchanged this phase.

## Migration Notes

No schema migration. pgTAP is created inside the test transaction and rolled back,
so no deployed database is touched. `supabase/seed.sql` is still not created.

## References

- Research: `context/changes/testing-route-contracts-isolation/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risks #5/#6), §3 Phase 3, §6.6
- Route-test precedent: `src/pages/api/identify.test.ts:24-34,90-104`
- Supabase mock builders: `src/lib/services/library.test.ts:23-35,179-197,219-231,249-265,289-325`
- The RLS-only ownership decision: `context/archive/2026-06-11-edit-and-delete-entry/plan.md:23,52,249`
- The decimal-input decision: `context/archive/2026-06-19-fix-decimal-game-length/plan.md:29`, `plan-brief.md:53`
- The manual-path normalization exclusion: `context/archive/2026-06-19-normalize-photo-platform-title/plan.md:61-63`
- pgTAP RLS pattern: Supabase docs via Context7 `/supabase/supabase` (checked 2026-07-25)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cross-user isolation — pgTAP policy suite

#### Automated

- [x] 1.1 `npm run test:db` passes with the local stack up — 5f2c505
- [x] 1.2 Suite goes red when the UPDATE policy is dropped in a scratch transaction — 5f2c505
- [x] 1.3 Positive control goes red first when `request.jwt.claim.sub` is corrupted — 5f2c505
- [x] 1.4 `npm test` still green at 172 tests — 5f2c505

#### Manual

- [x] 1.5 File reads as an argument — positive control first, effect-check rationale explained — 5f2c505
- [x] 1.6 Recorded limitations (service-key swap; RPC predicate caveat) present in the header — 5f2c505

### Phase 2: Validation schemas

#### Automated

- [x] 2.1 `npm test` green with the extended validation suite — 0ffdc8d
- [x] 2.2 `npm run lint` and `npm run typecheck` clean — 0ffdc8d

#### Manual

- [x] 2.3 Every documentation-of-behaviour assertion annotated as such in-file — 0ffdc8d
- [x] 2.4 No assertion restates a constant from `validation/library.ts` — 0ffdc8d

### Phase 3: Route contracts — `[id].ts`

#### Automated

- [x] 3.1 `npm test` green including `library.test.ts` / `identify.test.ts` after the helper migration — a7474f3
- [x] 3.2 `[id].test.ts` covers PUT, PATCH and DELETE — a7474f3
- [x] 3.3 `npm run lint` and `npm run typecheck` clean — a7474f3

#### Manual

- [x] 3.4 File header states this layer proves translation, not ownership, pointing to the pgTAP suite — a7474f3
- [x] 3.5 No test in the file would change its result if RLS were disabled — a7474f3

### Phase 4: Route contract — POST `/api/library`

#### Automated

- [x] 4.1 `npm test` green with `index.test.ts` — e6004b2
- [x] 4.2 The 400-path tests never *consult* the KV (`kv.reads === 0` on every 400/401 test) and run without the fetch router — e6004b2 — *adjusted during implementation; see the Phase 4 success-criteria note. `vi.mock` hoists per file, so "without the KV mock" is not an available state; the counting-getter assertion is the stronger substitute.*
- [x] 4.3 `npm run lint` and `npm run typecheck` clean — e6004b2

#### Manual

- [x] 4.4 Platform assertion labelled as a behaviour record with the archive citation — e6004b2
- [x] 4.5 No assertion duplicates `igdb.integration.test.ts`'s grounding coverage — e6004b2

### Phase 5: Recommender Supabase boundary

#### Automated

- [x] 5.1 `npm test` green with `listAllEntries` and `getRecommendations` additions — 4451d5a
- [x] 5.2 `npm run lint` and `npm run typecheck` clean — 4451d5a

#### Manual

- [x] 5.3 Column assertion traceable to engine reads, not to `RECOMMENDATION_COLUMNS` — 4451d5a

### Phase 6: Mutation pass + §6 cookbook update

#### Automated

- [x] 6.1 Both Stryker runs complete, reports read between runs — 28485ab
- [x] 6.2 `npm test` green after triage additions — 28485ab
- [x] 6.3 `npm run test:db` still green — 28485ab
- [x] 6.4 `npm run lint` and `npm run typecheck` clean — 28485ab

#### Manual

- [x] 6.5 §6.4 filled in — a reader could write a new route test from it alone — 28485ab
- [x] 6.6 New pgTAP section present, externally-sourced idiom dated `checked: 2026-07-25` — 28485ab
- [x] 6.7 §6.8 Phase 3 note records the mutation-pass scope limitation — 28485ab
- [x] 6.8 Three recorded code gaps traceable from the test plan to "What We're NOT Doing" — 28485ab
