---
date: 2026-09-07T20:32:45+02:00
researcher: Tomasz Marcinkowski
git_commit: 04227c04731f2f8924c0ae12eec4788a1956227f
branch: main
repository: GamingLibrary
topic: "Agentic code review in CI — GHA workflow around packages/code-reviewer, against the acceptance criteria in requirements.md"
tags: [research, codebase, ci-cd, github-actions, code-reviewer, security, testing]
status: complete
last_updated: 2026-09-07
last_updated_by: Tomasz Marcinkowski
---

# Research: agentic code review in CI

**Date**: 2026-09-07T20:32:45+02:00
**Researcher**: Tomasz Marcinkowski
**Git Commit**: `04227c04731f2f8924c0ae12eec4788a1956227f`
**Branch**: `main`
**Repository**: GamingLibrary (private)

> **Permalink base**: `https://github.com/TomaszMarcinkowski1000/GamingLibrary/blob/04227c04731f2f8924c0ae12eec4788a1956227f/<path>#L<line>`.
> Every `path:line` below resolves against that base — with one exception:
> `context/changes/ci-cd-code-review/` is **untracked** at this commit, so `requirements.md`
> and this file have no permalink yet.

## Research Question

Research the `ci-cd-code-review` change against the acceptance criteria in
`context/changes/ci-cd-code-review/requirements.md`: a GitHub Actions workflow that runs an
agentic code review on every PR to `main`, built on `packages/code-reviewer`, scoring five
named criteria 1–10, posting a summary comment, and applying `ai-cr:passed` / `ai-cr:failed`
labels with an `ai-cr:retry` re-run path.

Scope agreed before research (via clarification): **workflow *and* package changes** are in
scope; the fork/secret question gets a **full threat model**; prior art covers **both**
in-repo and external.

## Summary

Six findings, in the order they should change the plan.

1. **The package cannot express the required output.** `reviewSchema` is
   `{ summary, findings[] }` (`packages/code-reviewer/src/schemas/review.ts:4-9`). There is no
   per-criterion score, no verdict, no criterion identity anywhere. The five-criterion 1–10
   rubric and the pass/fail label are not a prompt change — they are a schema change that
   ripples through `Output.object` (`src/agent/create-agent.ts:83`), the README, and `dist/`.

2. **The package cannot receive the required input either.** `buildReviewPrompt`
   (`src/prompts/review-request.ts:14-26`) accepts `paths` + free-text `context`. There is no
   carrier for a PR title, a PR body, or a diff, and the agent has **no git and no shell tool**
   — `src/tools/index.ts:23-31` wires only `read_file`, `list_files`, `search_code`. The
   archived plan anticipated exactly this: *"Assumes reviews run against an on-disk checkout.
   A caller holding a diff in memory (a PR from an API) would need to write it out or get a
   second entry point later."* (`context/archive/2026-09-02-tool-loop-agent/plan-brief.md:91-92`).

3. **Criterion 1 is scorable here only because this repo already writes falsification evidence
   in-band.** The requirement asks for "evidence that it does [go red]". That evidence exists as
   a *convention*: a falsification log in the test file's own header
   (`src/lib/services/vision.test.ts:3-14`), in the pgTAP file
   (`supabase/tests/database/library_entries_rls.test.sql:70-85`), and as three rows with real CI
   run IDs in `context/foundation/test-plan.md:189-191`. **The rubric must name that convention
   explicitly**, or the model will have no idea what "evidence" is supposed to look like and will
   either invent a standard or score everything a 5.

4. **Two of the criterion-4 conventions are not honoured by the codebase itself.**
   `export const prerender = false` appears in 4 of 8 API route files, and
   `src/components/hooks/` **contains no files at all**. Scoring a PR against either would
   produce findings stricter than the existing baseline — false positives on the reviewer's
   very first run. Criterion 4's convention list needs pruning against reality before it ships.

5. **The verdict cannot block anything, today.** Verified live: the repo is **private** and
   `GET /branches/main/protection` returns **403 — "Upgrade to GitHub Pro or make this
   repository public to enable this feature."** So `ai-cr:failed` is advisory pressure, not a
   gate, no matter what the threshold is. This changes the open threshold question from "what
   fails a PR" to "what does a failing label *mean* when nothing enforces it" — and it caps the
   blast radius of a prompt-injected forged verdict.

