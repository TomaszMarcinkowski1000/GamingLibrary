-- Database policy (RLS) test: cross-user isolation on public.library_entries.
-- Test rollout Phase 3, Risk #5 (cross-user library exposure).
--
-- Run with:  npm run test:db        (requires the local stack: npx supabase start)
--
-- WHY THIS LAYER EXISTS
-- Ownership in this app is 100% Postgres and 0% TypeScript. src/lib/services/library.ts:31-33
-- states the rule in production code: "RLS does user isolation, so these queries never filter
-- by user_id themselves." The only predicate the application writes is .eq("id", id). A
-- stubbed-Supabase route test therefore cannot say anything about isolation — it would assert
-- the fake's own configuration while reading as coverage. This file is the layer that owns the
-- claim, and the only one that can prove it.
--
-- HOW THE ARGUMENT IS BUILT (the ordering carries the correctness, so do not reshuffle)
--
--   1. POSITIVE CONTROL FIRST. If `set local request.jwt.claim.sub` fails to take effect,
--      auth.uid() is NULL, `auth.uid() = user_id` evaluates to NULL, and every row is hidden
--      from everyone. Every "B cannot see A's rows" assertion below then passes while proving
--      nothing. Group (a) asserts impersonation is live before any isolation claim is made.
--
--   2. ISOLATION IS ASSERTED BY EFFECT, NOT BY THE RETURNING SET. The documented pgTAP idiom
--      is `results_ne($$ update ... returning 1 $$, $$ values(1) $$)`, which asserts a *proxy*:
--      "the statement returned nothing". Group (b) attempts the write as B, then resets to the
--      (BYPASSRLS) role the test connects as and asserts the thing that actually matters —
--      A's rows still carry their original titles and still exist. Two reasons that is worth
--      the extra four lines:
--        * `results_ne` passes for ANY set differing from {(1)}, including a two-row breach.
--          `is_empty` is the correct proxy assertion, and is what this file uses.
--        * an empty RETURNING set is evidence about the *statement's output*, not about the
--          table. Asserting the table directly makes the claim independent of how Postgres
--          happens to compose RLS with RETURNING.
--      NOTE, because an earlier draft of this suite argued otherwise: the specific "the write
--      lands but RETURNING is filtered to empty, so the route answers a reassuring 404 over a
--      mutated row" scenario is NOT reachable here. Postgres applies SELECT policies to
--      UPDATE/DELETE that carry a WHERE or RETURNING clause, so widening UPDATE alone changes
--      nothing *for statements carrying one of those clauses*, and dropping SELECT blocks the
--      write outright. Both measured — see the falsification log below. The effect check earns
--      its place on the two reasons above, not on that scenario.
--      THAT QUALIFIER IS LOAD-BEARING. A statement carrying NEITHER a WHERE nor a RETURNING
--      clause gets no SELECT-policy composition, so the UPDATE policy's own USING clause is the
--      only thing standing between B and A's rows. Widening UPDATE alone therefore DOES cross
--      users for such a statement. Test 8 is that case, and it is the only assertion in this
--      file that reddens on "UPDATE widened alone" — every other write assertion here carries a
--      WHERE and is silently rescued by the narrow SELECT policy. The application cannot issue
--      such a statement today (every write in src/lib/services/library.ts goes through
--      .eq("id", id) — :164,183), but that is an app-layer argument and this suite exists
--      because ownership is 100% Postgres: the database must hold on its own terms.
--
--   3. THE `anon` ROLE IS ASSERTED EXPLICITLY. anon holds full table grants
--      (DELETE,INSERT,SELECT,UPDATE,...) — Supabase default privileges. The *absence of an anon
--      policy is the entire wall*, not a second line of defense. A policy widened `to anon` or
--      `for all using (true)` is one line of SQL from a full breach and is completely invisible
--      to a suite that only impersonates authenticated users.
--
-- WHAT THIS SUITE CANNOT PROVE
--   * A SUPABASE_KEY swapped for the service/secret key. service_role and postgres carry
--     rolbypassrls = t; the cookie session still resolves, every auth guard still passes, and
--     every query silently returns all users' rows. pgTAP never goes through the app's client,
--     so no database test can see it. Already flagged as a deployment concern —
--     context/changes/deployment/deployment-plan.md:107.
--   * That a `security invoker` -> `security definer` flip on the two RPCs would be caught.
--     Both RPCs carry an explicit `user_id = (select auth.uid())` predicate *in addition* to
--     RLS, so group (d) proves that predicate holds — it does not independently prove RLS is
--     still the backstop behind it.
--
-- FALSIFICATION LOG (measured 2026-07-25 against the local stack, each breach injected into a
-- scratch copy of this file inside the same rolled-back transaction). A suite nobody has seen
-- fail is a suite nobody has reason to trust, so the evidence lives here:
--
--   injected breach                                   -> tests that go red
--   ------------------------------------------------------------------------------------
--   `for all using (true)` (SELECT + UPDATE widened)  -> 2, 4, 5, 6, 7, 10, 16
--   SELECT policy widened to `using (true)`           -> 2, 9, 10
--   UPDATE policy widened alone, SELECT left narrow   -> 8 ONLY
--   a policy added `to anon`                          -> 17, 18
--   INSERT policy relaxed to `with check (true)`      -> 16
--   RPC user_id predicate dropped + SELECT widened    -> 11 (and 2, 9, 10)
--   `request.jwt.claim.sub` set to a stranger's uuid  -> 1 FIRST, then 2, 3, 10-15
--   UPDATE policy dropped                             -> 3 (the positive control, not group b:
--                                                          a dropped policy is MORE restrictive)
--
-- (Re-measured in full 2026-07-25 when test 8 was added; every pre-existing row reproduced
-- exactly, shifted by the one inserted index. The `for all` row is a blanket policy replacing
-- all four — it widens INSERT and DELETE too, which is why it reddens more than the
-- SELECT+UPDATE pair alone.)
--
-- Three things that log makes explicit and no assertion states on its own:
--   * With the impersonation corrupted, groups (b), (e) and (f) still pass IN FULL, and so does
--     the cross-user read in (c) — 9 green isolation assertions (4-9, 16-18) over a NULL
--     auth.uid(). Re-measured 2026-07-25 by deleting the `set local request.jwt.claim.sub` line
--     and running this file directly; only tests 1, 2, 3 and 10-15 go red, which is the same red
--     set the stranger's-uuid row above records. (An earlier draft of this bullet said "groups
--     (b), (e) and (f) — 6 assertions"; it undercounted and omitted the cross-user read. Test 8
--     joined the green set when it was added.) That is the vacuous pass in the flesh, and test 1
--     is the only thing standing between it and a suite that looks like coverage.
--   * Test 8 is the ONLY assertion here that fails on "UPDATE widened alone" — and it is also
--     vacuous under the blanket `for all` widening, because test 5's delete has by then already
--     removed A's rows, leaving nothing for the unfiltered update to reach. Each of those two
--     breaches is caught, but by disjoint assertions; neither row of the log covers for the
--     other. Do not delete test 8 on the grounds that "the `for all` row already reddens".
--   * Group (d) survives a widened SELECT policy, because both RPCs carry their own explicit
--     user_id predicate. It only goes red once that predicate is ALSO gone. That is the caveat
--     recorded above, confirmed rather than assumed.
--
-- Impersonation idiom (`set local role authenticated` + `set local request.jwt.claim.sub`)
-- per Supabase docs via Context7 `/supabase/supabase`, checked: 2026-07-25. It works because
-- auth.uid() in this database is
--   coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
--            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
-- (verified live, 2026-07-25).

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

