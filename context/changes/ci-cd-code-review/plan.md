# Agentic code review in CI — Implementation Plan

## Overview

Wire `packages/code-reviewer` into a GitHub Actions workflow that reviews every pull request
to `main` against the five acceptance criteria in `requirements.md`, posts a scored comment,
and applies `ai-cr:passed` / `ai-cr:failed`. A failing review exits non-zero, which stops the
`tm-ship` merge flow exactly as a red `ci` job does.

The package gains only the seams a PR review needs — a criteria carrier in the output schema,
title/body/diff carriers in the prompt, and provider options on the model. Everything
repo-specific (the rubric, the threshold, the diff filtering, the comment) lives in this
repository, so the package stays the generic reviewer its design record describes.

## Current State Analysis

`packages/code-reviewer` ships a working `ToolLoopAgent` with read-only, path-guarded tools and
a zod-validated output — but it was deliberately built CI-_shaped_, not CI-_wired_
(`context/archive/2026-09-02-tool-loop-agent/plan.md:90-98`). Three gaps block this change, each
an explicit exclusion at the time:

- **Output.** `reviewSchema` is `{ summary, findings[] }` (`src/schemas/review.ts:4-9`). No
  criterion identity, no score, no verdict anywhere. `findingSchema` carries a 4-value severity
  enum and nothing else (`src/schemas/finding.ts:5-12`).
- **Input.** `ReviewPromptInput` is `{ paths, context? }` (`src/prompts/review-request.ts:1-6`).
  There is no carrier for a PR title, body, or diff, and the agent has no git and no shell tool —
  `src/tools/index.ts:23-31` wires only `read_file`, `list_files`, `search_code`.
- **Model construction.** `createModel(config)` (`src/model.ts:10-18`) takes config only, so a
  caller cannot pass OpenRouter provider routing options such as `max_price`.

On the CI side there is no `.github/actions/` directory at all, and `gh label list` confirms none
of the three `ai-cr:*` labels exists. `.github/workflows/ci.yml` already carries the house style
the new workflow must match: a scoped `permissions:` block with its rationale (`ci.yml:38-42`),
`timeout-minutes` on every job (`ci.yml:49,101`), third-party actions pinned to a commit SHA with
the tag in a comment (`ci.yml:115-124`), and a `packages` matrix job whose `npm ci` → `typecheck`
→ `build` shape this change reuses (`ci.yml:75-94`).

Critically, **`packages/*` are not npm workspaces**: the root `npm ci` does not install their
dependencies, and root lint/typecheck deliberately exclude them. `dist/` and `node_modules/` are
gitignored (`packages/code-reviewer/.gitignore:1-3`), so no workflow may assume a prebuilt
package.

**Nothing gates a merge at the GitHub level.** Verified live: `GET
/branches/main/protection` and `GET /rulesets` both return **403 — "Upgrade to GitHub Pro or make
this repository public"**, and `allow_auto_merge` is `false`. A red `ci` does not grey out the
merge button. What actually stops a merge is the `tm-ship` skill: it runs
`gh pr checks <n> --watch` and, on any failing check, refuses to merge and stops. That path is
name-agnostic — a failing review check blocks it identically. (Research finding 5 concluded "the
verdict cannot block anything"; that holds only for GitHub-enforced blocking and is corrected
here.)

## Desired End State

Opening or pushing to a PR against `main` triggers one workflow run. It builds the package,
collects the PR title, body, and `git diff <base.sha> <head.sha>`, filters the changed paths down
to the code subset, and runs one agent review carrying the repo's five-criterion rubric. The run
posts a comment with a 1–10 score and rationale per criterion plus the findings, applies exactly
one of `ai-cr:passed` / `ai-cr:failed`, and exits 1 when the verdict is failed — so
`gh pr checks` goes red and `tm-ship` stops. Adding `ai-cr:retry` re-runs the review once and
removes itself.

**Verification**: open a PR with a deliberately unfalsifiable test; the run comments with
criterion 1 scored ≤3, applies `ai-cr:failed`, and the check is red. Push a fix; the next run
comments again, applies `ai-cr:passed`, removes `ai-cr:failed`, and the check is green.

