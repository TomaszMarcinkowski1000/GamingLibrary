<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Quality-Gates Wiring

- **Plan**: `context/changes/testing-quality-gates-wiring/plan.md`
- **Scope**: Full plan — Phases 1–4 of 4
- **Date**: 2026-07-28
- **Verdict**: NEEDS ATTENTION → **triaged and closed 2026-07-28** (8 fixed, 1 skipped, 0 pending)
- **Findings**: 0 critical · 5 warnings · 4 observations

## Triage outcome (2026-07-28)

| Finding | Decision |
|---|---|
| F1 Unplanned production migration vs. plan scope | FIXED via Fix A — exception recorded in `plan.md`, `plan-brief.md`, test-plan §7 |
| F2 `anon` grant wider than justified | FIXED via Fix A — narrowed to `select`; **re-verified 18/18 pgTAP + 4/4 e2e** |
| F3 Seed script detects a collision but doesn't converge | FIXED via Fix A — **using `?filter=`, not the finding's `?email=`, which is silently ignored** |
| F4 `supabase/setup-cli` unpinned twice | FIXED — action pinned to SHA `ab05898…` (v1.7.1), CLI pinned to `2.98.2` |
| F5 "Two blocking jobs" is convention, not enforcement | SKIPPED — user's call; gap stays disclosed in test-plan §6.8 |
| F6 No `permissions:` / `timeout-minutes` | FIXED — `contents: read`; 10 min on `ci`, 20 on `e2e` |
| F7 Trace artifact captures the sign-in POST body | FIXED — recorded as fact 3 in `ci.yml`'s header |
| F8 Doc drifts vs. what CI literally runs | FIXED — (a) and (b); (c)/(d) left per Progress convention |
| F9 No top-level catch around `main()` | FIXED — redacting `try`/`catch`, exit code preserved |

**Post-triage verification** (all re-run after the edits): `npm test` 12 files / 238 tests PASS ·
`npm run lint` exit 0 · `npm run typecheck` 93 files, 0 errors / 0 warnings ·
`npm run test:db` **18/18 PASS** against a grant state rebuilt to match the narrowed migration ·
`npm run test:e2e` **4/4 passed** · `@action-validator/cli .github/workflows/ci.yml` exit 0.

**Two findings were corrected during triage rather than applied verbatim** — see F2 and F3. F3's
prescribed `?email=` lookup is not a filter at all on GoTrue v2.188.1; it returns every user, so
applying it as written would have made the script reset an arbitrary account. F2's "haven't run
`test:db` with only the select grant" blind spot was closed by measurement, and the migration
header was rewritten to name the detection it gives up rather than to repeat the old claim.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Success criteria verification

Every automated criterion in the plan was re-run for this review.

| Criterion | Command / evidence | Result |
|---|---|---|
| 1.1 / 3.1 Workflow parses | `npx @action-validator/cli .github/workflows/ci.yml` | PASS (exit 0) |
| 1.2 `npm test` | 12 files / 238 tests, 2.78s | PASS |
| 1.3 `npm run typecheck` | `astro check` — 93 files, 0 errors, 0 warnings | PASS |
| 1.4 / 2.1 `npm run lint` | clean | PASS |
| 3.4 `e2e` job green on a PR | run `30311624002` (sha `2a32e9c`) | PASS |
| 3.5 Playwright spec count | log: `Running 4 tests using 1 worker` / `4 passed (54.9s)` | PASS (see F8) |
| 3.6 Jobs parallel | `ci` start 22:41:40Z, `e2e` start 22:41:47Z | PASS |
| 3.7 Seam armed (identify 200) | asserted in-spec: `photo-capture-mobile.spec.ts:178` | PASS |
| 3.8 `e2e` wall-clock < 10 min | 4m13s | PASS |
| 3.9 Failure artifact | run `30310883911` → `playwright-report`, 6.5 MB, not expired | PASS |
| 3.10 No unmasked secrets in log | only the non-secret `E2E_EMAIL` literal appears | PASS |
| 4.1 Working tree clean | `git status --porcelain` empty | PASS |
| 4.2 Suite green after falsification | `npm test` + `typecheck` + `lint` all green | PASS |
| 4.3 Both jobs green on final push | run `30311624002` — `ci: success`, `e2e: success` | PASS |
| 4.4 Three breaks observed red | see falsification table below | PASS |
| 4.5 §5 gate table matches `ci.yml` | checked both directions | PASS (one naming nit, F8) |
| 4.6 `CLAUDE.md` names `main` | verified | PASS |
| 4.7 `e2e` required in branch protection | not satisfiable on this plan tier | N/A — see F5 |