-- ---------------------------------------------------------------------------
-- Fixture: two real auth users, then rows for each.
-- library_entries.user_id FKs to auth.users(id) (migration 20260606150950:9), so the rows
-- need real auth users behind them. Only `id` is NOT NULL without a default, but gotrue's
-- own lookups expect an email, so both are supplied.
-- A's and B's platform / genre / series / play_status values are deliberately DISJOINT, so a
-- facet leak shows up as a *present extra value* rather than as a count mismatch.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'user-a@test.local'),
  ('22222222-2222-4222-8222-222222222222', 'user-b@test.local');

insert into public.library_entries (user_id, title, platform, genre, series, play_status) values
  ('11111111-1111-4111-8111-111111111111', 'Alpha Quest',    'PlayStation 5',    array['RPG'],     array['Alpha Saga'],       'completed'),
  ('11111111-1111-4111-8111-111111111111', 'Alpha Quest II', 'PC',               array['Shooter'], array['Gamma Cycle'],      'not_played'),
  ('22222222-2222-4222-8222-222222222222', 'Beta Run',       'Nintendo Switch',  array['Puzzle'],  array['Beta Chronicles'],  'playing_now');

-- Impersonate user B for everything that follows.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

-- ---------------------------------------------------------------------------
-- (a) POSITIVE CONTROL — impersonation is live.
-- Everything below this block is meaningless without it: a silently-ignored `set local`
-- leaves auth.uid() NULL, which hides every row from everyone and makes every isolation
-- assertion pass as a tautology.
-- ---------------------------------------------------------------------------