### Key Discoveries:

- **The last-step net already exists.** `create-agent.ts:84-88` sets `toolChoice: "none"` at
  `stepNumber >= budget - 1`, so the model is forced to answer from whatever it has read. Keeping
  `DEFAULT_STEP_BUDGET = 20` therefore needs no package change — but the rubric must tell the
  model to prioritise its reads, because the net makes it answer regardless.
- **`extraInstructions` is the documented rubric carrier** — _"Appended to the standing
  instructions — a project checklist, say"_ (`create-agent.ts:45`). `context` stays free for
  per-PR intent. `reviewCode` hard-wires `buildReviewPrompt`, so it remains the integration point
  only if the prompt builder learns the new sections (Phase 1).
- **Falsification evidence is written in-band in this repo** — a break→red table in the test
  file's own header (`src/lib/services/vision.test.ts:3-14`), in the pgTAP file
  (`supabase/tests/database/library_entries_rls.test.sql:70-85`), and as three rows with real CI
  run ids (`context/foundation/test-plan.md:189-191`). Criterion 1 is scorable _only_ because
  that convention exists; the rubric must name it or the model invents a standard.
- **Two criterion-4 conventions contradict the baseline**: `export const prerender = false` is in
  4 of 8 API route files, and `src/components/hooks/` contains no files. Both are pruned.
- **`search_code`'s skip-list is "a cost measure, not a security boundary"**
  (`src/tools/search-code.ts:24-26`), and neither read tool is gitignore-aware. A prompt-injected
  model could read `.env` / `.dev.vars` off disk and exfiltrate it into a finding's `detail`,
  which the workflow then posts publicly.
- **`::add-mask::` redacts log output only — it does not touch uploaded files** (`ci.yml:23-30`).
  `OPENROUTER_API_KEY` is a durable secret, unlike the e2e credentials that die with their
  container.
- **`issues: write` is the scope governing both PR comments and labels** — a PR is an issue in
  GitHub's data model, and both go through `POST /repos/{o}/{r}/issues/{n}/{comments,labels}`.
- **`max_price` is reachable through the provider factory**:
  `openrouter(modelId, { provider: { max_price: { prompt, completion } } })`
  (`/openrouterteam/ai-sdk-provider`, Context7).
- **Node resolves the package's own deps from a root script.** `scripts/pr-review.mjs` importing
  `../packages/code-reviewer/dist/index.js` finds `ai` and `@openrouter/ai-sdk-provider` in
  `packages/code-reviewer/node_modules` by walking up from the importing file — so no root
  dependency additions are needed.

## What We're NOT Doing

- **Not adding tests to `packages/code-reviewer`.** The original decision (typecheck + lint only)
  stands. See Open Risks in the brief — the threshold function ships unverified by machine.
- **Not adding a calibration corpus or an eval harness.** Replaying the three PR #33 falsification
  diffs against the reviewer is a separate change.
- **Not scoring plan drift.** `requirements.md:27-33` demotes change-folder scope to advisory; the
  reviewer neither requires nor scores `context/changes/<id>/plan.md`.
- **Not reviewing prose.** `context/**`, `**/*.md`, and lockfiles are excluded from the scored
  path list.
- **Not reporting pre-existing defects.** Scores and findings cover the diff only; the known
  `identify.ts` 502 leak (`test-plan.md:773-779`) is out of scope even when the agent reads it.
- **Not using `pull_request_target`.** Its purpose is keeping untrusted content away from secrets,
  and untrusted content is precisely this job's input. The `workflow_run` two-stage pattern is the
  migration path if the repo ever goes public — not work to do now.
- **Not adding an override label.** `ai-cr:retry` is the escape hatch; checks are keyed by
  workflow + job name for the head SHA and the latest run wins, so a green retry flips the check.
- **Not adding branch protection.** It is unavailable on this plan (verified 403).
- **Not changing `REVIEW_INSTRUCTIONS`.** The generic reviewer prose stays generic.
- **Not adding the package to root npm workspaces, root lint, or root typecheck.**

## Implementation Approach

Three layers, each owning one thing:

1. **`packages/code-reviewer`** — additive, generic seams only. The schema learns that a review
   _has_ criteria; it does not learn which five. The prompt builder learns that a review _may
   have_ a title, a body, and a diff; it does not learn what a PR is. The model factory learns
   that a caller may pass provider routing options.
2. **`scripts/pr-review.mjs`** — all repo policy. The five criteria as prose, the threshold as a
   pure function, the path filter, the comment renderer, the exit code. Matches the existing
   `scripts/*.mjs` convention (`deploy-worker.mjs`, `seed-e2e-user.mjs`).
3. **`.github/`** — a composite action that installs, builds, and invokes; a workflow that
   triggers, scopes permissions, and posts.

The verdict is derived **in the script from the returned scores**, not returned by the model. The
threshold is a deterministic rule, so computing it in code makes it un-forgeable by prompt
injection and readable without trusting the model's arithmetic.

## Critical Implementation Details

**Checkout depth.** `actions/checkout` on a `pull_request` event checks out the merge commit at
depth 1. `git diff <base.sha> <head.sha>` needs both commits present — use `fetch-depth: 0`, and
take both SHAs from `github.event.pull_request.{base,head}.sha` so the diff survives a mid-run
force-push.

**Script injection.** `${{ github.event.pull_request.title }}` interpolated into a `run:` block is
the canonical GHA vulnerability and titles are attacker-controlled even from collaborators. Every
PR-derived string reaches the script through `env:` indirection and is read as `$PR_TITLE` /
`$PR_BODY`, never re-expanded by the templating engine.

**Exfiltration surface.** The review job must never create `.env` or `.dev.vars` in the checkout.
A plain checkout has neither (both gitignored), the agent's tools are not gitignore-aware, and
anything it reads can land in a finding that gets posted publicly. Say this in the action's header
comment so nobody adds such a step later. For the same reason, no debug artifact may upload the
agent's raw trace — `::add-mask::` does not redact uploaded files.

**Composite action mechanics** (first one in this repo): `shell:` is mandatory on every `run:`
step; secrets are not ambiently inherited and must be passed as explicit `with:` inputs then
re-exposed via that step's `env:`; inputs are read through the `inputs.<name>` expression, not
`INPUT_*`; and `outputs:` must be wired explicitly to a step's `$GITHUB_OUTPUT`.

**Label ordering.** `gh pr edit --add-label` validates label existence client-side, so all three
labels must exist before the first run. The two verdict labels are mutually exclusive — applying
one removes the other.

---

## Phase 1: Package seams

### Overview

Three additive changes to `packages/code-reviewer` so it can express per-criterion scores, receive
a PR's title/body/diff, and accept provider routing options. Nothing repo-specific enters the
package.

### Changes Required:

#### 1. Criteria in the output schema

**File**: `packages/code-reviewer/src/schemas/criterion.ts` (new),
`packages/code-reviewer/src/schemas/review.ts`, `packages/code-reviewer/src/schemas/index.ts`

**Intent**: Give a review a scored breakdown so a caller can apply a threshold, without teaching
the package which criteria this repository cares about.

**Contract**: A new `criterionScoreSchema` = `{ id: string, score: int 1–10, rationale: string }`,
with `id` deliberately a free string rather than an enum — the rubric that names the ids lives
repo-side. `reviewSchema` gains `criteria: z.array(criterionScoreSchema)`. Export the schema and
its inferred type from `schemas/index.ts` and the package root. `Output.object` picks the change up
by import (`create-agent.ts:83`); `dist/` is generated, not tracked.

No `verdict` field: the verdict is the caller's deterministic function of the scores.

#### 2. PR carriers in the prompt builder

**File**: `packages/code-reviewer/src/prompts/review-request.ts`

**Intent**: Let a caller hand the agent a change's title, description, and unified diff as prompt
text, since the agent has no git tool and its file tools read the checkout's current state rather
than the delta.

**Contract**: `ReviewPromptInput` gains three optional fields — `title?`, `description?`, `diff?`.
`buildReviewPrompt` already composes an array of optional sections and filters the empty ones
(`review-request.ts:20-25`), so each becomes one more labelled section. Order the diff last so it
does not push the instructions out of the model's attention. The function stays pure, so its output
remains assertable without a model.

