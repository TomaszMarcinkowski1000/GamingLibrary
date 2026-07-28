# Quality-Gates Wiring — Plan Brief

> Full plan: `context/changes/testing-quality-gates-wiring/plan.md`
> Rollout source: `context/foundation/test-plan.md` §3 Phase 5, §5

## What & Why

Rollout Phase 5 of the test plan: wire the four suites Phases 1–4 built into
`.github/workflows/ci.yml` as **enforced** gates. Today CI runs lint + build only, so
`npm test`, `astro check`, the pgTAP RLS suite, and the Playwright specs are all present
but unenforced on a PR. The sharpest consequence is named in §5: `src/lib/services/vision.test.ts`
is the only enforcement anywhere that the production vision-bypass seam stays fail-closed,
and nothing on a PR runs it — so a PR can disarm that seam with green CI.

## Starting Point

`ci.yml` is 25 lines, one job, four steps: `npm ci` → `astro sync` → `lint` → `build`
(with production Supabase secrets for the build). `npm test` and `npm run typecheck` run
only in the skippable husky pre-commit hook; `npm run test:db` and `npm run test:e2e` run
only when a developer remembers. `playwright.config.ts` is already CI-shaped — `forbidOnly`,
`retries: 2`, `workers: 1`, and an explicit `try/catch` noting that CI may inject
credentials as environment variables — so it needs no changes.

## Desired End State

Every PR to `main` runs two parallel blocking jobs: **`ci`** (~2 min, no Docker) carrying
`npm test` → lint → typecheck → build, and **`e2e`** (~6–8 min) standing up a local
Supabase stack, seeding the test user, and running the pgTAP and Playwright suites. Each
gate has been watched go red against a deliberate break of the behaviour it defends.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Job topology | Split: fast job + heavy job, parallel | The highest-priority gate reports in ~2 min instead of behind a Docker cold start, and an e2e infra flake can't hide a unit-test regression | Plan |
| Supabase in CI | `supabase/setup-cli@v1` + `supabase start` | Supabase's own documented CI pattern, applies real migrations, and `migrate.yml` already uses the action | Plan |
| db-policy gate | Wire now, in the e2e job | The Supabase cold start is already paid for e2e, so Risk #5's only defense costs seconds rather than a phase | Plan |
| Enforcement | All blocking, no soft-fail, no skip label | A gate that doesn't block isn't a gate — and an escape hatch is what a PR disarming the seam would reach for | Plan |
| E2E user seeding | Admin API via a shared `scripts/seed-e2e-user.mjs` | GoTrue authors every internal row, so sign-in can't fail on a hand-rolled `auth.users` record | Plan |
| `.dev.vars` | Written inline in CI from `supabase status -o env` | Keeps the local-vs-production boundary visible: e2e keys come from the container, never the prod repo secrets | Plan |
| `E2E_VISION_STUB_KEY` | Generated per run, not a repo secret | Local-only and single-run; a stored secret adds a setup step for no benefit | Plan |
| Extra gate | Add `npm run typecheck` to CI | §5 already lists it as required, but it lives only in the skippable husky hook | Plan |
| Verification | Falsify each gate on this phase's own PR | A green run proves the step executed, not that it can fail | Plan |

## Scope

**In scope:** `npm test` + typecheck in the fast job; a seed script + npm script; a new
`e2e` job (Supabase stack, env plumbing, `npm run test:db`, `npm run test:e2e`, artifacts
on failure); a three-break falsification pass; sync of test-plan §3/§5/§6.8/§8 and
CLAUDE.md's CI paragraph.

**Out of scope:** any new test; any production code change — *held for `src/`, but one schema
exception was taken in Phase 3 and is recorded in the plan's "What We're NOT Doing" and in
test-plan §7*; `playwright.config.ts` changes;
a `concurrency` group and a browser cache (both declined); `continue-on-error` or a skip
label; `.env.example` / `e2e/RULES.md` rewrites; CI troubleshooting prose; Stryker in CI;
branch-protection settings (flagged as a manual criterion, not a file change).

## Architecture / Approach

```
PR to main
├── job `ci`   (no Docker, ~2 min)   npm ci → astro sync → npm test → lint → typecheck → build
└── job `e2e`  (~6-8 min)            npm ci → setup-cli → supabase start
                                     → eval status | seed user | write .dev.vars + $GITHUB_ENV
                                     → npm run test:db → playwright install → npm run test:e2e
                                     → upload report if failure
```

The env-plumbing step is the phase's one genuinely tricky piece: wrangler reads `.dev.vars`
before `process.env` and Astro binds secrets once at worker init, so step-level `env:` fails
*in the app's favour* — the specs silently hit the real provider instead of the seam.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. `npm test` + typecheck gate | The seam-guard hole closed, no services needed | Typecheck reaching CI for the first time may surface pre-existing type debt |
| 2. E2E user seeding | `scripts/seed-e2e-user.mjs`, idempotent, local-guarded | Verifying against an already-seeded local stack would pass regardless — reset first |
| 3. The heavy job | Supabase stack + both service-dependent gates | Env plumbing fails quietly; a mis-read `.dev.vars` shows up as a 502, or worse, as green |
| 4. Falsification + docs | Proof each gate can fail; test-plan and CLAUDE.md truthful | A break accidentally committed — `git status` clean is an explicit criterion |

**Prerequisites:** Docker + `npx supabase start` locally; write access to push branches and
open a PR (the falsification pass needs real CI runs); GitHub repo-settings access if branch
protection is configured.
**Estimated effort:** ~1–2 sessions. Phases 1–2 are quick; Phase 3 should be budgeted for at
least one CI round-trip to get the env plumbing right, and Phase 4 needs three separate
push-and-watch cycles at ~8 minutes each.

## Open Risks & Assumptions

- **One inherited fact was wrong and is corrected here.** `change.md` (from test-plan §5)
  says CI should write `.dev.vars` "from repository secrets, carrying `SUPABASE_URL`,
  `SUPABASE_KEY`, `E2E_VISION_STUB_KEY`." Those secrets point at production, and the specs
  create and delete rows. They must come from the container instead — which is also why the
  `e2e` job ends up needing **zero** repository secrets.
- `supabase status -o env` emits shell-quoted values; piping them into `$GITHUB_ENV` stores
  the quotes and produces a key the client rejects. Handled with `eval` in a single step.
- Assumes GitHub-hosted `ubuntu-latest` runners keep providing a usable Docker daemon for
  `supabase start`, and that a ~60–120s cold start stays acceptable per PR.
- Assumes no branch protection currently references the job name `ci` — the job id is kept
  unchanged to avoid detaching a required check either way.
- The `e2e` job has never run outside a developer machine. Deliberately shipped blocking
  from day one anyway; the falsification pass is what earns that confidence.

## Success Criteria (Summary)

- A PR that breaks the vision seam guard, an RLS policy, or the photo journey **cannot merge
  green** — each verified by a watched red run, not inferred.
- `test-plan.md` §5's gate table and `CLAUDE.md`'s CI paragraph describe what CI actually
  enforces, line for line.
- The fast signal stays fast: `ci` under ~3 minutes, `e2e` under ~10.