### Falsification evidence (independently confirmed against GitHub)

| Gate | Run | Result |
|---|---|---|
| `npm test` | `30310144683` (sha `4919a01`) | `ci` **red at `npm test`**; `e2e` green |
| db policy | `30310648892` (sha `2d5c07a`) | `e2e` **red at `npm run test:db`** (`Failed 3/18 subtests`); `ci` green |
| e2e | `30310883911` (sha `ffb191b`) | `e2e` **red at `npm run test:e2e`**; `ci` green; artifact uploaded |

Each break reddened exactly the expected step while the other job stayed green, and none survives in
history (`git diff main...HEAD` touches no file under `src/`). This is the strongest part of the
change: the gates are proven to defend something, not merely to execute.

## Findings

### F1 — Unplanned production migration contradicts the plan's own scope statement

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Scope Discipline
- **Location**: `supabase/migrations/20260727220000_grant_library_entries_privileges.sql`
- **Detail**: `plan.md:111` states "**No production code changes.** (Phase 4 took that exception
  once, deliberately; see test-plan §7. This phase does not.)" and `plan-brief.md:52` lists "any
  production code change" as out of scope. Neither was amended when the exception was taken. The
  migration itself is a genuine fix, correctly diagnosed and correctly scoped: `20260606150950`
  enabled RLS and wrote four policies but never granted the table-level privileges they sit on top
  of, working only because Supabase historically issued blanket default privileges — which it is
  retiring. The `e2e` job builds its stack from `supabase/migrations/**` alone and surfaced it
  (`permission denied for table library_entries` on `supabase/postgres:17.6.1.143`, present on
  `.127`). It is documented in a 31-line file header, in both commit bodies (`ebd0705`, `3063da5`),
  and in test-plan §6.8. The gap is documentary: a reader of the plan alone is told the opposite of
  what shipped, and no standing bullet was added to test-plan §7 the way the Phase 4 exception got
  one. Operationally this also means merging PR #33 is a **schema-touching merge**: the migration is
  not on `main` (`git ls-tree main supabase/migrations/` lists only the four originals), and
  `migrate.yml` triggers on push to `main` with `paths: supabase/migrations/**`, so the merge applies
  it to production. Low risk — `grant` is additive and production already holds these grants via the
  old defaults — but not the pure CI-config merge the plan advertises.
- **Fix A ⭐ Recommended**: Amend the plan's "What We're NOT Doing" bullet to record the exception,
  and add the matching standing bullet to test-plan §7 alongside the Phase 4 one.
  - Strength: Preserves a correct fix and restores the plan as ground truth for future reviews;
    mirrors the exception-recording convention §7 already established.
  - Tradeoff: The plan becomes a moving target; the amendment lands after the fact rather than before.
  - Confidence: HIGH — §7 already carries a precedent bullet in exactly this shape.
  - Blind spot: None significant — the technical fix is verified sound.
- **Fix B**: Split the migration into its own change so the schema edit lands on its own reviewed PR.
  - Strength: Keeps scope discipline strict and makes the production schema change independently
    reviewable rather than riding a CI-config merge.
  - Tradeoff: The `e2e` gate cannot go green until that change merges, so this phase would land
    blocked on another; significant re-sequencing for a two-line additive grant.
  - Confidence: MEDIUM — correct in principle, but the coupling is real: the gate discovered the bug
    and cannot pass without the fix.
  - Blind spot: Haven't costed the branch/PR churn against the remaining plan work.
- **Decision**: FIXED via Fix A (2026-07-28). `plan.md`'s "No production code changes" bullet now
  records the exception in full — what shipped, why it could not be deferred, and the
  schema-touching-merge consequence via `migrate.yml`. `plan-brief.md:52`'s out-of-scope line
  carries a matching pointer. A standing bullet was added to test-plan §7 alongside the Phase 4
  one, framed on §7's own terms: the negative space it names is that **nothing asserts a deployed
  environment's grants match these migrations** — production's came from the old instance
  defaults, and `grant` being additive is what makes that assumption safe rather than any test.