6. **The trigger question is settled by the repo being private.** Plain `pull_request` gets full
   secrets and full write scope for same-repo branches; there are no forks and no anonymous PR
   surface. `pull_request_target` should be avoided *permanently* — its entire purpose is keeping
   untrusted content away from secrets, and untrusted content is precisely this job's input. The
   `workflow_run` two-stage pattern is the migration path if the repo ever goes public, not
   work to do now.

Underneath all six: **`packages/code-reviewer` has zero tests of its own**, deliberately
(`context/archive/2026-09-02-tool-loop-agent/plan.md:90`). A reviewer whose hard blocker is
test falsifiability, shipping with no falsifiable tests, is a tension worth naming out loud
rather than discovering in the first review it runs on itself.

---

## Detailed Findings

### 1. `packages/code-reviewer` — what it gives, what is missing

**Given for free**

- `reviewCode({ model, rootDir, paths, context?, stopWhen?, stepBudget? })` →
  `Promise<Review>` (`src/agent/review-code.ts:32-81`) — the intended integration point.
- `createReviewAgent()` (`src/agent/create-agent.ts:66-97`) — the lower-level factory a caller
  needs if it wants to build its own prompt (title + body + diff), because `reviewCode`
  hard-wires `buildReviewPrompt`.
- `loadConfig()` (`src/config.ts:35-47`) + `createModel()` (`src/model.ts:10-18`) — OpenRouter
  wiring. `loadConfig` reads `process.env` and only opportunistically touches `.env`
  (`src/config.ts:9-13`), so **CI should pass `OPENROUTER_API_KEY` as step `env:` and never
  write a `.env` file** (see §4 for why the file matters beyond convenience).
- Read-only tools confined to `rootDir` by `createPathGuard` (`src/tools/paths.ts:79-108`),
  which resolves symlinks and compares on path-segment boundaries (`paths.ts:58-69`). No write,
  edit, or shell tool exists.
- `ReviewError` with `"no-output-generated" | "step-budget-exhausted"` (`src/errors.ts:6-22`) —
  already CI-shaped; a workflow can branch on `.code`.
- The `packages` matrix job in `.github/workflows/ci.yml:75-94` already does
  `npm ci` → `typecheck` → `build` for this package with the right
  `working-directory` / `cache-dependency-path` shape. Reuse it verbatim.

**Missing, each tied to a requirement**

| requirements.md asks for | Blocked by | Cheapest seam |
|---|---|---|
| 5 criteria × 1–10 + verdict | `reviewSchema` is `{summary, findings[]}` (`src/schemas/review.ts:4-9`); `findingSchema` has only a 4-value `severity` enum (`src/schemas/finding.ts:5-12`) | Extend `reviewSchema` with `criteria[]` + `verdict`; `Output.object` picks it up by import (`create-agent.ts:83`), `dist/` is generated |
| PR title, description, diff as inputs | `ReviewPromptInput` is `{paths, context?}` (`src/prompts/review-request.ts:1-6`) | `buildReviewPrompt` already joins an array of optional sections (`review-request.ts:20-25`) — adding sections is additive |
| The five criteria as standing rubric | `REVIEW_INSTRUCTIONS` (`src/prompts/instructions.ts`) is generic; nothing populates `extraInstructions` | `extraInstructions` (`create-agent.ts:45,81`) is documented as exactly this carrier: *"Appended to the standing instructions — a project checklist, say"* |
| Diff awareness | No git tool; tools read whole files off disk (`src/tools/index.ts:23-31`) | Pass the diff as prompt text; leave `read_file`/`search_code` pointed at the full checkout |

**Build and packaging reality**

- `packages/code-reviewer/.gitignore:1-3` ignores `node_modules/`, `dist/`, `.env`; `git ls-files`
  returns nothing under either directory. **A workflow cannot assume a prebuilt `dist/`** — it
  must `npm ci && npm run build` (or run `.ts` under `tsx`).
- `src/cli.ts:27-30` states plainly that the CLI is a smoke test: *"Real integrations should
  import `reviewCode` rather than shell out to this."* The composite action needs its own small
  entry script, not a `npm start` wrapper.