#### 3. Provider options on the model factory

**File**: `packages/code-reviewer/src/model.ts`

**Intent**: Allow a caller to attach OpenRouter provider routing — specifically a `max_price` cap —
which is currently unreachable because `createModel` builds the model from config alone.

**Contract**: `createModel(config, options?)` where `options` carries an optional `provider` object
passed through as the second argument to `openrouter(modelId, …)`. Type it against the provider's
own settings type rather than restating it. Existing single-argument callers (`src/cli.ts`) keep
compiling.

### Success Criteria:

#### Automated Verification:

- Package typecheck passes: `npm run typecheck` in `packages/code-reviewer`
- Package build emits `dist/`: `npm run build` in `packages/code-reviewer`
- Root gates unaffected: `npm run lint` and `npm run typecheck` at the repo root
- The `packages` matrix job in `.github/workflows/ci.yml` is green

#### Manual Verification:

- `reviewSchema.criteria[].id` is a free string, with no repo-specific enum in the package
- `buildReviewPrompt` output reads sensibly with all three new sections populated

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding.

---

## Phase 2: Rubric and review script

### Overview

The whole of this repository's review policy, in one script: the five criteria, the threshold, the
diff and path handling, the comment, and the exit code.

### Changes Required:

#### 1. The rubric

**File**: `scripts/pr-review/rubric.mjs` (new)

**Intent**: Express `requirements.md`'s five criteria as `extraInstructions` text the model can
actually apply, pruned to what this codebase honours and anchored to the conventions that make each
criterion scorable.

**Contract**: A `REVIEW_RUBRIC` string naming five criterion ids — `test-falsifiability`,
`assertion-oracle`, `test-layer`, `stack-conventions`, `security-isolation` — instructing the model
to return exactly one `criteria` entry per id with a 1–10 score and a rationale. Each criterion
carries its 1-anchor and 10-anchor from `requirements.md`. Four things the prose must state that
`requirements.md` leaves implicit:

- **What "evidence of falsifiability" looks like here** — a break→red table in the test file's own
  header, in the pgTAP file, or a CI run id. Cite `vision.test.ts:3-14`,
  `library_entries_rls.test.sql:70-85`, and `test-plan.md:189-191` as the shape.
- **The pruned convention list for criterion 4** — `cn()`, zod at API boundaries, RLS with granular
  per-operation per-role policies, `YYYYMMDDHHmmss_` migration names, `astro:env/server` for
  secrets, the `@/` alias, shared types in `src/types.ts`. Explicitly **not** `prerender = false`
  and **not** `src/components/hooks/` (the repo does not honour either), and **not**
  `cloudflare:workers` over `locals.runtime.env` (typecheck already kills it).
- **Diff-only scoping** — score the changed lines; files read for context are evidence, not review
  targets. `REVIEW_INSTRUCTIONS` already says this; the rubric restates it because criteria 2 and 5
  actively push the model outside the diff.
- **Read prioritisation** — the budget is 20 steps and the loop takes the tools away on the last
  one, so read the riskiest files first and answer from what has been seen.

Include the `de-prioritized`-vs-`excluded` case (`recommendation.ts:92` vs `prd.md:83,180`, where
the test asserts rank rather than absence) as the worked example for criterion 2 — it is
`requirements.md`'s own "1" example, already solved correctly in the tree.

#### 2. Verdict derivation

**File**: `scripts/pr-review/verdict.mjs` (new)

**Intent**: Turn scores into a pass/fail label by a deterministic rule, so the verdict cannot be
forged by prompt injection and can be re-derived by anyone reading the comment.

**Contract**: A pure `deriveVerdict(criteria)` → `{ verdict: "passed" | "failed", reasons[] }`
implementing the signed-off rule: `test-falsifiability` at **≤3** fails; any other criterion at
**≤2** fails; otherwise passes. A missing or unrecognised criterion id is a hard error, not a pass
— the model returning four of five criteria must not silently become a green check.

#### 3. Diff and path collection

**File**: `scripts/pr-review/inputs.mjs` (new)

**Intent**: Produce the two things the prompt needs — the unified diff and the code subset of the
changed paths — from a checkout plus the two SHAs.