### F2 — The `anon` grant is three privileges wider than its own justification requires

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260727220000_grant_library_entries_privileges.sql:34`
- **Detail**: `grant select, insert, update, delete on public.library_entries to anon;`. The migration
  header justifies the anon grant by the pgTAP suite's group (f), but **only `select` is
  load-bearing there**. Verified: group (f)'s write assertion is
  `throws_ok(… insert …, '42501', null, '(f) the anon role cannot write')`
  (`library_entries_rls.test.sql:307-313`), and `42501` is the SQLSTATE for *both* "permission denied
  for table" and "new row violates row-level security policy" — so it passes identically with or
  without the INSERT grant. Only `is_empty(…)` at `:302-305` needs a grant, and only `select`. There
  is no present breach: RLS is enabled (`20260606150950:30`), all four policies are `to authenticated`
  (`:34-44`), `anon` has zero applicable policies, and `user_id uuid not null default auth.uid()` is a
  second wall on insert. The cost is defense-in-depth and permanence: the header itself notes Supabase
  is moving to strictly opt-in Data API exposure, and this opts `library_entries` back in for `anon`
  on every future instance — unauthenticated `GET /rest/v1/` enumerates the table and its columns in
  the OpenAPI output, and RLS becomes the sole wall, so a future `disable row level security` or an
  RLS-dropping restore turns into full anonymous CRUD instead of a privilege denial.
- **Fix A ⭐ Recommended**: Narrow line 34 to `grant select on public.library_entries to anon;` and
  update the header's group-(f) paragraph to say `select` specifically. Leave line 33 unchanged.
  - Strength: Keeps the pgTAP breach detector working exactly as documented while dropping three
    privileges nothing needs; a one-line edit with a measurable check (`npm run test:db` stays 18/18).
  - Tradeoff: Diverges slightly from Supabase's historical default grant set, so the "no-op on
    existing environments" claim becomes "narrower than existing environments".
  - Confidence: HIGH — the 42501-covers-both-cases behaviour is confirmed against the suite's own
    assertion text.
  - Blind spot: Haven't run `npm run test:db` with only the select grant to confirm 18/18 empirically.
- **Fix B**: Drop the anon grant from the migration entirely and issue it transaction-locally inside
  the pgTAP suite (it runs in `begin … rollback`, `library_entries_rls.test.sql:112,319`).
  - Strength: Nothing anon-facing reaches production at all; the detection property is identical
    because the grant rolls back with the transaction.
  - Tradeoff: The test would then grant its own privileges, so it no longer asserts against the
    deployed privilege state — it would pass even if production's grants diverged.
  - Confidence: MEDIUM — mechanically sound, but it trades a real fidelity property for the hardening.
  - Blind spot: Unclear whether any other consumer relies on anon reaching this table via PostgREST.
- **Decision**: FIXED via Fix A (2026-07-28). Line 34 is now `grant select on public.library_entries
  to anon;`. **The stated blind spot was closed empirically, not argued away**: the local DB
  (`postgres:17.6.1.127`, which still carries the blanket defaults) had them revoked and the
  migration's exact grants re-applied — `anon → SELECT`, `authenticated → SELECT,INSERT,UPDATE,DELETE`
  — reproducing a from-migrations-alone stack. `npm run test:db` then returned **18/18 PASS**, and
  `npm run test:e2e` **4/4**. The migration header was rewritten to be honest about the trade rather
  than to restate the old claim: group (f)'s *write* assertion expects 42501, which covers permission
  denial and RLS denial alike, so it no longer distinguishes a widened INSERT policy from a missing
  privilege. That lost detection is named as the accepted cost; the read breach — the one the suite
  was written to catch — stays detectable because `select` is retained.

### F3 — Seed script's "idempotent" means the email exists, not that the password matches

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `scripts/seed-e2e-user.mjs:47-56,110-113`
- **Detail**: `isAlreadyRegistered` returns true on a 422/400 collision and `main` returns success
  without verifying or resetting the password. Combined with the workflow generating a fresh
  `E2E_PASSWORD` per run (`ci.yml:103`), any warm-stack execution — `act`, a self-hosted runner, a
  persisted Docker volume, or a developer re-running with a changed `.env` — seeds nothing, reports
  success, then fails opaquely later at `e2e/auth.setup.ts`'s "sign-in bounced back to /auth/signin"
  assertion. `ci.yml:100-101` explicitly leans on GitHub runners always being cold, which makes the
  guarantee environmental rather than a property of the script. Note this is a *consequence* of the
  per-run-password change (`ccda8a3`), which was itself a correct fix for a real 3.10 failure —
  `::add-mask::` is prospective-only, so a literal in the job `env:` block is echoed in the clear by
  every preceding step group.
- **Fix A ⭐ Recommended**: On the already-exists branch, look the user up via
  `GET /auth/v1/admin/users?email=…` and `PUT` the password and `email_confirm`, so the script
  converges on the requested state rather than merely detecting a collision.
  - Strength: Makes idempotence a property of the script instead of an assumption about the runner;
    fixes the local-developer case too, where a changed `.env` password silently does nothing.
  - Tradeoff: Adds a second and third admin API call and more error surface to a currently simple script.
  - Confidence: MEDIUM — the GoTrue admin lookup/update endpoints are stable, but the exact query
    parameter shape should be checked against the running version before committing.
  - Blind spot: Haven't verified the `?email=` filter form against this stack's GoTrue build.
- **Fix B**: Document the cold-runner dependency in the script's own header rather than only in the
  workflow comment.
  - Strength: Zero behaviour change; puts the caveat where someone re-running the script locally
    will actually read it.
  - Tradeoff: Leaves the trap armed — a warm-stack run still reports success and fails elsewhere.
  - Confidence: HIGH — purely documentary.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (2026-07-28) — **but not as specified, because the specified
  endpoint shape is wrong and would have introduced a worse bug.** Probing GoTrue v2.188.1
  directly: `GET /auth/v1/admin/users?email=nobody-xyz@example.com` returns **HTTP 200 with every
  user in the instance** — the parameter is silently ignored, so a script trusting it would reset
  the first unrelated account it got back. The real parameter is `?filter=`, and it is a *partial*
  match (`?filter=e2e` returns `e2e@example.com`). The implementation therefore uses `filter` plus
  an exact, case-insensitive email comparison over the result set, with both facts recorded in the
  function's docstring. Verified end to end against the live stack: a cold run created the account,
  a second run with a **different** password printed "password reset, confirmed", the new password
  authenticated **200** and the old one **400**; the throwaway account was deleted afterwards.
  `ci.yml`'s "runners are always cold" parenthetical and test-plan §5's "is idempotent" were both
  corrected, since the guarantee is now a property of the script rather than of the runner.

### F4 — `supabase/setup-cli` is unpinned twice, and this exact drift class caused the grant bug

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:69-71`
- **Detail**: `uses: supabase/setup-cli@v1` with `version: latest` — two independent unpinned inputs.
  `v1` is a mutable tag (a force-moved or compromised tag executes arbitrary code in the job), and
  `version: latest` makes CI non-reproducible. That is not hypothetical here: this whole migration
  exists *because* `supabase/postgres` moved from `17.6.1.127` to `17.6.1.143` and silently changed
  default privileges. A green run today and a red run tomorrow on an unchanged commit is live. The
  workflow concedes the risk at `:85-88` but mitigates only the narrow empty-variable case.