- `skills-lock.json` pins the `ai-sdk` skill from `vercel/ai` by content hash — dev tooling for
  whoever edits the package, not a runtime seam.

**Step budget vs. a whole PR.** `DEFAULT_STEP_BUDGET = 20` (`create-agent.ts:16`) was raised
from 10 after a **single-file** smoke test drew nine tool calls (`create-agent.ts:14`,
`README.md:77-78`). Nothing validates it against a multi-file diff with five criteria to score.
`README.md:84-87` additionally warns that `claude-haiku-4.5` *"often kept calling tools until
the budget ran out, or returned an empty object"* — so the CI model choice is not a free
cost lever.

### 2. Sizing: what a real PR looks like here

Last 12 merged PRs (`git log --merges`, with `--shortstat`):

| Metric | Value |
|---|---|
| Files changed | avg **19.4**, range 7–35 |
| Insertions | avg **~2069**, median ~1500, max 6323 (PR #14) |
| Deletions | avg ~413, max 2851 |

Shape matters more than size: **most PRs carry `context/changes/<id>/*.md` planning prose
alongside the code**, often the majority of the inserted lines — PR #33 is `context/` (5 files)
+ `.github/` + `package.json` + `supabase/`; PR #36 is 28 of 35 files under `packages/`.
A whole-PR diff fits a context window comfortably; what it does *not* fit is a 20-step budget
if the agent tries to `read_file` everything. **The path list handed to the reviewer should be
the code subset of the diff, not the diff's full file list.**

### 3. The five criteria — real anchors, and what CI already covers

The governing split, from `requirements.md:19-25`: the reviewer scores *only* what the `ci` and
`e2e` jobs structurally cannot see. Applied criterion by criterion:

**Criterion 1 — test falsifiability (hard blocker).** The seam requirements.md names is
`stubbedVisionRead` (`src/lib/services/vision.ts:122-153`), and the "two independent locks" are
concrete: **lock 1** is `if (!serverKey) return null` (`vision.ts:129-130`) — the server must
have armed `E2E_VISION_STUB_KEY` via `astro:env/server`; **lock 2** is the constant-time header
comparison (`vision.ts:132-134`, helper at `vision.ts:103-112`). The **unit guard proving the
default state is dead** is structural rather than a single test: `vitest.config.ts:19` aliases
`astro:env/server` to a stub that leaves `E2E_VISION_STUB_KEY` **`undefined`**
(`test/stubs/astro-env-server.ts:25`), so the *entire* suite runs with lock 1 disarmed;
`vision.test.ts:41-51` is the case its own comment calls *"THE production-safety assertion."*
`identify.ts:145` is the only production call site.

The falsification proof already exists — `test-plan.md:189-191`, three deliberate breaks pushed
and reverted on PR #33, each with a CI run id: disarming lock 2 reddened 2/10 cases in
`ci`→`npm test` (run `30310144683`); widening the SELECT policy to `using (true)` reddened
3/18 pgTAP tests (run `30310648892`); removing `PhotoCapture`'s post-close redirect reddened both
photo specs (run `30310883911`).

CI enforces that the guard test *passes*. CI cannot see whether a **new** bypass introduced by a
diff has two locks or one, whether a test's glob matches zero files, or whether an assertion was
swallowed — all of which stay green. That gap is exactly the criterion.

**Criterion 2 — assertion oracle.** The repo already practises the discipline and says so
in-band: `identify.test.ts:15-19` (*"The oracle is FR-006/US-01 … NOT any value copied out of
`identify.ts`"*); `library_entries_rls.test.sql:172-173` (claim stated in the PRD's terms,
`prd.md:171`); the recommender oracle table (`test-plan.md:506-517`) where the 10h bucket edge
is spec-backed (FR-016, `prd.md:160`) but the 30h/60h edges are **labelled
documentation-of-behaviour** because FR-016 is ambiguous there; and the *de-prioritized* vs
*excluded* case (`recommendation.ts:92` vs `prd.md:83,180`) where the test asserts **rank, not
absence**, precisely to avoid mirroring stricter code. That last one is requirements.md's own
"1" example, already solved correctly in the codebase — it is the best few-shot example available
for the rubric.

Not scorable from a diff alone, as `requirements.md:128-129` already concedes: the oracle is a
citation to `prd.md:<line>` or a migration, which is outside the changed lines.

**Criterion 3 — layer.** Layers that exist: Vitest **15 tracked test files** (~3s, hermetic —
`test/setup/no-network.ts` denies unrouted fetch), pgTAP **1 suite / 18 assertions**
(`supabase/tests/database/library_entries_rls.test.sql:116`), Playwright **3 specs** (Chromium
only; mobile is `test.use({...devices["Pixel 5"]})` per-spec, not a second project —
`playwright.config.ts:59-61`), plus non-gating Stryker.

⚠️ **`test-plan.md:122` says "12 test files / 238 tests" and is stale** — the count is now 15.
Any rubric that quotes test-plan counts as current truth will be wrong.

`e2e/RULES.md` is the scoring source for this criterion: role/label/text locators first, never
CSS/XPath (`RULES.md:9-11`); never `waitForTimeout` (`RULES.md:14-15`); auth never through the UI
(`RULES.md:24-25`); Supabase/middleware/routing/DB always real, only external providers mocked and
only server-side at the network edge (`RULES.md:70-80`); and the bar a risk must clear to earn a
spec (`RULES.md:52-69`). The repo has a caught instance of the "blind layer" anti-pattern:
Risk #5's original plan called for a stubbed-route isolation test and research inverted it —
*"a stubbed-Supabase route test proves nothing about isolation … reads as coverage"*
(`test-plan.md:87`).

Partially scorable from a diff. Whether a new test sits at the right layer is visible; whether it
is **redundant** with an existing layer is not — e.g. the e2e suite deliberately asserts zero
title/`igdb_id`/`metadata_status` values because the integration suite *"owns the identify seam at
37 assertions"* (`test-plan.md:357-358`). That fact is in no diff.

**Criterion 4 — stack conventions.** Verified against `eslint.config.js` (full read):
**none** of the CLAUDE.md conventions has a dedicated lint rule. The enforcement picture:

| Convention | Enforced by CI? | Diff-scorable? | Note |
|---|---|---|---|
| `cn()` from `@/lib/utils` | No | Yes | 56 call sites / 16 files |
| zod at API boundaries | No | Yes | `signout.ts` has no body — a non-example, not a violation |
| `export const prerender = false` | No | Yes | ⚠️ **present in only 4 of 8 route files**; `astro.config.mjs:30` already sets `output: "server"`, so the line is defensive. Scoring it penalises PRs for matching the existing baseline |
| RLS + per-op/per-role policies | No (only the one existing table is pgTAP-covered) | Yes | Canonical: `20260606150950_create_library_entries.sql:30-44` |
| Migration filename format | No | Yes | All 5 files conform |
| `astro:env/server` for secrets | Partial — typecheck catches undeclared secrets | Yes | Schema at `astro.config.mjs:51-67` |
| `cloudflare:workers` env, not `locals.runtime.env` | **Effectively yes** — the removed API fails typecheck | — | `lessons.md:5-10`. Do not spend a criterion on what `astro check` already kills |
| `@/` alias | No | Yes | Both forms compile |
| hooks in `src/components/hooks/` | No | Yes | ⚠️ **the directory contains no files** — an aspirational convention with no precedent to cite |
| shared types in `src/types.ts` | No | Yes | 235 lines |
| deploy via `scripts/deploy-worker.mjs` | No | **No** | It is a Cloudflare dashboard setting, not a file. Not diff-scorable at all |

**Criterion 5 — security and isolation.** One application table: `public.library_entries`, RLS
on at `20260606150950_create_library_entries.sql:30`, four granular per-operation policies
`to authenticated` at lines 34-44. A **second wall** in the grants layer:
`20260727220000_grant_library_entries_privileges.sql:42-43` grants `anon` only `select` —
deliberately, so pgTAP can assert "anon sees no rows" rather than getting a permission error that
would *mask* a policy widened `to anon`.

The pgTAP file carries its own falsification table (`library_entries_rls.test.sql:70-85`) mapping
break → red tests: SELECT widened to `using (true)` → tests 2, 9, 10; a policy added `to anon` →
tests 17, 18. **A reviewer can match a proposed migration diff against that table and treat "a
widening diff with no corresponding pgTAP change" as the finding.** Test 8 (line 194, the
unfiltered write) is the only assertion catching "UPDATE policy widened alone". Group (a),
lines 147-164, is the positive control — without it, 9/18 assertions stay green under a NULL
`auth.uid()` (`library_entries_rls.test.sql:16-19, 87-95`).

