# Quality-Gates Wiring Implementation Plan

## Overview

Rollout Phase 5 of `context/foundation/test-plan.md`: turn `.github/workflows/ci.yml`
from a lint + build workflow into the **enforced gate layer** for the four suites
Phases 1–4 built. No new test is authored here and no production behaviour changes;
the deliverable is that a PR which breaks any of those suites cannot merge green.

The phase is verified by **falsification**, not by a green run. A gate that executes
but cannot fail is the exact "reads as coverage" failure mode §2, §6.4 and §6.7 keep
naming — and at this layer it is unusually easy to produce (a swallowed exit code, a
Playwright run that matched zero specs, a `.dev.vars` the server never read).

## Current State Analysis

**What CI enforces today** (`.github/workflows/ci.yml`, 25 lines, one job `ci`,
triggers `push`/`pull_request` on `main`):

```
npm ci → npx astro sync → npm run lint → npm run build
```

`npm run build` receives the **production** `SUPABASE_URL` / `SUPABASE_KEY` repository
secrets. Nothing else runs.

**What exists but is unenforced:**

| Suite | Command | Size | Enforced where today |
|---|---|---|---|
| unit + integration | `npm test` | 12 files / 238 tests, ~3s, hermetic | husky `lint-staged` → `vitest related --run` (scoped to staged files, skippable) |
| typecheck | `npm run typecheck` | `astro check` | husky `pre-commit` (skippable) |
| db policy (RLS) | `npm run test:db` | 17 pgTAP assertions | local only, manual |
| e2e | `npm run test:e2e` | 3 specs, ~30s local | local only, manual |

**Why `npm test` is the priority.** `src/lib/services/vision.ts` carries a production
bypass path (`stubbedVisionRead`, wired at `identify.ts:143`) that is fail-closed only
because two independent locks hold — the `E2E_VISION_STUB_KEY` secret must be set *and*
the request must present a matching `x-e2e-vision-key` header. `src/lib/services/vision.test.ts`
(10 cases) is the **only** enforcement anywhere that they stay that way, and both
`vision.ts` and `test/stubs/astro-env-server.ts` cite that suite as standing evidence
the default state is dead. Until this gate lands, a PR can disarm or invert it with
green CI (test-plan §5).

**Constraints discovered:**

- `playwright.config.ts` is **already CI-shaped** — `forbidOnly: IS_CI`, `retries: 2`,
  `workers: 1`, `[["list"], ["html", { open: "never" }]]`, `reuseExistingServer: !IS_CI`,
  and a `try/catch` around `process.loadEnvFile(".env")` annotated *"CI may inject
  E2E_EMAIL / E2E_PASSWORD as real environment variables instead"* (`:21-25`). **No config
  change is required by this phase.**
- `supabase/config.toml:209` sets `enable_confirmations = false`, so a user created in
  the local stack is usable immediately — no Mailpit step.
- There is **no `supabase/seed.sql`**; the local stack starts with zero `auth.users` rows.
- `npm test` is genuinely hermetic: `test/setup/no-network.ts` denies unrouted `fetch`
  suite-wide and `test/stubs/astro-env-server.ts` supplies dummy secrets. It needs **no
  secrets and no services**.

### Key Discoveries:

- **The e2e job needs no provider secrets.** `identify.ts:167-169` catches every
  grounding failure (`// IGDB/Twitch transport, auth, or missing-KV failure — fall
  through to a null-id response`), so the journey completes identically whether IGDB is
  configured or not. Combined with the vision seam replacing the OpenRouter hop, the
  heavy job needs **no `OPENROUTER_API_KEY`, no `TWITCH_*`, and no outbound network**.