- **Fix**: Pin `version:` to a concrete CLI version and the action to a commit SHA
  (`supabase/setup-cli@<sha> # v1.x.y`). Note `migrate.yml:28-30` carries the same pattern *and*
  production secrets — out of scope for this change, but the higher-stakes instance.
- **Decision**: FIXED (2026-07-28). Now `uses: supabase/setup-cli@ab058987d8d6c725971f6cf9d0b5c98467e30bd1
  # v1.7.1` with `version: 2.98.2`. Both values are measured rather than guessed: `v1` currently
  resolves to exactly `ab05898…`, and the first all-green run (`30311624002`) logged
  `currently installed v2.98.2` — so `latest` was already **12 minor versions behind** the then-current
  v2.110.0, and the pin reproduces a known-good stack instead of silently tracking a moving one.
  The `for name in API_URL ANON_KEY SERVICE_ROLE_KEY` comment and its error message were updated,
  since they told the reader to do the thing that is now done. `migrate.yml` was left alone as
  out of scope, per the finding's own note.

### F5 — "Two blocking jobs" is a convention, not an enforcement

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `CLAUDE.md` (CI section); `plan.md:101-103` (Desired End State)
- **Detail**: Criterion 4.7 is checked with an honest inline `n/a`: branch protection is unavailable
  on a private Free-plan repo (both the protection and rulesets APIs answer 403), and test-plan §6.8
  records this candidly — "a red X can be merged past". But `CLAUDE.md` still opens with "runs **two
  blocking jobs in parallel**" and `plan.md:101` says "Both are blocking. Neither can be skipped by a
  label." Nothing currently prevents a merge past a red check. This is the single largest gap between
  what the docs claim the gate layer does and what it can enforce — disclosed in one place,
  overstated in another.