Known limits, documented in-file (`library_entries_rls.test.sql:55-64`): a `SUPABASE_KEY` swapped
for the service-role key bypasses RLS invisibly, and a `security invoker`→`definer` flip on the
facet RPCs is only half-caught.

**A live example of a criterion-5 "1" already in the tree**: `vision.ts:191-197` is the clean
pattern (logs the upstream body server-side, throws status-only), but the `identify.ts` GET path
returns a caught `error.message` **verbatim** in its 502 — a known, documented, unfixed leak
surface (`test-plan.md:773-779`). Useful as a calibration case; also worth deciding whether the
reviewer should flag pre-existing leaks it happens to read, or only new ones.

### 4. Workflow mechanics and the threat model

**House style the new workflow must match** (all from `.github/workflows/ci.yml`):
explicit `permissions:` naming only what is used, with the rationale *"Without this the jobs
inherit the repository/org default, which on older repos is read/write-all"* (`ci.yml:38-42`);
`timeout-minutes` on every job sized to ~2–3× measured runtime (`ci.yml:49,101`); third-party
actions **pinned to a commit SHA** with the tag in a comment, because *"`@v1` is a MUTABLE tag —
it moves, and whoever moves it runs code in this job"* (`ci.yml:115-124`); and long header
comments explaining the non-obvious. Note `migrate.yml` has **no `permissions:` block** and uses
the mutable `supabase/setup-cli@v1` — copy `ci.yml`, not `migrate.yml`.