- **The inherited contract in `change.md` has one error worth correcting.** It says CI
  should write `.dev.vars` "from repository secrets, carrying `SUPABASE_URL`,
  `SUPABASE_KEY`, `E2E_VISION_STUB_KEY`." Those repo secrets point at **production**, and
  the specs create and delete library rows in the `E2E_EMAIL` account. `SUPABASE_URL` /
  `SUPABASE_KEY` for the e2e job must come from the **container** (`supabase status -o env`
  → `API_URL` / `ANON_KEY`), never from the secrets `npm run build` uses. Only the trigger
  order was right.
- **`E2E_VISION_STUB_KEY` needs no repository secret at all.** It is local-only and
  single-run; generating it per job (`openssl rand -hex 32`) is both simpler and safer
  than storing a long-lived value. Net effect: **the e2e job consumes zero repository
  secrets.**
- **Specs never touch Supabase directly.** `e2e/helpers/cleanup.ts` deletes through the
  UI. So the spec side needs exactly three env vars: `E2E_EMAIL`, `E2E_PASSWORD`,
  `E2E_VISION_STUB_KEY`.
- **`supabase status -o env` emits shell-quoted lines** (`ANON_KEY="eyJ…"`) — verified
  against current Supabase docs via Context7, checked: 2026-07-27. Appending that stream
  straight to `$GITHUB_ENV` stores the quotes as part of the value. See Critical
  Implementation Details.
- Supabase's own documented CI pattern is `supabase/setup-cli@v1` → `supabase start` →
  `supabase test db` (Context7 `/supabase/supabase`, checked: 2026-07-27). `migrate.yml`
  already uses `setup-cli@v1` in this repo.
- `wrangler.jsonc:15-21` binds `IGDB_TOKENS`; `astro dev` materializes a local KV under
  `.wrangler/state`. A fresh CI checkout means a guaranteed cache miss → token mint →
  failure → caught. Deterministic, not flaky.

## Desired End State

Every PR to `main` runs two jobs in parallel:

- **`ci`** (no Docker, ~2 min): `npm ci` → `astro sync` → `npm test` → `lint` →
  `typecheck` → `build`.
- **`e2e`** (~6–8 min): local Supabase stack → seeded e2e user → `.dev.vars` written
  from the container's own keys → `npm run test:db` (17 pgTAP assertions) →
  `npm run test:e2e` (3 specs).

Both are blocking. Neither can be skipped by a label. `test-plan.md` §5's gate table
describes what CI actually does, and `CLAUDE.md` no longer misstates the gate list or
the branch.

**How to verify:** the falsification table in Phase 4 — each gate has been watched go
red against a deliberate break of the behaviour it defends, and the break reverted.

## What We're NOT Doing

- **No new tests.** Every suite this phase enforces already exists and is green.
- **No production code changes.** (Phase 4 took that exception once, deliberately; see
  test-plan §7. This phase does not.)
- **No `playwright.config.ts` changes.** It is already CI-shaped; see Current State.
- **No `concurrency` group and no Playwright browser cache** — both considered and
  declined during planning. Revisit if heavy-job minutes become a problem.
- **No `continue-on-error` and no `skip-e2e` label.** An escape hatch is what a PR
  disarming the seam guard would reach for.
- **No `.env.example` / `e2e/RULES.md` rewrite.** The seed script added in Phase 2 is
  primarily a CI mechanism; local devs keep their existing signup flow. *Flagged as a
  known small inconsistency:* `.env.example` will still describe the manual
  "sign up at localhost, check Mailpit" ritual while a script now does it in one command.
  Documenting it is a two-line follow-up, deliberately out of scope here.
- **No CI troubleshooting prose.** Better written after the gate has failed in anger.
- **No deployment / branch-protection changes.** Marking the new `e2e` check *required*
  in GitHub branch protection is a repo-settings action outside this plan; called out in
  Phase 4's manual criteria so it is not silently forgotten.
- **No CI wiring for `npm run test:mutation`.** Stryker is a selective, on-demand gate
  by design (test-plan §6.6); putting it on every PR contradicts that.

## Implementation Approach