- **Fix**: Add a half-sentence qualifier to `CLAUDE.md`'s CI paragraph — the jobs are blocking by
  convention; branch protection is unavailable on this plan tier, see test-plan §6.8.
- **Decision**: SKIPPED (2026-07-28) — user's call. `CLAUDE.md` and `plan.md:101` keep their
  "two blocking jobs" / "Both are blocking" wording. The gap remains disclosed in test-plan §6.8,
  which records that the protection and rulesets APIs both answer 403 on this plan tier and that
  a red X can be merged past.

### F6 — No `permissions:` block and no `timeout-minutes` on either job

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:1-30,31-32,53-54`
- **Detail**: Both jobs inherit the repository/org default `GITHUB_TOKEN` scope, which on older repos
  is read/write-all. Neither uses the token beyond `actions/checkout`, so nothing is exploitable
  today, but a compromised transitive dependency in `npm ci` or the unpinned `setup-cli` (F4) would
  inherit whatever the default grants. Separately, neither job sets `timeout-minutes`, so both
  default to 360 — `supabase start` (image pulls) and `npx playwright install --with-deps` have no
  internal bound, and a stall burns six hours of runner time. (`concurrency:` is *deliberately*
  declined in the plan's "What We're NOT Doing" and is not a finding.)
- **Fix**: Add `permissions: contents: read` at workflow level, `timeout-minutes: 10` on `ci` and
  `20` on `e2e`.
- **Decision**: FIXED (2026-07-28). Workflow-level `permissions: contents: read`, plus
  `timeout-minutes: 10` on `ci` (measured ~1–2 min) and `20` on `e2e` (measured 4m13s). Each
  carries a one-line comment naming what it bounds. `concurrency:` remains deliberately declined
  per the plan's "What We're NOT Doing". Workflow re-validated: `@action-validator/cli` exit 0.

### F7 — Playwright trace artifact captures the sign-in POST body on a retry

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml:129-136`; `playwright.config.ts:40,46`
- **Detail**: With `retries: 2` and `trace: "on-first-retry"` in CI, a retried `auth.setup.ts` records
  `page.request.post("/api/auth/signin", { form: { email, password } })`
  (`e2e/auth.setup.ts:34-37`) — the password lands in the trace's post-data in cleartext, and
  `::add-mask::` redacts log output, not artifact contents. Practical impact is near zero by design:
  the password is per-run random and the account dies with the container, and `e2e/.auth/user.json`
  is correctly outside the upload paths. Recording it so the property is understood as "the leaked
  value is worthless" rather than "nothing leaks".
- **Fix**: No code change required; add a line to the workflow header noting that artifact contents
  are unmasked and that this is safe only because both secret values are per-run and ephemeral.
- **Decision**: FIXED (2026-07-28). Added as fact 3 in `ci.yml`'s header block, alongside the two
  facts already recorded there as expensive to re-derive. It states the mechanism (`::add-mask::`
  redacts log output, not uploaded files), the specific path (`trace: "on-first-retry"` captures
  the sign-in POST body verbatim), the single reason it is safe (both values are per-run and die
  with the container, so the captured value is worthless by download time), and the condition that
  would break it (either value becoming a repository secret). Also notes that
  `e2e/.auth/user.json` holds a real session and is deliberately outside both upload paths.