select is(
  (select auth.uid()),
  '22222222-2222-4222-8222-222222222222'::uuid,
  '(a) impersonation is live — auth.uid() is user B, not NULL'
);

select results_eq(
  'select count(*) from public.library_entries',
  array[1::bigint],
  '(a) B sees exactly B''s own row (3 rows exist in the fixture)'
);

select results_eq(
  $$ update public.library_entries set play_time_hours = 42
     where user_id = '22222222-2222-4222-8222-222222222222'::uuid returning 1 $$,
  $$ values (1) $$,
  '(a) B''s update of B''s own row affects exactly one row — writes are not blanket-denied'
);

-- ---------------------------------------------------------------------------
-- (b) Cross-user write is refused, proven BY EFFECT.
-- is_empty (not results_ne) for the zero-rows claim: results_ne passes for *any* set that
-- differs from {(1)}, including a two-row breach. Then the effect check below, which asserts
-- A's data rather than the statement's output. Measured: under a `for all using (true)`
-- widening, tests 4-5 and 6-7 all go red — the proxy and the effect agree. The effect check is
-- kept because it states the claim in the terms the PRD states it (prd.md:171), not because
-- the proxy is known to miss something.
-- ---------------------------------------------------------------------------

select is_empty(
  $$ update public.library_entries set title = 'Hacked!'
     where user_id = '11111111-1111-4111-8111-111111111111'::uuid returning 1 $$,
  '(b) B''s update of A''s rows affects zero rows'
);

select is_empty(
  $$ delete from public.library_entries
     where user_id = '11111111-1111-4111-8111-111111111111'::uuid returning 1 $$,
  '(b) B''s delete of A''s rows affects zero rows'
);

-- The unfiltered write. Both assertions above carry a WHERE, which means Postgres composes the
-- (narrow) SELECT policy into them — so both stay green even if the UPDATE policy is widened to
-- `using (true)`, and neither can see that breach. A statement with no WHERE and no RETURNING
-- gets no such composition: the UPDATE policy's USING clause is the only wall. Asserted by
-- effect below (test 8); there is no RETURNING set to check, by construction.
-- It writes play_time_hours rather than title so it cannot disturb the title assertions.
update public.library_entries set play_time_hours = 999;

-- Back to the (BYPASSRLS) role the test connects as, to observe what actually landed.
reset role;

select results_eq(
  $$ select title from public.library_entries
     where user_id = '11111111-1111-4111-8111-111111111111'::uuid order by title $$,
  $$ values ('Alpha Quest'::text), ('Alpha Quest II'::text) $$,
  '(b) EFFECT: A''s rows still carry their original titles — the write did not land'
);