Four phases, ordered so the highest-value gate lands first and each phase is
independently verifiable:

1. `npm test` + typecheck into the existing job — no services, no secrets, smallest
   possible diff, closes the seam-guard hole §5 flags as urgent.
2. The seed script — verifiable **locally** against a running stack, before paying for
   any CI round-trip.
3. The heavy job — infrastructure, env plumbing, and the two gates it carries.
4. Falsification + documentation sync.

The job id `ci` is **kept** for the fast job rather than renamed. A job rename changes
the check name GitHub reports on a PR, which would silently detach any existing required
-check configuration.

## Critical Implementation Details

**`supabase status -o env` quoting.** The CLI emits shell-quoted assignments
(`ANON_KEY="eyJ…"`). GitHub's `$GITHUB_ENV` file parser treats everything after `=` as
the literal value, so piping that stream into it stores the surrounding quotes as part
of the key — producing a `SUPABASE_KEY` the Supabase client rejects, and a dev server
that 401s every request. Use `eval` inside a single step instead, and do all the env
plumbing there while the shell variables are in scope:

```bash
eval "$(supabase status -o env)"     # -> $API_URL, $ANON_KEY, $SERVICE_ROLE_KEY, $DB_URL
```

**`.dev.vars` is not optional and env vars are not a substitute.** Wrangler reads
`.dev.vars` first and consults `process.env` only when that file is **absent**; Astro
binds `astro:env/server` secrets once at worker init. Setting `SUPABASE_URL` /
`E2E_VISION_STUB_KEY` as step-level `env:` therefore fails *in the app's favour* — the
specs either 502 on a disarmed seam or hit the real provider. The file must be written
before the step that starts the dev server, and Playwright starts that server itself
(`webServer.command: "npm run dev"`, `reuseExistingServer: !IS_CI`).

**Two audiences, one value.** `E2E_VISION_STUB_KEY` must reach `.dev.vars` (server side,
where `vision.ts` reads it) **and** `process.env` (spec side, where
`photo-capture-mobile.spec.ts:81` and `photo-gallery-desktop.spec.ts:95` read it to send
the header). Generate once, write to both.

**Step ordering in the heavy job is load-bearing.** `supabase start` must precede
`supabase status`; the status eval must precede both the seed and the `.dev.vars` write;
`.dev.vars` must precede `npm run test:e2e` (which starts the server). `npm run test:db`
can sit anywhere after `supabase start` and is placed before the Playwright install so
the cheaper gate reports first.

---

## Phase 1: The `npm test` + typecheck gate

### Overview

Add the two gates that need no services to the existing job. This is §5's stated
first-and-highest-priority step: it closes the window in which a PR can disarm the vision
determinism seam with green CI.

### Changes Required:

#### 1. Fast job gains two steps

**File**: `.github/workflows/ci.yml`

**Intent**: Run `npm test` and `npm run typecheck` on every push and PR to `main`, so the
hermetic suite and `astro check` are enforced by CI rather than only by the skippable
husky hook.

**Contract**: The existing job keeps its id (`ci`) and its trigger block unchanged. Step
order becomes `npm ci` → `npx astro sync` → `npm test` → `npm run lint` →
`npm run typecheck` → `npm run build`. `npm test` is placed immediately after `astro sync`
because it is both the highest-priority gate and the fastest (~3s) — a seam-guard
regression should not wait behind lint. No `env:` block on the new steps: the suite is
hermetic (`test/setup/no-network.ts`, `test/stubs/astro-env-server.ts`) and adding
secrets would weaken that property. `npm run build` keeps its existing
`SUPABASE_URL`/`SUPABASE_KEY` secret env.

### Success Criteria:

#### Automated Verification:

- Workflow file parses: `npx --yes @action-validator/cli --verbose .github/workflows/ci.yml` (or equivalent YAML lint)
- The suite the gate runs is green locally: `npm test` (12 files / 238 tests)
- Typecheck is green locally: `npm run typecheck`
- Lint is green: `npm run lint`