### F8 — Small documentation drifts between the docs and what CI literally runs

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `CLAUDE.md`; `context/foundation/test-plan.md` §5; `.env.example:14-19`; `plan.md:593,596`
- **Detail**: Four unrelated one-liners, none load-bearing. (a) `CLAUDE.md` and test-plan §5 both say
  the job "seeds the e2e user (`npm run seed:e2e-user`)" while `ci.yml:108` calls
  `node scripts/seed-e2e-user.mjs` directly — same script, different entry point, and the one place
  the docs don't quote CI literally. (b) `.env.example` still instructs contributors to create the
  e2e user by hand via signup + Mailpit, now superseded by the script — this one was *deliberately*
  deferred in the plan's "What We're NOT Doing" and flagged there as a known inconsistency, so it is
  a tracked debt rather than drift. (c) Progress line 593 says "17 pgTAP assertions"; the suite is now
  18 (`library_entries_rls.test.sql:116` reads `select plan(18);`) — expected, since the Progress
  convention forbids renaming step titles, and test-plan §4/§6.7 were correctly re-counted. (d)
  Criterion 3.5 reads "3 specs run, 0 skipped" but the log prints `Running 4 tests using 1 worker` —
  3 specs plus `auth.setup.ts`, so consistent, but the wording doesn't match what a reader will see.
- **Fix**: Point `.env.example` at `npm run seed:e2e-user` (keeping the manual route as fallback), and
  quote CI's actual invocation in the two docs. Leave the Progress lines alone per convention.
- **Decision**: FIXED (2026-07-28). (a) `CLAUDE.md` and test-plan §5 now quote CI's literal
  `node scripts/seed-e2e-user.mjs` and name `npm run seed:e2e-user` as the same script's local
  entry point. (b) `.env.example` leads with the seed command and keeps the signup + Mailpit route
  as an explicit fallback — it also now says re-seeding resets the password, so editing the values
  there no longer requires resetting the stack. (c) and (d) left alone: the Progress step titles
  are frozen by convention, and 3.5's wording is consistent once `auth.setup.ts` is counted.

### F9 — Seed script has no top-level catch around `main()`

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/seed-e2e-user.mjs:118`
- **Detail**: `await main();` is unguarded. An unexpected throw — e.g. `response.text()` on a
  connection reset at `:103` — bypasses `redact` and prints an unhandled rejection with a stack trace.
  No env values appear in Node stack traces and the process still exits non-zero so CI fails
  correctly, so this is cosmetic rather than a leak. Worth closing because this script is the one
  place in the repo holding both a service-role key and the password, and its other paths are all
  carefully redacted.
- **Fix**: Wrap in `try { await main(); } catch (e) { fail(redact(String(e), [serviceRoleKey, password])); }`.
- **Decision**: FIXED (2026-07-28). Wrapped as specified, reading the two secrets from
  `process.env` since `serviceRoleKey` / `password` are scoped inside `main()`; `redact` already
  filters falsy entries, so an early throw before those vars are set is handled. Routes through
  `fail`, so the non-zero exit CI depends on is preserved.

## Notes on what the review did not find

Recorded because they are the failure modes this phase existed to rule out, and each was checked:

- **No CRITICAL findings.** The migration opens no unauthenticated read or write path — traced end to
  end and confirmed independently of the sub-agent.
- **Secret handling is correct throughout.** `::add-mask::` is issued at `ci.yml:104-105` immediately
  after generation and before any consumer; `.dev.vars` is gitignored and outside both artifact paths;
  the seed script redacts on every printing path, and the fetch-failure path cannot surface the bearer
  token (`String(error)` does not walk the `cause` chain).
- **The local-host guard is airtight** against the realistic threat. `127.0.0.1.evil.com`,
  `http://127.0.0.1@evil.com/`, and unparseable URLs all fail closed; `[::1]` is correctly allowed.
- **`eval "$(supabase status -o env)"` does not fail under `set -e`** (command-substitution status is
  discarded, `eval ""` returns 0) — but the `for name in API_URL ANON_KEY SERVICE_ROLE_KEY` loop at
  `:89-94` catches it. That loop is load-bearing for more than the CLI-drift case its comment
  describes; it is also the only detector for `supabase status` itself failing.
- **The plan's declined-scope list holds in full**: no `playwright.config.ts` change, no `concurrency`
  group, no browser cache, no `continue-on-error`, no skip label, no Stryker wiring.
- **No planned item is MISSING.** All four Phase 4 documentation edits landed, plus the §6.8 note; §5's
  gate table matches `ci.yml` in both directions.
