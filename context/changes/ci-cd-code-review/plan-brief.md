# Agentic code review in CI — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Requirements: `context/changes/ci-cd-code-review/requirements.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Every PR to `main` gets an agentic code review scored against five criteria this repo has
actually been burned on — test falsifiability, assertion oracle, test layer, stack conventions,
security and isolation. `ci` and `e2e` already enforce what a machine can mechanically check; this
reviews what they structurally cannot see: whether a new test can actually go red, whether an
assertion was copied out of the code it tests, whether a risk is defended at a layer that can
observe it.

## Starting Point

`packages/code-reviewer` is a working, path-guarded `ToolLoopAgent` with zod-validated output —
built CI-_shaped_ but deliberately not CI-_wired_. Three gaps block this, each an explicit
exclusion in its design record: the output schema has no criterion or score, the prompt has no
carrier for a PR title/body/diff, and the model factory takes no provider options. There is no
`.github/actions/` directory, and none of the three `ai-cr:*` labels exists.

## Desired End State

Opening or pushing to a PR runs one review. It posts a comment with five 1–10 scores plus
findings, applies exactly one of `ai-cr:passed` / `ai-cr:failed`, and exits non-zero when failed.
`ai-cr:retry` re-runs it once and removes itself.

## Key Decisions Made

| Decision              | Choice                                                       | Why                                                                                        | Source       |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------ |
| Does a red review block? | Yes — `exit 1`                                            | `tm-ship` refuses to merge on any failing check, so it blocks by the same path `ci` does     | Plan         |
| Escape hatch          | `ai-cr:retry` only, no override label                        | Latest run per check name wins, so a green retry flips the check with no new machinery       | Plan         |
| Threshold             | C1 ≤3 fails; any other ≤2 fails                              | Matches the stated intent that criterion 1 is the only hard blocker                          | Requirements |
| Who decides the verdict | The script, from the scores — not the model                | A deterministic rule in code cannot be forged by prompt injection                            | Plan         |
| Rubric home           | `extraInstructions`, repo-side                               | The documented carrier (`create-agent.ts:45`); keeps the package generic                     | Plan         |
| Criterion ids         | Free strings in the schema, named only by the rubric         | Repo policy stays out of a reusable package                                                  | Plan         |
| Criterion 4 conventions | Prune `prerender = false` and `src/components/hooks/`      | The repo honours neither (4 of 8 routes; empty dir) — they'd fail against its own baseline   | Research     |
| Prose files           | Excluded from the scored path list                           | Most PRs are majority `context/**`; none of the five criteria applies, and it burns steps    | Research     |
| Pre-existing defects  | Not reported — diff only                                     | A PR blocked for code it never touched is the fastest way to make the reviewer resented      | Plan         |
| Step budget           | Keep 20; the last-step net forces an answer                  | `create-agent.ts:84-88` already sets `toolChoice: "none"` at `budget - 1` — no change needed | Research     |
| Entry point           | `scripts/pr-review.mjs`                                      | Repo policy sits with the repo; matches existing `scripts/*.mjs`; no root deps needed        | Plan         |
| Model & cost          | Pin the model, `max_price` cap, dedicated capped CI key      | Three independent walls; README warns haiku-4.5 loops until the budget dies                  | Research     |
| Comment behaviour     | New comment per run                                          | The review history is the audit trail                                                        | Plan         |
| Package tests         | None — typecheck only                                        | Carries the original decision forward (see Open Risks)                                       | Plan         |

## Scope

**In scope:** generic `criteria[]` in `reviewSchema`; title/body/diff carriers in
`buildReviewPrompt`; provider options on `createModel`; the rubric, threshold, diff/path filtering,
comment renderer and exit code in `scripts/pr-review*`; a composite action; the workflow; the three
labels; a calibration pass on real PRs.

**Out of scope:** tests for the package or the script; an eval/calibration corpus; plan-drift
scoring; reviewing prose; reporting pre-existing defects; `pull_request_target`; an override label;
branch protection; adding the package to root workspaces/lint/typecheck.

## Architecture / Approach

Three layers, each owning one thing. **The package** learns only that a review _has_ criteria and
_may have_ a title/body/diff — never which five, never what a PR is. **`scripts/pr-review.mjs`**
holds all repo policy: rubric prose, the threshold as a pure function, path filtering, the comment,
the exit code. **`.github/`** holds a composite action (install → build → invoke) and a workflow
(trigger → permissions → comment → label → exit). The workflow hands the script a
`git diff <base.sha> <head.sha>` plus the code subset of the changed paths; the agent's own
`read_file` / `search_code` tools supply everything criteria 2 and 5 need from outside the diff.

## Phases at a Glance

| Phase                     | What it delivers                                          | Key risk                                                              |
| ------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Package seams          | `criteria[]`, PR prompt carriers, provider options         | Schema change ripples through `Output.object`; keep ids generic        |
| 2. Rubric & review script | The five criteria, threshold, filtering, comment, exit code | Rubric prose is the whole product — vague anchors give flat 5s         |
| 3. Composite action       | Install/build/invoke, first `.github/actions/` in the repo  | Composite gotchas: `shell:` on every step, secrets not inherited       |
| 4. Workflow & labels      | Triggers, permissions, comment, labels, red check           | Script injection via PR title; `fetch-depth: 0` for the two SHAs       |
| 5. Calibration            | Rubric tuned against real PRs, recorded                     | The rubric may need several passes; budget unproven at ~19 files       |

**Prerequisites:** an OpenRouter API key added as a repository secret (dedicated, spend-capped);
`gh` authenticated with label-write access.
**Estimated effort:** ~3–4 sessions. Phases 1 and 3 are small; Phase 2 carries most of the work and
Phase 5 is open-ended tuning.

## Open Risks & Assumptions

- **The threshold function ships unverified by machine.** It decides pass/fail and has no test — by
  the reviewer's own criterion 1, that is a 1. Accepted deliberately to hold the package's original
  no-tests decision; the `--dry-run` path covers assembly and filtering but not `deriveVerdict`.
- **Criterion 4 is entirely judgement.** `eslint.config.js` carries no repo-specific rule for any
  CLAUDE.md convention, so there is no mechanical baseline to appeal to. Highest false-positive risk.
- **The 20-step budget is unproven at scale.** It was tuned on a single-file smoke test. The
  last-step net means the model always answers — which converts "ran out of room" into "scored from
  partial evidence", a quieter failure than an error.
- **Blocking rests on the `tm-ship` flow, not on GitHub.** Branch protection is unavailable
  (verified 403). A merge made outside `tm-ship` — including the web UI button — ignores the check.
- **Prompt injection can shape scores, not just findings.** Deriving the verdict in code removes the
  forged-verdict path but not forged inputs to it. The blast radius is capped: the agent has no
  write tools, and the review job must never create `.env` / `.dev.vars` in its checkout.
- **`test-plan.md`'s "12 test files / 238 tests" is stale** (now 15). Any rubric text quoting
  test-plan counts as current truth will be wrong.

## Success Criteria (Summary)

- A PR carrying a test that cannot fail gets criterion 1 ≤3, `ai-cr:failed`, and a red check that
  stops `tm-ship`.
- A clean PR gets `ai-cr:passed` and a green check, with no criterion-4 finding penalising a
  pattern the existing codebase already uses.
- A prose-only PR costs nothing — no model call, exit 0.