#### Manual Verification:

- The `ci` job on a real PR shows `npm test` and `npm run typecheck` as executed steps, both green
- **Falsification:** disarm one lock of the vision seam in `src/lib/services/vision.ts`
  (e.g. make `stubbedVisionRead` return the canned read without comparing the request
  header to `E2E_VISION_STUB_KEY`), push, and confirm the `ci` job goes **red at the
  `npm test` step** — then revert the break. This is the exact scenario §5 names; a green
  run here would mean the gate does not defend it.
- Total `ci` job wall-clock is under ~3 minutes (it must stay the fast signal)

**Implementation Note**: Pause here for manual confirmation that the falsification was
observed and reverted before proceeding to Phase 2.

---

## Phase 2: E2E user seeding

### Overview

A committed, idempotent script that creates the confirmed `E2E_EMAIL`/`E2E_PASSWORD` user
in a local Supabase instance. The CI job calls it; a local developer can call it too.
Verified against a real running stack before any CI round-trip is paid for.

### Changes Required:

#### 1. Seed script

**File**: `scripts/seed-e2e-user.mjs`

**Intent**: Create (or confirm the existence of) the e2e account in a *local* Supabase
instance via GoTrue's admin API, so that `e2e/auth.setup.ts` can sign in through the real
`/api/auth/signin` route. Using the admin endpoint rather than a hand-rolled `auth.users`
insert means GoTrue authors every internal row (`identities`, `aud`, `role`), which is
what makes sign-in work rather than fail with an opaque schema error.

**Contract**: Node ESM, no dependencies (global `fetch`, Node 22). Reads four values from
`process.env`: `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `E2E_EMAIL`, `E2E_PASSWORD` — all
required, each missing one reported by name with a non-zero exit. Issues
`POST ${SUPABASE_URL}/auth/v1/admin/users` with headers `apikey` and
`Authorization: Bearer <service role>` and body `{ email, password, email_confirm: true }`.

Three behaviours the caller depends on:

- **Idempotent.** A 422 whose body carries an already-registered / `email_exists` code is
  a success (exit 0), so re-running against a warm stack — and CI re-runs on the same
  cached Docker volumes — is safe. Any other non-2xx exits non-zero with the response
  status and body.
- **Local-only guard.** Refuses to run unless the `SUPABASE_URL` host is `127.0.0.1` or
  `localhost`, unless `ALLOW_REMOTE_SEED=1` is set. The repo's standing rule is that the
  e2e account is never a production account (test-plan §7, `.env.example`); a script
  holding a service-role key should not be one typo away from breaking it.
- **Never logs the service-role key or the password**, including in error paths.

`email_confirm: true` is passed explicitly rather than relying on
`supabase/config.toml:209` (`enable_confirmations = false`), so the script keeps working
if that flag is ever flipped.

#### 2. npm script

**File**: `package.json`

**Intent**: Give the script a discoverable entry point shared by CI and local use.

**Contract**: Add `"seed:e2e-user": "node scripts/seed-e2e-user.mjs"` to `scripts`. No
dependency changes.

### Success Criteria:

#### Automated Verification:

- Lint passes on the new file: `npm run lint`
- Script runs green against a live local stack: `npx supabase start`, then
  `eval "$(npx supabase status -o env)"` and
  `SUPABASE_URL="$API_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" E2E_EMAIL=… E2E_PASSWORD=… npm run seed:e2e-user`
- Second consecutive run is also green (idempotence)
- Missing-variable path exits non-zero and names the variable: run it with `E2E_EMAIL` unset
- Remote guard trips: run it with `SUPABASE_URL=https://example.supabase.co` and confirm a non-zero exit without any HTTP request

#### Manual Verification:

- The seeded user can sign in through the app: `npm run test:e2e -- e2e/seed.spec.ts` passes against a stack seeded **only** by this script (delete or reset the local DB first, so no pre-existing hand-made account can mask a failure)
- Neither the service-role key nor the password appears anywhere in the script's output on success or on failure