Two masking facts already written down and directly relevant: `::add-mask::` **only takes effect
from the moment it runs** (`ci.yml:154-179`), and it **redacts log output only — it does not
touch uploaded files** (`ci.yml:23-30`). The `e2e` job gets away with an unmasked password in a
Playwright trace artifact solely because that password dies with the container. `OPENROUTER_API_KEY`
is a durable secret, so **no debug artifact from a review job may capture the agent's raw trace
without that being thought through.**

**Trigger decision** — verified live: repo is `PRIVATE`, `isFork: false`.

| Trigger | Secrets | Can comment/label | Fork-safe | Verdict |
|---|---|---|---|---|
| `pull_request`, same-repo branch | Full | Yes | n/a | ✅ **Recommended** — the repo's actual situation |
| `pull_request`, fork PR | None; `GITHUB_TOKEN` downgraded to read-only | No | Yes (by design) | Not reachable today |
| `pull_request_target` | Full, even from forks | Yes | **No** if it checks out PR head | ❌ Avoid permanently — its purpose is keeping untrusted input away from secrets, and untrusted input is this job's input |
| `workflow_run` two-stage | Full, safely | Yes | Yes | Migration path if the repo goes public |

Shape: one workflow, `types: [opened, synchronize, reopened, labeled]`, gated by
`if: github.event.action != 'labeled' || github.event.label.name == 'ai-cr:retry'`, with the
retry label removed after consumption so it is one-shot.
`concurrency: { group: ai-code-review-${{ github.event.pull_request.number }}, cancel-in-progress: true }`
keyed on PR number (stable across force-pushes).

Permissions: **`issues: write` is the scope that actually governs both PR comments and labels** —
a PR *is* an issue in GitHub's data model, and both go through
`POST /repos/{o}/{r}/issues/{n}/{comments,labels}`. `pull-requests: write` governs the Pulls API
proper (reviews, merges, reviewers). Granting both plus `contents: read` is the low-cost choice.

Diff retrieval — three options, one clear winner:

| Method | Ceiling | Verdict |
|---|---|---|
| `git diff <base.sha> <head.sha>` after checkout | None (runner-bound) | ✅ Uses exact SHAs from the event payload, so it survives a mid-run force-push. The job needs a checkout anyway to build the package and give the agent a `rootDir`, so this is free |
| REST `Accept: application/vnd.github.diff` | 20,000 lines / 1 MB, **hard 406** past it | Fails closed with nothing, not a truncation |
| `gh pr diff` | Same API ceiling | Same 406 risk |

Composite action gotchas (first one in this repo — `.github/actions/` does not exist):
`shell:` is **mandatory on every `run:` step**; secrets are **not** ambiently inherited and must
be passed as explicit `with:` inputs then re-exposed via that step's `env:`; a composite step
reads inputs through the `inputs.<name>` expression, not `INPUT_*` env vars; and `outputs:` must
be wired explicitly to a step's `$GITHUB_OUTPUT` via `value: ${{ steps.x.outputs.y }}`.

**Threat model, ranked**

1. **Script injection via PR title/body.** `${{ github.event.pull_request.title }}` interpolated
   into a `run:` block is the canonical GHA vulnerability, and titles are attacker-controlled even
   from collaborators. **Mitigation**: route through `env:` indirection, read as `$PR_TITLE`,
   never re-expanded by the templating engine. Cost: nil.
2. **Prompt injection forging a verdict.** Title, body, and diff all become model input and the
   model's output drives the label. **What is actually at risk**: the agent has no write tools, so
   the damage ceiling is (a) a forged verdict and (b) reading files inside `rootDir`. Crucially —
   `src/tools/search-code.ts:24-26` states its skip-list is *"a cost measure, not a security
   boundary"*, and neither tool is gitignore-aware. **If `.env` or `.dev.vars` exists on disk under
   `rootDir`, `read_file` can read it and a prompt-injected model could exfiltrate it into a
   finding's `detail`, which the workflow then posts as a PR comment.** Mitigation: never write
   `.env`/`.dev.vars` in the review job (a plain checkout has neither — both gitignored), and say
   so in the action's header comment so nobody adds such a step later. Impact is further capped
   by finding 5 of the Summary: no branch protection, so a forged pass gates nothing.
3. **Cost/abuse.** Every `opened`/`synchronize` costs a model call; the retry label multiplies it.
   Bounded here by collaborator-only access. Mitigations: `concurrency` + `cancel-in-progress`,
   `timeout-minutes`, an explicit `stepBudget` rather than the library default, and — from
   OpenRouter's own guidance — a **`max_price`** per-request cap plus a spend cap on a
   **dedicated CI key**, with `GET /api/v1/key` exposing `usage` / `limit_remaining` for tracking.
4. **`GITHUB_TOKEN` over-scoping.** The same supply-chain surface `ci.yml:38-42` already worries
   about: the composite action's `npm ci` runs with whatever scope the job grants.

### 5. Prior art