**Contract**: `git diff <baseSha> <headSha>` for the diff text and `git diff --name-only` for the
path list. The path list is filtered to the **code subset**: exclude `context/**`, `**/*.md`,
`**/package-lock.json`, `**/dist/**`, and `.claude/**`; keep everything else. Deleted files are
dropped from the path list (the agent cannot read them) but stay in the diff text. If the filter
leaves zero paths, the script exits 0 without calling the model and says the PR is prose-only.

#### 4. Comment rendering

**File**: `scripts/pr-review/comment.mjs` (new)

**Intent**: Render one markdown comment carrying the verdict, the five scores, and the findings.

**Contract**: A table of criterion × score × one-line rationale, the verdict with the specific rule
that produced it, then findings grouped by severity with `file:line` anchors. A new comment is
posted per run (no sticky marker, no dedup) — the review history is the audit trail. Include the
head SHA in the header so a reader can tell which push a comment belongs to.

#### 5. Entry point

**File**: `scripts/pr-review.mjs` (new)

**Intent**: Assemble everything, call the reviewer once, write the outputs the action consumes, and
set the exit code.

**Contract**: Reads `PR_TITLE`, `PR_BODY`, `BASE_SHA`, `HEAD_SHA`, `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, and the two `max_price` caps from the environment — never from argv, so a title
can never be parsed as a flag. Imports `reviewCode`, `createModel`, `loadConfig` from
`../packages/code-reviewer/dist/index.js`.

Writes the rendered comment to a file path given by `--out` and prints a one-line
`verdict=passed|failed` to stdout. Exits **1** on `failed`, **0** on `passed`.

`ReviewError` handling: `no-output-generated` and `step-budget-exhausted` both exit **1** with a
comment saying the review did not complete — an incomplete review must never read as a pass.

A `--dry-run` flag assembles and prints the prompt, the rubric, and the filtered path list, then
exits 0 **without constructing a model or calling OpenRouter** — the offline way to verify
filtering and prompt shape.

### Success Criteria:

#### Automated Verification:

- `node scripts/pr-review.mjs --dry-run` against a local two-SHA range prints the prompt and a path
  list with no `context/**` or `*.md` entries, and makes no network call
- The dry run works with `OPENROUTER_API_KEY` unset
- Root lint passes: `npm run lint`
- Formatting is clean: `npx prettier --check "scripts/**"`

#### Manual Verification:

- A real run with a live key against a recent merged PR's SHA range returns all five criterion ids
  with plausible scores
- The rendered comment is readable and the verdict rule it prints matches the scores shown
- Criterion 4 produces no finding about `prerender = false` or `src/components/hooks/`

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Composite action

### Overview

`.github/actions/ai-code-review/action.yml` — the first composite action in this repo. It owns
install, build, and invocation; the workflow owns triggers and permissions.

### Changes Required:

#### 1. The action

**File**: `.github/actions/ai-code-review/action.yml` (new)

**Intent**: Encapsulate the review mechanics so the calling workflow stays readable, as
`requirements.md` asks.

**Contract**: Inputs — `openrouter-api-key` (required), `model`, `max-price-prompt`,
`max-price-completion`, `base-sha`, `head-sha`, `pr-title`, `pr-body`, `comment-path`. Output —
`verdict`.

Steps: `actions/setup-node@v4` pinned per house style with
`cache-dependency-path: packages/code-reviewer/package-lock.json`; `npm ci` and `npm run build`
with `working-directory: packages/code-reviewer`; then the script, with every PR-derived value
passed through that step's `env:` and read as a shell variable — never interpolated into the `run:`
body. Every `run:` step carries an explicit `shell: bash`. The verdict output is wired from
`$GITHUB_OUTPUT`, and the step that runs the script uses `continue-on-error` so the workflow can
post the comment before failing the job.

A header comment records the two non-obvious constraints: **never create `.env` or `.dev.vars` in
this job** (the agent's tools are not gitignore-aware and its findings get posted publicly), and
**never upload the agent's raw trace as an artifact** (`::add-mask::` does not redact files and
`OPENROUTER_API_KEY` is durable).

### Success Criteria:

#### Automated Verification:

- Formatting is clean: `npx prettier --check ".github/**"`
- The action YAML parses (verified by the first workflow run in Phase 4)

#### Manual Verification:

- Every `run:` step declares `shell:`
- No PR-derived value appears inside a `run:` body as a `${{ }}` expression
- `outputs.verdict` is wired to a step's `$GITHUB_OUTPUT`
- The header comment states both the `.env` and the artifact constraint

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Workflow and labels

### Overview

Create the three labels, then the workflow that calls the action and turns its verdict into a
comment, a label, and an exit code.

### Changes Required:

#### 1. Labels

**File**: none — one-time `gh label create` per label, commands recorded in the change folder

**Intent**: The three labels must exist before any run, because `gh pr edit --add-label` validates
existence client-side.

**Contract**: `ai-cr:passed` (green), `ai-cr:failed` (red), `ai-cr:retry` (neutral), each with a
description naming the workflow that owns it. Record the exact commands in the change folder so
they are reproducible on a fresh clone or a new repo.

#### 2. The workflow

**File**: `.github/workflows/ai-code-review.yml` (new)

**Intent**: Run one review per PR event, post the result, and fail the check when the verdict is
failed.

**Contract**: `on: pull_request` with `branches: [main]` and
`types: [opened, synchronize, reopened, labeled]`, gated by
`if: github.event.action != 'labeled' || github.event.label.name == 'ai-cr:retry'`.
`concurrency: { group: ai-code-review-${{ github.event.pull_request.number }}, cancel-in-progress: true }`
— keyed on PR number so it survives force-pushes.

`permissions: { contents: read, issues: write, pull-requests: write }`, with a comment recording
that `issues: write` is what governs both the comment and the labels because a PR is an issue in
GitHub's data model. `timeout-minutes` sized ~2–3× the measured run, per house style.

Steps: `actions/checkout@v4` with `fetch-depth: 0`; the composite action, fed
`github.event.pull_request.{base,head}.sha` and title/body; then post the comment file via
`gh api`; then apply the verdict label and remove the opposite one; then remove `ai-cr:retry` if
present, so a retry is one-shot; then `exit 1` when the verdict is failed.

A header comment records the trigger rationale: the repo is private with no forks, so plain
`pull_request` is correct, and `pull_request_target` must never be used here because its purpose is
keeping untrusted content away from secrets and untrusted content is this job's input.

### Success Criteria:

#### Automated Verification:

- All three labels exist: `gh label list` contains `ai-cr:passed`, `ai-cr:failed`, `ai-cr:retry`
- Formatting is clean: `npx prettier --check ".github/**"`
- The workflow runs to completion on a test PR: `gh run list --workflow ai-code-review.yml`

#### Manual Verification:

- A comment is posted with five scores and the verdict rule
- Exactly one verdict label is applied and the opposite one is absent
- Adding `ai-cr:retry` triggers exactly one new run and the label is gone afterwards
- A failed verdict shows a red check in `gh pr checks`, and `tm-ship` refuses to merge on it
- A second push to the same PR cancels the in-flight run rather than racing it

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Calibration

### Overview

The rubric is prose aimed at a model; nothing before this phase proves it produces useful scores on
real changes. Run it against real PRs and tune wording — not code.

### Changes Required:

#### 1. Calibration record

**File**: `context/changes/ci-cd-code-review/calibration.md` (new)

**Intent**: Record what the reviewer actually said on real PRs, so rubric edits are driven by
observed failures rather than intuition.

**Contract**: One row per calibration run — PR, head SHA, files in the scored path list, steps
used, the five scores, the verdict, and a verdict on the verdict (agreed / false positive / false
negative). Include at least one PR with a deliberately unfalsifiable test to confirm criterion 1
fires, and at least one large PR (≥19 changed files) to confirm the 20-step budget holds.

#### 2. Rubric tuning

**File**: `scripts/pr-review/rubric.mjs`

**Intent**: Fix what the calibration record shows is broken.

**Contract**: Prose edits only. If a criterion consistently scores 5 with an empty rationale, its
anchors are not concrete enough. If criterion 4 produces findings against the existing baseline,
prune further. If the run exhausts its steps, sharpen the read-prioritisation instruction before
touching the budget.

### Success Criteria:

#### Automated Verification:

- Three consecutive runs on real PRs complete without `step-budget-exhausted` or
  `no-output-generated`

#### Manual Verification:

- Criterion 1 scores ≤3 on a PR carrying a deliberately unfalsifiable test
- No criterion-4 finding penalises a pattern the existing codebase uses
- Every run's verdict survives human review — no false positive, no false negative — across at
  least two runs on one unchanged SHA

  _Revised during implementation._ This read "scores are stable across two runs on the same
  unchanged SHA (no wild swing)". Score stability was a **proxy** for trustworthy verdicts, and the
  proxy broke for a legitimate reason: an agent exploring a 14-file diff on a 20-step budget finds a
  varying subset each run, and a run that discovers a real blocking defect *should* score lower than
  one that misses it. Runs 7 and 8 scored the same SHA 4 and 3 — and run 8 was right, having found
  the deletion-only bypass. Demanding identical scores would mean demanding the reviewer stop
  discovering. The property actually wanted is verdict correctness, which this now measures
  directly. See `calibration.md` § "What runs 7 and 8 established" for the full reasoning, including
  why simply moving the threshold was considered and rejected.

- `calibration.md` records at least three runs, one of them ≥19 changed files

---

## Testing Strategy

The package gets no tests (decision carried from
`context/archive/2026-09-02-tool-loop-agent/plan.md:90`), and the script gets none either. The
verification that exists:

### Automated:

- `--dry-run` exercises rubric assembly, prompt composition, path filtering, and the whole script's
  import graph with no model and no key. It is the only fast, repeatable check on the deterministic
  half.
- The existing `packages` job in `ci.yml` keeps typecheck and build honest for Phase 1.
- Prettier and ESLint cover formatting and obvious errors in the new script and YAML.

### Manual Testing Steps:

1. Open a PR whose test cannot fail (e.g. a spec glob matching zero files). Expect criterion 1 ≤3,
   `ai-cr:failed`, red check.
2. Push a fix. Expect a second comment, `ai-cr:passed`, `ai-cr:failed` removed, green check.
3. Add `ai-cr:retry`. Expect one new run and the label removed.
4. Push twice in quick succession. Expect the first run cancelled.
5. Open a prose-only PR (`context/**` only). Expect exit 0, no model call, a comment saying so.

The threshold function is the one piece where a silent bug flips a verdict and nothing catches it.
That is a known, accepted gap — see Open Risks in the brief.

## Performance Considerations

The step budget stays at **20**, with the existing last-step net forcing an answer
(`create-agent.ts:84-88`). The average PR here changes 19.4 files, but prose filtering removes most
of them — PR #33 was 5 of ~8 files under `context/`. If a real code-heavy PR still exhausts 20
steps, the first lever is the read-prioritisation instruction in the rubric, not the number.

Three independent cost walls: the step budget, `timeout-minutes` on the job, and OpenRouter
`max_price` per request. Use a **dedicated CI key** with its own spend cap, so a runaway loop cannot
drain the key used elsewhere; `GET /api/v1/key` exposes `usage` and `limit_remaining` for tracking.
Set the `max_price` caps against the pinned model's _current_ published price — read it on
openrouter.ai at implementation time rather than copying a number from this plan.

Pin `OPENROUTER_MODEL` explicitly in the action rather than relying on the config default
(`anthropic/claude-sonnet-5`, `config.ts:19`). Do not substitute `claude-haiku-4.5` to save money:
the package README records that it _"often kept calling tools until the budget ran out, or returned
an empty object."_

## Migration Notes

- **If the repo goes public or moves to GitHub Pro**: branch protection becomes available and the
  `ai-code-review` check can be marked required — no workflow change needed, since it already exits
  non-zero. At the same moment, fork PRs become reachable and the trigger must move to the
  `workflow_run` two-stage pattern; `pull_request_target` remains wrong.
- **The three labels are repo state, not code.** A fresh clone or a new repo needs them created
  before the first run. The commands live in the change folder.
- **`OPENROUTER_API_KEY` becomes a repository secret** — the first durable secret this repo's CI
  holds beyond `SUPABASE_URL` / `SUPABASE_KEY`. The `e2e` job's zero-secrets property is
  unaffected; the new workflow is a separate file.

## References

- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Research: `context/changes/ci-cd-code-review/research.md`
- Package design record: `context/archive/2026-09-02-tool-loop-agent/plan.md:90-98`,
  `plan-brief.md:50-53,85-92`
- Workflow house style: `.github/workflows/ci.yml:23-30,38-42,49,75-94,115-124`
- Mechanics donor (comment/label/status patterns):
  `~/.claude/skills/10x-impl-review-ci/references/workflow-template.yml`
- Falsification convention: `src/lib/services/vision.test.ts:3-14`,
  `supabase/tests/database/library_entries_rls.test.sql:70-85`,
  `context/foundation/test-plan.md:189-191`
- Risk map the rubric's criterion 3 refers to: `context/foundation/test-plan.md:57-64`
- E2E scoring source: `e2e/RULES.md:9-25,52-95`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Package seams

#### Automated

- [x] 1.1 Package typecheck passes — 0fca305
- [x] 1.2 Package build emits dist/ — 0fca305
- [x] 1.3 Root lint and typecheck unaffected — 0fca305
- [x] 1.4 The packages matrix job in ci.yml is green — 0fca305

#### Manual

- [x] 1.5 reviewSchema.criteria[].id is a free string, no repo-specific enum in the package — 0fca305
- [x] 1.6 buildReviewPrompt output reads sensibly with all three new sections populated — 0fca305

### Phase 2: Rubric and review script

#### Automated

- [x] 2.1 --dry-run prints prompt and a path list with no context/\*\* or \*.md entries, no network call — 1b67991
- [x] 2.2 The dry run works with OPENROUTER_API_KEY unset — 1b67991
- [x] 2.3 Root lint passes — 1b67991
- [x] 2.4 Prettier check clean on scripts/\*\* — 1b67991

#### Manual

- [x] 2.5 A live run against a merged PR's SHA range returns all five criterion ids with plausible scores — 1b67991
- [x] 2.6 The rendered comment is readable and its printed verdict rule matches the scores — 1b67991
- [x] 2.7 Criterion 4 produces no finding about prerender = false or src/components/hooks/ — 1b67991

### Phase 3: Composite action

#### Automated

- [x] 3.1 Prettier check clean on .github/\*\* — 47c5883
- [x] 3.2 The action YAML parses (verified by the first Phase 4 run) — 47c5883

#### Manual

- [x] 3.3 Every run: step declares shell: — 47c5883
- [x] 3.4 No PR-derived value appears inside a run: body as a ${{ }} expression — 47c5883
- [x] 3.5 outputs.verdict is wired to a step's $GITHUB_OUTPUT — 47c5883
- [x] 3.6 The header comment states both the .env and the artifact constraint — 47c5883

### Phase 4: Workflow and labels

#### Automated

- [x] 4.1 All three ai-cr:\* labels exist — 04055d9
- [x] 4.2 Prettier check clean on .github/\*\* — 04055d9
- [x] 4.3 The workflow runs to completion on a test PR — 04055d9

#### Manual

- [x] 4.4 A comment is posted with five scores and the verdict rule — 04055d9
- [x] 4.5 Exactly one verdict label applied, the opposite one absent — 04055d9
- [x] 4.6 ai-cr:retry triggers exactly one new run and is removed afterwards — 04055d9
- [x] 4.7 A failed verdict shows red in gh pr checks and tm-ship refuses to merge — 04055d9
- [x] 4.8 A second push cancels the in-flight run — 04055d9

### Phase 5: Calibration

#### Automated

- [x] 5.1 Three consecutive real-PR runs complete without step-budget-exhausted or no-output-generated

#### Manual

- [ ] 5.2 Criterion 1 scores <=3 on a PR carrying a deliberately unfalsifiable test
- [x] 5.3 No criterion-4 finding penalises a pattern the existing codebase uses
- [ ] 5.4 Every run's verdict survives human review (no false positive or negative) across two runs on one unchanged SHA
- [x] 5.5 calibration.md records at least three runs, one of them >=19 changed files
