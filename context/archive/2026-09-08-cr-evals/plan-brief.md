# promptfoo Eval Harness for `packages/code-reviewer` — Plan Brief

> Full plan: `context/changes/cr-evals/plan.md`
> Research: `context/changes/cr-evals/research.md`

## What & Why

Introduce promptfoo as this repo's eval runner for the AI code reviewer, and use it to answer one
concrete question: **does a 10-20x cheaper model review a React 16 → React 19 migration as well as
the `anthropic/claude-sonnet-5` that CI runs today?** The reviewer currently has no falsifiable
measurement of its own quality — nine hand-driven calibration runs are all the evidence there is.

## Starting Point

`packages/code-reviewer` was deliberately shaped for this six days ago and the seams hold: injected
`LanguageModel`, side-effect-free barrel, injectable env, sandboxed `rootDir`, zod-validated output.
What ships is the *composition* `REVIEW_RUBRIC → reviewCode() → deriveVerdict()`, not the package
alone. There is no `evals/` directory, no promptfoo dependency, and no fixture corpus with an answer
key anywhere in the repo.

## Desired End State

`npm run evals` builds the package and runs one React-migration case through three models, printing
a matrix with three labelled columns. Each cell shows pass/fail on deterministic gates, per-flaw
recall (0-3), decoy precision, tokens, cost and step count. A `baseline.md` records the first
calibrated sweep in the same house style as the existing `calibration.md`. The repo's lint,
typecheck, test and pre-commit gates all stay green with a deliberately-broken fixture in the tree.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Eval runner | promptfoo 0.122.2 | The open question is a matrix question, which is what promptfoo owns and every runner-up lacks. | Research |
| Harness location | Root `evals/`, not inside the package | Evals inside the package would invert the dependency — the generic reviewer reaching up into repo-specific policy. | Research |
| Third model | `anthropic/claude-sonnet-5` | Puts the shipping baseline in the matrix, so the result is a decision ("can I swap it") rather than a ranking of two cheap models. | Plan |
| Prompt held constant | Shipping `REVIEW_RUBRIC` as `extraInstructions` | Reproduces the live CI call site and keeps `deriveVerdict()` runnable, which is what makes the static "review must fail" assertion possible. | Plan |
| Provider seam | `createReviewAgent` + `agent.generate()` | Surfaces steps, usage and cost — for a *model* comparison, price is half the answer — without changing a shipped package signature. | Plan |
| Flaw set | Severity ladder: `defaultProps` removal (critical), lost effect cleanup (major), `dangerouslySetInnerHTML` (major) | Three different kinds of wrong, none catchable by lint or typecheck, and the third actually moves a rubric criterion. | Plan |
| Decoys | Three, with a gating precision penalty | A recall-only eval rewards the model that flags everything — the one you least want gating merges. | Plan |
| Pass bar | Deterministic checks gate; flaw recall is a scored metric | What is objectively checkable blocks; what is a judgement call is measured, with the threshold calibrated from run one. | Plan |
| Judge model | `openrouter:google/gemini-3.8-flash` | A fourth vendor, so it grades none of its own siblings, and its id cannot collide with the `file://` SUT ids. | Plan |

## Scope

**In scope:** root `evals/` harness; one custom TS provider; one hand-authored React 16 → 19 case
with three flaws and three decoys; deterministic assertions; three per-flaw LLM-judge metrics plus a
precision check; a three-model matrix; a calibrated baseline record.

**Out of scope:** replaying real PR SHAs from `calibration.md`; any CI wiring; changing
`packages/code-reviewer`; OTel / `trajectory:*` assertions; absorbing `scripts/identify-harness.mjs`;
unit tests for `deriveVerdict`/`collectInputs`; tuning the rubric; building a response-cache wrapper.

## Architecture / Approach

```
evals/
  promptfooconfig.yaml          # 3 providers × 1 test, assertions, judge
  providers/code-reviewer.ts    # default-exported ApiProvider class
  cases/react-19-migration/
    before/  after/             # after/ is the agent's sandboxed rootDir
    case.diff                   # generated from before/after, committed
    case.json                   # answer key: flaws[] + decoys[]
  cases.ts                      # case.json → promptfoo test + assertions
```

One provider file is instantiated three times, distinguished by `label` and `config.model`. The case
identity travels in `context.vars` (promptfoo's `prompt` argument is a poor fit for a
`{rootDir, paths, diff}` input). Assertions and judge rubrics are all generated from `case.json`, so
nothing restates a flaw in YAML. Phases run cheapest-first: $0 → $0.02 → $1.75 → $5.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Fixture, diff, answer key | The case, plus the three scope exclusions that let a broken fixture coexist with the root gates | A decoy that is actually wrong poisons every number the harness ever produces |
| 2. Install + provider + smoke | promptfoo, the provider, one cheap model, deterministic assertions only | Provider bugs are confusing: throwing `.output` getter, env-load ordering, hung cells |
| 3. Matrix + judge + precision | Three labelled columns, four named metrics, derived recall | Judge credibility — a rubber-stamping grader makes the whole measurement decorative |
| 4. Calibrate + baseline | `--repeat 3`, a data-derived threshold, `baseline.md` | The three models may not separate at all, leaving the sweep unable to discriminate |

**Prerequisites:** `.nvmrc` bump `22.14.0` → `22.23.2` (promptfoo needs `>=22.22.0`; the machine is
on `22.19.0`); `OPENROUTER_API_KEY` in `.env`; `packages/code-reviewer` built (`npm ci && npm run
build` — the root install does not reach it).

**Estimated effort:** ~2-3 sessions across 4 phases. **Total model spend: ~$7.**

## Open Risks & Assumptions

- **The rubric measures test quality; the case measures React correctness.** All five criteria are
  about tests, and `stack-conventions` is a closed Astro/Supabase list with no React entries. The
  verdict will likely fail for "behavioural change, no tests" rather than for catching a flaw — so
  the flaw signal rests entirely on `findings[]` and the judge. This is understood and accepted, not
  overlooked.
- **The rubric tells the model not to report what CI mechanically enforces.** The flaw set was chosen
  so that none of the three is caught by lint or typecheck, which keeps that instruction from
  suppressing them — but it is a live interaction worth watching in Phase 3.
- **Temperature cannot be pinned.** Sonnet does not advertise it on OpenRouter, so uniformity is
  achieved by omission and variance is measured with `--repeat`, never with a temperature pin.
- **One case is one case.** Three flaws on one diff is a narrow instrument; a model can get lucky.
  Phase 4's repeats measure that, but the corpus needs to grow before the matrix decides anything
  irreversible.
- **Custom `file://` provider caching is unconfirmed.** Cheap enough to ignore here; Phase 4 settles
  it by reading the cost column rather than by building around it.

## Success Criteria (Summary)

- One command runs three models against one case and prints a matrix you can read in ten seconds
- Each cell says *which* of the three flaws that model found, and what the review cost
- The repo's existing gates stay green with a deliberately-broken fixture committed to it