**Implementation Note**: The reset-first check is the one that matters — running it
against your existing local stack, which already holds a manually created account, would
pass regardless of whether the script works.

---

## Phase 3: The heavy job — Supabase stack, db-policy gate, e2e gate

### Overview

A second, parallel job that stands up the local Supabase stack once and runs both gates
that need it: `npm run test:db` (Risk #5's only defense, currently enforced nowhere on a
PR) and `npm run test:e2e` (Risk #3).

### Changes Required:

#### 1. New `e2e` job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the pgTAP and Playwright suites against a real local Supabase instance on
every push and PR to `main`, in parallel with the `ci` job.

**Contract**: A new job `e2e` on `ubuntu-latest`, sharing the workflow's existing trigger
block. No `needs:` — it runs concurrently with `ci`. Steps, in this order:

1. `actions/checkout@v4`
2. `actions/setup-node@v4` (node 22, `cache: npm`) — mirrors the `ci` job
3. `npm ci`
4. `supabase/setup-cli@v1` — matching `migrate.yml`'s existing usage
5. `supabase start` — boots the stack and applies `supabase/migrations/**`, so the schema
   under test is the real one
6. **Env plumbing** (one step — see Critical Implementation Details for why it cannot be
   split): `eval "$(supabase status -o env)"`, generate the stub key, seed the user, write
   `.dev.vars`, export the spec-side values
7. `npm run test:db`
8. `npx playwright install --with-deps chromium`
9. `npm run test:e2e`
10. `actions/upload-artifact@v4` with `if: failure()`, uploading `playwright-report/` and
    `test-results/`

`E2E_EMAIL` / `E2E_PASSWORD` are **workflow literals**, not repository secrets — the
account exists only inside a container that is destroyed with the runner. The job
consumes **zero repository secrets**.

The env-plumbing step is the only non-obvious one:

```bash
eval "$(supabase status -o env)"          # $API_URL, $ANON_KEY, $SERVICE_ROLE_KEY
STUB_KEY="$(openssl rand -hex 32)"
echo "::add-mask::$STUB_KEY"

SUPABASE_URL="$API_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  E2E_EMAIL="$E2E_EMAIL" E2E_PASSWORD="$E2E_PASSWORD" \
  node scripts/seed-e2e-user.mjs

# Server side. These are the CONTAINER's keys, never the production repo secrets that
# `npm run build` uses — the specs create and delete rows in this database.
printf 'SUPABASE_URL=%s\nSUPABASE_KEY=%s\nE2E_VISION_STUB_KEY=%s\n' \
  "$API_URL" "$ANON_KEY" "$STUB_KEY" > .dev.vars

# Spec side: playwright.config.ts tolerates a missing `.env` and reads process.env.
{ echo "E2E_VISION_STUB_KEY=$STUB_KEY"; echo "E2E_EMAIL=$E2E_EMAIL"; echo "E2E_PASSWORD=$E2E_PASSWORD"; } >> "$GITHUB_ENV"
```

#### 2. Workflow header comment

**File**: `.github/workflows/ci.yml`

**Intent**: Record, at the top of the file, the two facts a future editor will otherwise
re-derive the hard way — that the e2e job's Supabase keys come from the container and not
from the repository secrets, and that `.dev.vars` cannot be replaced by step-level `env:`.

**Contract**: A comment block naming the gate each job owns, the zero-secrets property of
the `e2e` job, and a pointer to `context/foundation/test-plan.md` §5. Mirrors the
documenting-header convention already used in `migrate.yml` and `playwright.config.ts`.

### Success Criteria:

#### Automated Verification:

- Workflow file parses (same YAML lint as Phase 1)
- `npm run test:db` green locally against a running stack: 17 pgTAP assertions
- `npm run test:e2e` green locally: 3 specs
- The `e2e` job completes green on a real PR, with the `npm run test:db` and `npm run test:e2e` steps both showing as executed
- Playwright reports **3 specs run, 0 skipped** in the CI log — a run that matched zero specs is otherwise green

#### Manual Verification:

- The `ci` and `e2e` jobs start at the same time (parallel, not serialized)
- The `e2e` job's log shows the seam **armed**: the identify POST returns 200, not 502. A 502 there means `.dev.vars` was not read and the specs hit the real provider path
- Total `e2e` job wall-clock is under ~10 minutes
- A deliberately failed spec produces a downloadable `playwright-report` artifact
- No secret value (stub key, password) appears unmasked in the job log

**Implementation Note**: Expect at least one CI round-trip to get the env plumbing right;
the failure modes are quiet by design. Confirm the armed-seam signal before treating a
green run as meaningful.

---

## Phase 4: Falsification and documentation sync

### Overview

Prove each gate can fail, then make the documentation describe what CI actually enforces.
A green run proves the steps executed; only a watched red run proves they defend anything.

### Changes Required:

#### 1. Falsification pass

**File**: (no committed change — a sequence of temporary breaks on this phase's own branch)

**Intent**: Watch each of the three new gates go red against a deliberate break of the
behaviour it defends, then revert. Per `e2e/RULES.md`'s control question: *would this fail
if the risk actually came true?*

**Contract**: Three breaks, each pushed alone and reverted before the next:

| Gate | Break | Expected red step |
|---|---|---|
| `npm test` | Disarm one lock of the vision seam in `src/lib/services/vision.ts` (Phase 1's break; re-confirm it still reddens now that the workflow has two jobs) | `ci` → `npm test` |
| db policy | Widen one policy in a scratch edit of `library_entries_rls.test.sql`'s target — or drop the `user_id` predicate from a facet RPC — per the suite's own falsification table (`library_entries_rls.test.sql:57-78`) | `e2e` → `npm run test:db` |
| e2e | Comment out `window.location.assign("/library")` (`PhotoCapture.tsx:259-261`) — Risk #3 itself, already recorded as reddening `photo-capture-mobile.spec.ts`'s final row assertion | `e2e` → `npm run test:e2e` |

**Never commit a break.** The e2e break in particular is a production-code edit; confirm
`git status` is clean before the phase's final push.

#### 2. Test-plan sync

**File**: `context/foundation/test-plan.md`

**Intent**: Make the plan describe the gates that now exist, and retire the passages
written on the assumption they do not.

**Contract**: Four edits.

- **§3 Phase 5 row** — Status `change opened` → `complete`.
- **§5 gate table** — the `unit + integration` and `e2e on critical flows` rows change
  from "required after §3 Phase N" to wired-and-enforced, naming the job; `db policy (RLS)`
  changes from "**local only**" to local + CI; `lint + typecheck` updates to note typecheck
  is now genuinely in CI rather than only in the husky hook.
- **§5 prose** — the two paragraphs beginning "CI today (`.github/workflows/ci.yml`) runs
  lint + build only…" and "**The `npm test` gate's stakes rose in rollout Phase 4**…"
  describe a hole this phase closes. Replace with what CI now runs, and record that the
  seam-guard window is shut. The e2e-gate contract paragraph is **kept**, corrected on the
  one point it got wrong: `SUPABASE_URL`/`SUPABASE_KEY` come from the container, not from
  repository secrets, and `E2E_VISION_STUB_KEY` needs no secret at all.
- **§8 Freshness Ledger** — a new dated entry at the top of the strategy bullet list.

#### 3. Phase note

**File**: `context/foundation/test-plan.md` (§6.8)

**Intent**: Record what this phase taught, in the 2–3 bullet style of the four notes
above it.

**Contract**: A `**Phase 5 — Quality-gates wiring (<date>).**` block. The candidates worth
recording, each measured rather than assumed: the `.dev.vars`-beats-`process.env` trap and
why step-level `env:` fails in the app's favour; the `supabase status -o env` quoting trap
against `$GITHUB_ENV`; that the heavy job needs zero repository secrets (and why the
inherited §5 contract's "from repository secrets" was wrong); and the falsification results
from change #1.

#### 4. CLAUDE.md CI section

**File**: `CLAUDE.md`

**Intent**: Correct the two factual errors in its CI paragraph. It currently reads *"runs
lint + build on every push and PR to master"* — wrong on the gate list, and wrong on the
branch (the workflow targets `main`).

**Contract**: Rewrite that paragraph to name both jobs and what each enforces, the correct
branch, and the fact that the `e2e` job needs no repository secrets while `npm run build`
still needs `SUPABASE_URL` / `SUPABASE_KEY`.

### Success Criteria:

#### Automated Verification:

- Working tree is clean of every falsification break: `git status --porcelain` empty except the intended documentation edits
- Full local suite still green after the falsification pass: `npm test`, `npm run typecheck`, `npm run lint`
- Both CI jobs green on the phase's final push

#### Manual Verification:

- All three falsification breaks were **observed red in CI**, on the expected step, and each is recorded with its run link or date in the §6.8 phase note
- `test-plan.md` §5's gate table matches `.github/workflows/ci.yml` line by line — no gate claimed that is not wired, none wired that is not claimed
- `CLAUDE.md` names `main`, not `master`
- **Repo settings (outside this plan's files):** the new `e2e` check is marked required in GitHub branch protection, if branch protection is configured for `main`. Without it, a blocking job is still bypassable by merging past a red X

**Implementation Note**: The branch-protection item is a repo-settings action, not a file
change — it is listed here so it is not silently lost between the plan and reality.

---

## Testing Strategy

This phase authors no tests; its "tests" are the falsification runs. The distinction that
matters:

### What a green CI run proves

That each step executed and exited 0. It does **not** prove the step can fail — a
Playwright run matching zero specs, a `test:db` against a stack with no policies, or a
`npm test` whose suite silently collected nothing are all green.

### What the falsification pass proves

That each gate reddens on a real break of the behaviour it defends. Three breaks, one per
gate, each pushed alone (Phase 4, change #1). This mirrors the convention already
established at two other layers in this repo — the pgTAP suite's header table
(`library_entries_rls.test.sql:57-78`) and the e2e specs' header tables — applied here to
the gate layer.

### Manual verification steps

1. Push the phase branch; confirm `ci` and `e2e` start in parallel.
2. Confirm the `e2e` log shows the identify POST returning 200 (seam armed), not 502.
3. Confirm Playwright reports 3 specs run, 0 skipped.
4. Run the three breaks from Phase 4's table, one at a time; confirm the expected step
   reddens each time; revert each before the next.
5. Confirm `git status` clean before the final push.

## Performance Considerations

- The `ci` job must stay under ~3 minutes — it is the fast signal, and `npm test` at ~3s
  is placed early so a seam-guard regression reports almost immediately.
- The `e2e` job's floor is the Supabase cold start (~60–120s) plus the Playwright browser
  download (~30–60s). Running `npm run test:db` inside this job rather than in a third job
  is what makes the pgTAP gate nearly free: it reuses a stack that is already paid for.
- `workers: 1` in CI (`playwright.config.ts:41`) means the 3 specs run serially. Expected
  ~90s. Not worth parallelizing against a single shared `E2E_EMAIL` account.
- The npm cache is shared between jobs via `actions/setup-node`'s `cache: npm`, so the
  duplicated `npm ci` is the cost of parallelism — accepted deliberately.

## Migration Notes

- Existing open PRs will show two checks instead of one after this merges. Any PR whose
  branch predates the change will run the new gates against its own code — expect some to
  go red on pre-existing type debt surfaced by `npm run typecheck` reaching CI for the
  first time.
- Rollback is a single revert of `ci.yml`; nothing else in the repo depends on the new
  job. The seed script and its npm script are additive and harmless if left behind.

## References

- Rollout phase source: `context/foundation/test-plan.md` §3 Phase 5, §5 (gate contract), §6.3, §6.7
- Change identity: `context/changes/testing-quality-gates-wiring/change.md`
- E2E layer rules: `e2e/RULES.md` (the vision seam, the fake-media args, the control question)
- Prior phase, whose seam this gate protects: `context/archive/2026-07-27-testing-e2e-photo-flow/`
- Existing CI patterns in-repo: `.github/workflows/ci.yml`, `.github/workflows/migrate.yml` (`supabase/setup-cli@v1`)
- Supabase CI pattern + `status -o env` output shape: Context7 `/supabase/supabase`, checked: 2026-07-27

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The `npm test` + typecheck gate

#### Automated

- [x] 1.1 Workflow file parses (YAML lint) — cfb1f0a
- [x] 1.2 `npm test` green locally (12 files / 238 tests) — cfb1f0a
- [x] 1.3 `npm run typecheck` green locally — cfb1f0a
- [x] 1.4 `npm run lint` green — cfb1f0a

#### Manual

- [x] 1.5 `ci` job on a real PR shows both new steps executed and green — 735ed9d
- [x] 1.6 Falsification: disarmed vision seam reddens the `npm test` step; break reverted — 735ed9d
- [x] 1.7 `ci` job wall-clock under ~3 minutes — 735ed9d

### Phase 2: E2E user seeding

#### Automated

- [x] 2.1 `npm run lint` passes on `scripts/seed-e2e-user.mjs` — 809237a
- [x] 2.2 Script runs green against a live local stack — 809237a
- [x] 2.3 Second consecutive run green (idempotence) — 809237a
- [x] 2.4 Missing-variable path exits non-zero naming the variable — 809237a
- [x] 2.5 Remote guard trips on a non-local `SUPABASE_URL`, with no HTTP request — 809237a

#### Manual

- [x] 2.6 `e2e/seed.spec.ts` passes against a DB seeded only by this script (after a reset) — 809237a
- [x] 2.7 No service-role key or password in the script's output, success or failure — 809237a

### Phase 3: The heavy job — Supabase stack, db-policy gate, e2e gate

#### Automated

- [x] 3.1 Workflow file parses (YAML lint) — 099bb29
- [x] 3.2 `npm run test:db` green locally (17 pgTAP assertions) — 099bb29
- [x] 3.3 `npm run test:e2e` green locally (3 specs) — 099bb29
- [x] 3.4 `e2e` job green on a real PR, both gate steps executed — 74a99ec
- [x] 3.5 Playwright reports 3 specs run, 0 skipped — 74a99ec

#### Manual

- [x] 3.6 `ci` and `e2e` start in parallel — 74a99ec
- [x] 3.7 Identify POST returns 200 in the CI log (seam armed, not 502) — 74a99ec
- [x] 3.8 `e2e` job wall-clock under ~10 minutes — 74a99ec
- [ ] 3.9 Failed spec produces a downloadable `playwright-report` artifact
- [x] 3.10 No unmasked secret value in the job log — 74a99ec

### Phase 4: Falsification and documentation sync

#### Automated

- [x] 4.1 `git status --porcelain` clean of all falsification breaks
- [x] 4.2 `npm test`, `npm run typecheck`, `npm run lint` green after the falsification pass
- [ ] 4.3 Both CI jobs green on the final push

#### Manual

- [ ] 4.4 All three breaks observed red on the expected step, each recorded in the §6.8 note
- [ ] 4.5 `test-plan.md` §5 gate table matches `ci.yml` line by line
- [ ] 4.6 `CLAUDE.md` names `main`, not `master`
- [ ] 4.7 `e2e` marked as a required check in branch protection (repo settings)