**Do not rebuild** — `C:\Users\lordt\.claude\skills\10x-impl-review-ci\` has already solved the
mechanics half of this: a workflow skeleton (`references/workflow-template.yml`) with
`permissions: {}` at top plus per-job elevation, a concurrency group, a fork-exclusion guard
(`if: head.repo.full_name == github.repository`), `labeled`/`unlabeled` trigger types, a
bot-commit recursion guard, an override label, marker-based comment dedup implemented in pure
`gh api --jq` (no third-party action needed), inline-comment-position validation against
`git diff --unified=0` hunks, and a manual `POST /statuses/:sha` to attach a check.

**But it is a donor of mechanics, not the engine.** It scores **plan drift** and needs a
`context/changes/<id>/plan.md` in the PR — which `requirements.md:27-33` explicitly demotes to
advisory, and which most PRs here will not have. Its verdict is `grep`-scraped from markdown
prose, not a schema. `packages/code-reviewer`'s zod-validated `ToolLoopAgent` is the better fit
for "1–10 per criterion, machine-checkable".

Its rubric, worth positioning the new five against — 6–7 dimensions, each PASS/WARNING/FAIL,
rolling into APPROVED / NEEDS ATTENTION / REJECTED: **Plan Adherence, Scope Discipline, Safety &
Quality, Architecture, Pattern Consistency, Test Coverage** (CI variant only), **Success
Criteria**. Findings carry Severity (CRITICAL/WARNING/OBSERVATION) × Impact (LOW/MEDIUM/HIGH) as
**orthogonal** axes — "how bad" vs "how hard to decide". That orthogonality is the one idea worth
importing; the new rubric's flat 1–10 conflates them.

⚠️ **`requirements.md:108` cites "the generic axes from the template — implementation correctness,
complexity, documentation".** Those three words could not be traced to any file in
`~/.claude/skills/*` or in this repo. It is most likely a rubric named verbally in the
2026-09-07 conversation. Do not quote it as if it were a citable artifact.

**External.** `anthropics/claude-code-action` is a general-purpose agent runner — its
"checklist review" pattern puts the rubric in prose and the score in prose too; labels are done
by shelling out to `gh issue edit`, with no first-class output. It is a **complement (a harness),
not a substitute** for schema-validated scores. Sticky-comment actions
(`marocchino/sticky-pull-request-comment`, `peter-evans/create-or-update-comment`) exist but
duplicate what `gh api --jq` already does in ~5 lines, and each would need SHA-pinning under this
repo's own policy. AI SDK 7 has no dedicated "agent in CI" doc; `maxOutputTokens` is the per-call
cap and telemetry is opt-in.

## Code References

- `packages/code-reviewer/src/schemas/review.ts:4-9` — `{summary, findings[]}`; the schema gap
- `packages/code-reviewer/src/schemas/finding.ts:5-12` — severity enum, no score
- `packages/code-reviewer/src/prompts/review-request.ts:14-26` — prompt composition; no diff carrier
- `packages/code-reviewer/src/prompts/instructions.ts` — `REVIEW_INSTRUCTIONS`, generic
- `packages/code-reviewer/src/agent/create-agent.ts:16,45,66-97` — budget, `extraInstructions`, factory
- `packages/code-reviewer/src/agent/review-code.ts:32-81` — the integration point + `ReviewError` mapping
- `packages/code-reviewer/src/tools/paths.ts:58-69,79-108` — containment guard
- `packages/code-reviewer/src/tools/search-code.ts:24-26` — *"a cost measure, not a security boundary"*
- `packages/code-reviewer/src/config.ts:9-13,35-47` — env loading; `.env` fallback
- `packages/code-reviewer/src/cli.ts:27-30` — "real integrations should import `reviewCode`"
- `.github/workflows/ci.yml:23-30,38-42,49,75-94,115-124,154-179` — masking limits, permissions, timeouts, the `packages` job, SHA-pinning, secret generation
- `src/lib/services/vision.ts:103-112,122-153,191-197` — the two locks; the clean error pattern
- `src/lib/services/vision.test.ts:3-14,41-51` — falsification log convention; the production-safety assertion
- `vitest.config.ts:19` + `test/stubs/astro-env-server.ts:25` — the suite-wide default-dead guard
- `supabase/tests/database/library_entries_rls.test.sql:16-19,55-64,70-85,116,147-164,194` — positive control, documented limits, falsification table, the unfiltered-write test
- `supabase/migrations/20260606150950_create_library_entries.sql:30-44` — RLS + 4 granular policies
- `supabase/migrations/20260727220000_grant_library_entries_privileges.sql:42-43` — the grants wall
- `context/foundation/test-plan.md:57-64,87,122,157-173,189-191,357-358,506-528,773-779` — risk map, layer guidance, stale counts, gates, falsification rows, oracle table, the known leak
- `context/foundation/lessons.md:5-10` — `cloudflare:workers` over `locals.runtime.env`
- `e2e/RULES.md:9-25,52-95,138-146` — locators, isolation, the bar for an e2e, verification discipline
- `context/archive/2026-09-02-tool-loop-agent/plan.md:90-98`, `plan-brief.md:50-53,85-92` — the deliberate exclusions

## Architecture Insights

- **Falsification evidence is written in-band in this repo.** Test-file headers and the pgTAP file
  carry break → red-test tables. That is an unusual, load-bearing convention and it is what makes
  criterion 1 mechanisable at all.
- **Two independent walls is a recurring pattern**, not a one-off: the vision seam has two locks;
  isolation has RLS *and* the grants layer; the pgTAP suite has a positive control before it trusts
  any negative assertion. Criterion 5's "reduced from two independent locks to one" is the
  generalisation of a pattern already in the tree.
- **CI enforces syntax and types; nothing enforces pattern.** `eslint.config.js` carries no
  repo-specific rule for any CLAUDE.md convention. This validates requirements.md's framing — but
  it also means criterion 4 is *entirely* judgement, with no mechanical baseline to appeal to,
  which is where its false-positive risk comes from.
- **The package was deliberately built to be CI-*shaped* but not CI-*wired*.** Every gap found
  here was an explicit exclusion, written down at the time. That is a good sign for the plan: the
  seams are where the design record says they are.

## Historical Context (from prior changes)

- `context/archive/2026-09-02-tool-loop-agent/plan.md:90` — *"Not adding a test runner, test
  script, or any tests (decision: typecheck + lint only)."*
- `plan.md:91,98` — *"Not adding git tools (getDiff, getChangedFiles) or any CI/PR wiring…
  Not adding the package to root npm workspaces, root vitest, or CI."*
- `plan-brief.md:50-53` — out of scope: the eval environment, tests, git/diff tools, CI wiring,
  write/edit/shell tools, telemetry and cost accounting.
- `plan-brief.md:85-87` — open risk: *"The path guard ships unverified by machine."*
- `plan-brief.md:91-92` — *"Assumes reviews run against an on-disk checkout. A caller holding a
  diff in memory (a PR from an API) would need to write it out or get a second entry point later."*
- `reviews/impl-review.md:237,257` — the untested containment guard was raised and the decision
  was **SKIPPED**: *"Test infrastructure deferred until the promptfoo harness settles."* That
  harness still does not exist.
- `context/foundation/test-plan.md:189-191` — the three falsification runs on PR #33.
- Neither `context/foundation/roadmap.md` nor `tasks-github.md` tracks this work; no `scripts/`
  entry talks to the GitHub API today.

## Related Research

- `context/archive/2026-09-02-tool-loop-agent/research.md` — the package's own design research
- `context/archive/2026-07-27-testing-quality-gates-wiring/` — where `ci.yml`'s two-job shape and
  the falsification discipline came from
- `context/changes/deployment/deployment-plan.md:107` — the service-role-key swap concern that
  pgTAP cannot see

## Open Questions

Carried from `requirements.md:122-129`, now sharper:

1. **Pass/fail threshold.** Still unsigned-off. New information: **no branch protection is
   available on this plan (verified 403)**, so neither label can gate a merge. Decide what
   `ai-cr:failed` *means* — advisory signal, a job that also `exit 1`s for a red check mark, or a
   promise to be cashed if the repo moves to Pro/public.
2. **Diff-only vs. whole-file reads.** The tools to read whole files already exist and criteria 2
   and 5 need them. The real question is the **budget**: 20 steps was tuned on one file, and the
   average PR here is 19 files. Needs a measured answer, not a guessed one.

New, from this research:

3. **Which criterion-4 conventions survive?** `prerender = false` (4 of 8 routes) and
   `src/components/hooks/` (empty) would generate findings against the repo's own baseline.
   Prune, or explicitly scope them to "new code only".
4. **Do `context/` and other prose files enter the review at all?** They are often the majority
   of a PR's inserted lines and none of the five criteria applies to them.
5. **Does the reviewer report pre-existing defects it reads for context?** The `identify.ts` error
   leak (`test-plan.md:773-779`) is a real criterion-5 "1" that is not in any diff.
6. **Where does the rubric live — `REVIEW_INSTRUCTIONS`, `extraInstructions`, or `context`?**
   `requirements.md:3-5` hedges between them. `extraInstructions` is the documented carrier;
   `context` is documented for per-change intent. They should not both hold rubric text.
7. **The three `ai-cr:*` labels do not exist** (verified via `gh label list`). They must be
   created before any workflow can apply them; note that `gh pr edit --add-label` validates
   label existence client-side.
8. **Does the reviewer get tests of its own?** Its hard blocker is test falsifiability and it has
   no falsifiable tests. Two calibration corpora are sitting right there: the three falsification
   commits from PR #33 (known-bad diffs with known-red outcomes) and the repo's own merged PRs.