select results_eq(
  $$ select count(*) from public.library_entries
     where user_id = '11111111-1111-4111-8111-111111111111'::uuid $$,
  array[2::bigint],
  '(b) EFFECT: A''s rows still exist — the delete did not land'
);

select is_empty(
  $$ select 1 from public.library_entries
     where user_id = '11111111-1111-4111-8111-111111111111'::uuid
       and play_time_hours = 999 $$,
  '(b) EFFECT: B''s unfiltered UPDATE (no WHERE, no RETURNING) did not reach A''s rows'
);

-- Resume impersonating B (request.jwt.claim.sub is still set for this transaction).
set local role authenticated;

-- ---------------------------------------------------------------------------
-- (c) Cross-user read returns nothing.
-- This is the vector with no API route at all — every list read happens in .astro
-- frontmatter, unreachable from a route test. One whole-table read stands in for every
-- filter dimension: search/filter/sort add no surface, they are the same single RLS
-- dependency reached through zero extra machinery.
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select 1 from public.library_entries
     where user_id = '11111111-1111-4111-8111-111111111111'::uuid $$,
  '(c) B''s select over A''s rows returns nothing'
);

select results_eq(
  $$ select title from public.library_entries order by title $$,
  $$ values ('Beta Run'::text) $$,
  '(c) a whole-table read as B returns exactly B''s own rows'
);

-- ---------------------------------------------------------------------------
-- (d) Both facet RPCs return only the caller's values.
-- Values, not counts — a count can match while the values are wrong.
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select * from public.list_used_platforms() $$,
  $$ values ('Nintendo Switch'::text) $$,
  '(d) list_used_platforms() returns only B''s platform'
);

select results_eq(
  $$ select e->>'value' from jsonb_array_elements(public.library_facets()->'platforms') as e order by 1 $$,
  $$ values ('Nintendo Switch'::text) $$,
  '(d) library_facets() platforms are B''s only'
);

select results_eq(
  $$ select e->>'value' from jsonb_array_elements(public.library_facets()->'genres') as e order by 1 $$,
  $$ values ('Puzzle'::text) $$,
  '(d) library_facets() genres are B''s only — A''s unnested genre values do not leak'
);

select results_eq(
  $$ select e->>'value' from jsonb_array_elements(public.library_facets()->'series') as e order by 1 $$,
  $$ values ('Beta Chronicles'::text) $$,
  '(d) library_facets() series are B''s only — A''s unnested series values do not leak'
);

select results_eq(
  $$ select e->>'value' from jsonb_array_elements(public.library_facets()->'statuses') as e order by 1 $$,
  $$ values ('playing_now'::text) $$,
  '(d) library_facets() statuses are B''s only'
);

-- ---------------------------------------------------------------------------
-- (e) A foreign-user_id insert is refused by the INSERT WITH CHECK.
-- The explicit-user_id path, distinct from the `default auth.uid()` path the app uses: the
-- default is not a constraint, the WITH CHECK is. This is the only thing preventing a row
-- transfer if user_id were ever added to updateEntrySchema.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.library_entries (user_id, title, platform)
     values ('11111111-1111-4111-8111-111111111111'::uuid, 'Smuggled', 'PC') $$,
  '42501',
  null,
  '(e) B cannot insert a row owned by A — the INSERT WITH CHECK refuses it'
);

-- ---------------------------------------------------------------------------
-- (f) The anon role sees nothing.
-- anon holds full table grants, so this is the assertion that catches a policy widened
-- `to anon` / `using (true)` — the cheapest one-line breach, and invisible to every
-- authenticated-only assertion above.
-- ---------------------------------------------------------------------------

set local role anon;

select is_empty(
  $$ select 1 from public.library_entries $$,
  '(f) the anon role sees no rows at all'
);

select throws_ok(
  $$ insert into public.library_entries (user_id, title, platform)
     values ('22222222-2222-4222-8222-222222222222'::uuid, 'Anonymous', 'PC') $$,
  '42501',
  null,
  '(f) the anon role cannot write'
);

reset role;

select * from finish();

rollback;
