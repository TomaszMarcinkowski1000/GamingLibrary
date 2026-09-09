# promptfoo Eval Harness for `packages/code-reviewer` — Implementation Plan

## Overview

Introduce promptfoo as this repository's eval runner for the AI code reviewer, and use it to answer
one concrete question: **does a 10-20x cheaper model review a React 16 → React 19 migration as well
as the `anthropic/claude-sonnet-5` that CI runs today?**

The deliverable is a root-level `evals/` harness containing a custom TypeScript provider that drives
`packages/code-reviewer` end-to-end (real tool loop, real file reads, real OpenRouter calls), one
hand-authored migration case carrying three planted flaws and three decoys, deterministic assertions
over the review's structural health, and an LLM-as-a-judge scoring per-flaw recall and
false-positive precision — all run as a `1 case × 3 model` matrix.

This is the change that `context/archive/2026-09-02-tool-loop-agent/plan.md:88-89` explicitly
deferred ("Not configuring the eval environment… This change only makes the package *shaped* for
that later") and that `context/archive/2026-09-07-ci-cd-code-review/plan.md:104-105` deferred again.

## Current State Analysis

**The seams exist and are intact.** The package was designed for this six days ago and the design
still holds. `createReviewAgent({model})` takes any AI SDK `LanguageModel`
(`packages/code-reviewer/src/agent/create-agent.ts:41`), `src/index.ts` is an exports-only barrel
that reads no environment, `createReviewTools({rootDir})` confines every file read to a directory
the caller names, and output is validated against `reviewSchema` before it is returned. A provider
is genuinely small.

**The system under test is the composition, not the package.** `REVIEW_INSTRUCTIONS` names no
criteria; the five this repo scores live in `scripts/pr-review/rubric.mjs` and the pass/fail rule in
`scripts/pr-review/verdict.mjs`. What ships is
`REVIEW_RUBRIC → reviewCode({extraInstructions}) → deriveVerdict()`, and the eval reproduces that
call site (`scripts/pr-review.mjs:233-241`) rather than the package's bare defaults.

**Nothing eval-shaped exists yet.** No `evals/` directory, no promptfoo dependency, no fixture
corpus, no answer key anywhere in the repo. The one precedent is `scripts/identify-harness.mjs`, a
hand-rolled accuracy harness for the vision prompt — evidence that measuring a prompt against a
labelled dataset is an established idea here, only the *tool* is new.

**Three prerequisites, all verified against live sources in this session:**

| Constraint | Reality | Consequence |
|---|---|---|
| promptfoo `0.122.2` requires node `>=22.22.0` | `.nvmrc` is `22.14.0`; local node is `22.19.0`; latest Node 22 LTS is **v22.23.2** | `.nvmrc` must move to `22.23.2`. CI's `node-version: 22` already resolves above the floor. |
| Root `tsconfig.json` is `include: ["**/*"], exclude: ["dist","packages"]` | `astro check` will typecheck `evals/**`, including the deliberately-broken fixture | Fixture tree must be added to `exclude`. |
| Root `eslint.config.js` ignores only `packages/**`, and applies `strictTypeChecked` + `react-hooks` + `react-compiler: error` to everything else | `eslint .` will lint the fixture; `lint-staged` runs `eslint --fix` on staged `*.tsx` | Fixture tree needs an explicit `ignores` entry. |

A fourth, quieter one: `npm run format` is `prettier --write .` and `.prettierignore` does not cover
`evals/`. Prettier reformatting the fixture would silently invalidate the committed diff and every
line number in the answer key.

**Two facts that de-risk the research's biggest worries:**

- **Cost is not a constraint at this scale.** Verified live against OpenRouter: `deepseek/deepseek-v4-flash`
  is $0.086/$0.17 per M tokens, `z-ai/glm-5.1` is $0.97/$3.04, `anthropic/claude-sonnet-5` is $2/$10.
  A full three-model sweep of one case is **~$1.70**, dominated entirely by Sonnet. Research §D's
  "custom `file://` providers appear not to be cached" gotcha, which would be alarming on a 10-case
  suite, is a rounding error here — it becomes an observation to record in Phase 4 rather than an
  architecture to design around.
- **The `no-network.ts` trap does not apply.** `vitest.config.ts` includes only `src/**/*.test.ts`
  and `*.test.ts`, so `evals/` sits outside the vitest suite and outside its deny-all `fetch`.
  Research §G's "must be a separate vitest project" warning is moot because the harness is not
  vitest at all.

## Desired End State

From a clean checkout on node 22.23.2, with `OPENROUTER_API_KEY` in `.env`:

```
npm run evals
```

builds `packages/code-reviewer`, then runs one React-migration case through three models and prints
a matrix with three labelled columns. Each cell shows: pass/fail on the deterministic gates, a
per-flaw recall score (0-3), a decoy-precision verdict, token usage, cost, and step count. A
`baseline.md` in the change folder records the first calibrated sweep in the same house style as
`context/archive/2026-09-07-ci-cd-code-review/calibration.md`.

`npm run lint`, `npm run typecheck`, `npm test` and the husky pre-commit hook all stay green with
the fixture present.

### Key Discoveries

- `packages/code-reviewer/src/agent/create-agent.ts:41` — injected `LanguageModel`; the substitution seam.
- `packages/code-reviewer/src/agent/review-code.ts:91` — `result.output` is a **throwing getter**;
  `review-code.ts:92-107` wraps it in try/catch and maps to `ReviewError`. Any provider bypassing
  `reviewCode` must reproduce that.
- `packages/code-reviewer/src/config.ts:35-45` — `loadConfig(env)` calls `loadEnvFile()` **only**
  when `env === process.env`. Per-model instantiation must therefore call it bare once first.
- `packages/code-reviewer/src/model.ts:41` — `createModel(config, {provider, structuredOutputs})`;
  `structuredOutputs` is the documented lever for models that mishandle strict JSON schema at the
  end of a long tool loop.
- `scripts/pr-review/verdict.mjs:45-68` — `deriveVerdict` **throws** on a criteria set that is not
  exactly the five. That is a distinct, separately assertable failure mode from a low score.
- `scripts/pr-review/rubric.mjs:30-36` — `CRITERION_IDS`, the completeness contract.
- **Verified live on OpenRouter (2026-09-08):** `z-ai/glm-5.1` and `deepseek/deepseek-v4-flash` both
  advertise `tools`, `structured_outputs` **and** `temperature`; `anthropic/claude-sonnet-5`
  advertises `tools` and `structured_outputs` but **not** `temperature`. A uniform temperature pin
  across the matrix is unavailable — confirming the note at `scripts/pr-review.mjs:41-56`.
- promptfoo custom providers must be a **default-exported class** with `id()` and `callApi()`;
  `file://provider.ts:ClassName` is not supported for providers. Multiple instances of the same file
  are distinguished by `label` + `config` (verified against promptfoo docs this session).

## What We're NOT Doing

- **Not replaying real PR SHAs.** Research §E identified six replayable head SHAs from
  `calibration.md`. That corpus is the natural second case set, but this change ships exactly one
  hand-authored case so the answer key is unarguable.
- **Not wiring evals into CI.** The chosen cost model is on-demand. No workflow file, no new
  repository secret, no PR gate.
- **Not changing `packages/code-reviewer`.** The provider reads run metadata by calling
  `createReviewAgent` + `agent.generate()` itself. Extending `reviewCode` to return
  `{review, meta}` (research gap C.1) remains a separate change.
- **Not adding OTel / `trajectory:*` assertions.** Provider `metadata` gives the same tool-loop
  signal with no tracing stack (research §D). Tracing is a later upgrade.
- **Not absorbing `scripts/identify-harness.mjs`.** The vision prompt is a second surface promptfoo
  could take over later (research §F); out of scope here.
- **Not adding unit tests for `deriveVerdict` / `collectInputs` / `createPathGuard`.** Cheap and
  worth doing, but they belong in vitest, not in the eval layer (research §C.2).
- **Not tuning the rubric.** `REVIEW_RUBRIC` is held constant; the model is the only variable.
- **Not solving provider response caching.** Phase 4 *observes* whether repeats are cached and
  records the answer; it does not build a `fetchWithCache` wrapper.

## Implementation Approach

A root-level `evals/` directory with promptfoo as a root devDependency, mirroring how
`scripts/pr-review.mjs:40` already reaches into the package's `dist/`. Evals inside the package
would invert the dependency — the generic reviewer reaching up into repo-specific policy — which is
precisely the separation `packages/code-reviewer/src/schemas/criterion.ts:9-13` exists to preserve.

```
evals/
  promptfooconfig.yaml          # providers × tests, assertions, judge config
  providers/code-reviewer.ts    # default-exported ApiProvider class
  cases/react-19-migration/
    before/                     # React 16-era tree (pre-migration)
    after/                      # migrated tree — this is the agent's rootDir
    case.diff                   # generated from before/after, committed
    case.json                   # answer key: flaws[], decoys[]
  cases.ts                      # test generator: case.json → promptfoo test
  README.md
```

The four phases run cheapest-first: everything offline and free in Phase 1, two cents in Phase 2,
$1.75 in Phase 3, $5 in Phase 4. Each phase has a gate that fails for a legible reason before the
next one spends money.

**The measurement split**, settled in questioning and consistent with research §A: what is
objectively checkable **gates**; what is a judgement call is **measured**. Schema validity, the
five-criterion contract, the derived verdict and finding severity are deterministic and hard-fail a
cell. Per-flaw recall and decoy precision are LLM-graded named metrics, reported per cell and rolled
into a score, with the threshold calibrated from the first sweep rather than asserted blind.

## Critical Implementation Details

**Environment loading order.** `loadConfig(env)` skips the `.env` file whenever it is handed an
explicit env object (`config.ts:36`). The provider needs a *different* `OPENROUTER_MODEL` per
instance, so it must call `loadConfig()` bare once — which side-effects `.env` into `process.env` and
validates the key — and only then `loadConfig({ ...process.env, OPENROUTER_MODEL: this.config.model })`
per instance. Reversing the order yields a confusing "OPENROUTER_API_KEY is required" against a
`.env` that is sitting right there.

**`result.output` throws.** On `ToolLoopAgent`, `.output` is a getter that raises
`NoOutputGeneratedError` / `NoObjectGeneratedError` rather than returning undefined. The provider
must reproduce `review-code.ts:92-107`'s two-arm diagnosis — `finishReason === "tool-calls"` **or**
`steps.length >= budget` means budget exhaustion, anything else means no output — and surface the
`ReviewError` code as a promptfoo `error` plus `metadata.errorCode`, so a run that produced no review
is legible in the matrix rather than an opaque red.

**Diff/fixture byte stability.** `case.diff` is generated from `before/` and `after/` and committed.
Every line number in `case.json` refers to `after/`. Prettier reformatting either tree desynchronises
all three artifacts at once, and the failure is silent — the eval keeps running and grades against
stale line numbers. The `.prettierignore` entry is load-bearing, and Phase 1's gate re-generates the
diff and asserts a clean `git diff`.

## Phase 1: Case Fixture, Diff, and Answer Key

### Overview

Build the React 16 → React 19 migration case entirely offline, and make the three scope exclusions
that let a deliberately-broken fixture live inside a repo whose root gates lint and typecheck
everything. No promptfoo, no network, no cost. This phase is done when the repo is fully green with
the fixture present.

### Changes Required

#### 1. Scope exclusions (do these first — the fixture cannot be committed without them)

**File**: `tsconfig.json`

**Intent**: Keep `astro check` out of the fixture tree. The `after/` tree contains code that is
deliberately wrong, and the `before/` tree is React 16-era; both would fail a strict typecheck and
would block the husky pre-commit hook.

**Contract**: Add `"evals/cases"` to the existing `exclude` array. Do **not** exclude all of
`evals/` — `evals/providers/*.ts` and `evals/cases.ts` are real code and should stay typechecked.

---

**File**: `eslint.config.js`

**Intent**: Keep `eslint .` and `lint-staged`'s `eslint --fix` out of the fixture tree, for the same
reason, with the added hazard that `--fix` would silently *repair* a planted flaw.

**Contract**: Add an `{ ignores: ["evals/cases/**"] }` entry alongside the existing
`{ ignores: ["packages/**"] }`, carrying a comment explaining that this tree is fixture data whose
defects are the point. Note that `react-hooks` and `react-compiler: error` apply repo-wide, so
without this the missing-cleanup flaw would be reported by lint before any model sees it.

---

**File**: `.prettierignore`

**Intent**: Stop `npm run format` from reformatting the fixture or the generated diff. This is the
quietest of the three failures: reformatting desynchronises `before/`, `after/`, `case.diff` and
`case.json`'s line numbers simultaneously, and nothing errors.

**Contract**: Add `evals/cases/` with a comment naming the consequence.

#### 2. The migration fixture

**File**: `evals/cases/react-19-migration/before/**` and `.../after/**`

**Intent**: A realistic, non-trivial React 16 class component and its React 19 function-component
migration, sized so a competent reviewer needs several tool calls but can converge inside the
20-step budget. It must look like it belongs in *this* repo — the rubric tells the model it is
reviewing "an Astro 6 SSR app with React 19 islands, Tailwind 4, Supabase auth and Postgres", and a
fixture that looks like a generic tutorial invites the model to score `stack-conventions` on
conventions this repo does not hold.

**Contract**: A component under a repo-plausible path (e.g. `src/components/GameShelf.tsx`) that
fetches library entries, renders them, and handles prop-driven refetch — the shape the existing app
already has. `after/` is the agent's `rootDir`, so it must be self-contained enough for `read_file`,
`list_files` and `search_code` to be useful: include the component, one or two modules it imports
(`src/lib/utils.ts` with `cn()`, a types module), and a `package.json` declaring React 19. Roughly
150-250 lines of changed code total — enough that the three flaws are not the only thing in the
diff.

The three planted flaws, one per kind of wrong:

| # | Flaw | Severity | Why it is not caught by anything else |
|---|---|---|---|
| 1 | Class → function conversion keeps `GameShelf.defaultProps = {...}`. React 19 removed `defaultProps` for function components, so the default silently never applies and the prop arrives `undefined`. | critical | ESLint has no rule for it; TypeScript does not flag it if the prop is declared optional. Purely a React-19 semantics break. |
| 2 | The `componentWillUnmount` teardown is lost in the `useEffect` conversion — no cleanup return, so an in-flight fetch resolves after unmount and writes state, and a subscription leaks under React 19 StrictMode's double-invoke. | major | `react-hooks/exhaustive-deps` checks the dependency array, not a *missing cleanup return*. Lint stays silent. |
| 3 | The legacy render path is replaced with `dangerouslySetInnerHTML` over a user-supplied field. | major | `react/no-danger` is off in `eslint-plugin-react`'s `recommended`, which is what this repo extends. This is the one flaw that should also move a rubric criterion (`security-isolation`). |

The three decoys — changes that read as wrong to a React 16 reviewer and are correct here:

| # | Decoy | Why it is correct |
|---|---|---|
| A | `forwardRef` unwrapped; the component takes `ref` as a plain prop. | React 19 passes `ref` as a normal prop to function components; `forwardRef` is no longer required. |
| B | A `useMemo` around a cheap derived value is dropped. | This repo runs `eslint-plugin-react-compiler` (`eslint.config.js`), so manual memoisation of cheap derivations is not the convention here. |
| C | `ReactDOM.render` → `createRoot`, done correctly at module scope with the root created once. | The correct migration. It is adjacent to the classic "root created per render" bug, so a pattern-matching reviewer may flag it anyway. |

A decoy that is *actually* wrong poisons the answer key, so each one gets a comment in the fixture
stating why it is correct, and Phase 1's manual gate is a human reading all three and agreeing.

#### 3. Generated diff

**File**: `evals/cases/react-19-migration/case.diff` + a root `package.json` script

**Intent**: The diff the reviewer sees must be derived from the fixture rather than hand-written
beside it, so the two cannot drift. It is committed (not generated at eval time) so a run needs no
git and produces byte-identical input every time.

**Contract**: A script — `evals:diff` in root `package.json` — runs `git diff --no-index --no-prefix`
over `before/` and `after/` and writes `case.diff`. `git diff --no-index` exits non-zero when files
differ, which is the normal case here, so the script must not treat that as failure. Re-running it
on an unchanged fixture must leave the working tree clean; that is this phase's automated gate.

#### 4. Answer key

**File**: `evals/cases/react-19-migration/case.json`

**Intent**: The ground truth, as plain data separable from any eval runner. Research §G's closing
argument is that the corpus — not the tool — is the one-way door, so this file must be readable and
useful even if promptfoo is later replaced.

**Contract**: A JSON object carrying the case identity (`id`, `title`, `description`, `rootDir`,
`paths[]`, `diffPath`) and two arrays. Each `flaws[]` entry: `{ id, file, line, severity,
whatIsBroken, whyItMatters }` — `whatIsBroken` is prose the judge is graded against, so it states the
defect without naming the API in a way that would make a keyword match sufficient. Each `decoys[]`
entry: `{ id, file, line, whyItIsCorrect }`. Phase 2's provider and Phase 3's judge rubrics are both
generated from this file; nothing restates a flaw in the YAML.

#### 5. Harness README

**File**: `evals/README.md`

**Intent**: The entry point for anyone who finds `evals/` later — what it measures, what it costs,
what it deliberately does not do.

**Contract**: Prerequisites (node floor, `OPENROUTER_API_KEY`, the package build step), how to run,
what a cell means, and a pointer to `context/changes/cr-evals/plan.md` and the research doc. Grows in
each later phase.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with the fixture present
- `npm run typecheck` (`astro check`) passes with the fixture present
- `npm test` passes (fixture is outside the vitest include set)
- `npm run format` leaves `evals/cases/` byte-identical (`git diff --quiet -- evals/cases`)
- `npm run evals:diff` on an unchanged fixture leaves the working tree clean
- `case.json` parses and every `flaws[].file` / `decoys[].file` resolves under `after/`
- The husky pre-commit hook passes when the fixture is staged

#### Manual Verification

- Each of the three decoys is genuinely correct under React 19 — read and confirmed, not assumed
- Each of the three flaws is genuinely broken and independently discoverable — none is a consequence of another
- `case.diff` reads as a plausible PR, not as a puzzle with three obviously planted bugs
- The `after/` tree looks like it belongs in this repo (Tailwind via `cn()`, `@/` alias, no Next.js directives)

**Implementation Note**: Pause for manual confirmation before Phase 2. The answer key is the one
artifact that outlives every other decision in this plan; a wrong decoy invalidates every number the
harness ever produces.

---

## Phase 2: promptfoo Install, Custom Provider, Single-Model Smoke

### Overview

Install promptfoo, write the provider, and prove the whole loop runs end-to-end against **one** cheap
model with only deterministic assertions — for about two cents — before the matrix or the judge spend
anything.

### Changes Required

#### 1. Node floor

**File**: `.nvmrc`

**Intent**: promptfoo `0.122.2` declares `engines: { node: ">=22.22.0" }`. The pin is currently
`22.14.0` and the machine is on `22.19.0`; neither satisfies it.

**Contract**: `22.23.2` — the latest Node 22 LTS (Jod, 2026-07-28). CI's `node-version: 22` already
resolves above the floor and needs no change. `packages/code-reviewer/package.json`'s own
`engines: >=22.14.0` is untouched: the package does not depend on promptfoo.

#### 2. promptfoo dependency and run scripts

**File**: `package.json` (root)

**Intent**: promptfoo as a root devDependency, plus the scripts that make a sweep one command. The
package's `dist/` must exist before any provider can import it, and it is gitignored — so the build
belongs *inside* the eval script, not in a README instruction someone will skip.

**Contract**: `promptfoo` in `devDependencies`. Scripts: `evals` (installs + builds
`packages/code-reviewer`, then `promptfoo eval -c evals/promptfooconfig.yaml`), `evals:view`
(`promptfoo view`), and `evals:diff` from Phase 1. Note that `packages/*` are standalone npm
projects — the root `npm ci` does not install their dependencies, exactly as the `packages` job in
`ci.yml:70-94` documents — so the build step needs its own `npm ci` in that directory.

#### 3. The provider

**File**: `evals/providers/code-reviewer.ts`

**Intent**: Drive the package exactly as `scripts/pr-review.mjs:233-241` does, but through
`createReviewAgent` + `agent.generate()` rather than `reviewCode`, so the run's steps, token usage,
cost and `finishReason` survive into the promptfoo report. For a *model* comparison those columns are
half the answer: `glm-5.1` at a tenth of Sonnet's price is only interesting alongside the price.

**Contract**: A **default-exported class** (promptfoo does not support `file://path.ts:ClassName` for
providers) implementing `id(): string` and
`callApi(prompt, context): Promise<ProviderResponse>`. Constructor takes `ProviderOptions`; its
`config` carries `{ model, structuredOutputs?, temperature?, stepBudget?, timeoutMs? }`. The case
identity travels in `context.vars` (the case object from `case.json` plus the diff text), not in the
prompt string — promptfoo's `prompt` argument is a poor fit for a `{rootDir, paths, diff}` input and
degrades to a case descriptor here.

It returns `{ output: <the validated Review object>, tokenUsage, cost, metadata: { steps, toolCalls, finishReason, model } }`.
Returning `output` as a structured object rather than a string is what lets Phase 2's `javascript`
assertions receive it already parsed.

Three things it must get right, each of which fails confusingly otherwise:

- **Env order** — `loadConfig()` bare first, then `loadConfig({ ...process.env, OPENROUTER_MODEL })`.
  See *Critical Implementation Details*.
- **The throwing `.output` getter** — reproduce `review-code.ts:92-107`'s two-arm diagnosis and
  surface `ReviewError.code` as `metadata.errorCode` alongside a promptfoo `error`, so
  `no-output-generated` and `step-budget-exhausted` are distinguishable in the matrix. This is not
  hypothetical: `calibration.md` records `no-output-generated` twice on `glm-4.7`.
- **Its own timeout** — an `AbortSignal` bounded by `config.timeoutMs`. Research's architecture note
  records that calibration run 5 hit the job timeout and left the PR **green**, because a cancelled
  job is not a failed one. A hung cell must fail as a cell, not wedge the sweep.

`structuredOutputs` is exposed as a per-provider knob (forwarded to
`createModel(config, { structuredOutputs })`) precisely because a model that mishandles strict JSON
schema at the end of a long tool loop can then be relaxed in YAML rather than in code —
`model.ts:20-32` documents this as the intended lever.

**Temperature is left unset for all three models.** `anthropic/claude-sonnet-5` does not advertise
`temperature` on OpenRouter and sending it with `require_parameters: true` fails the request outright
(`scripts/pr-review.mjs:41-56`; calibration run 6 burned 14 seconds and $0 proving it). Uniformity is
achieved by omission, and run-to-run variance is measured with `--repeat` in Phase 4. The knob stays
in the provider config for a future single-model sweep.

#### 4. Test generator

**File**: `evals/cases.ts`

**Intent**: Turn `case.json` plus `case.diff` into a promptfoo test case, so the YAML never restates
what the answer key already says.

**Contract**: A named export promptfoo loads as `tests: file://cases.ts:generate` (the `:functionName`
suffix *is* supported for test generators — it is only providers that cannot use it). It reads the
case directory, resolves `rootDir` to an absolute path, inlines the diff, and returns one test whose
`vars` carry the case object, the flaws and the decoys.

#### 5. Config with one provider

**File**: `evals/promptfooconfig.yaml`

**Intent**: The smallest config that exercises the full path, so a provider bug surfaces for two
cents rather than in the middle of a $1.75 sweep.

**Contract**: `providers:` holds a single entry — `id: file://providers/code-reviewer.ts`,
`label: deepseek-v4-flash`, `config.model: deepseek/deepseek-v4-flash` — the cheapest of the three at
$0.086/$0.17 per M. `tests: file://cases.ts:generate`. Assertions are the deterministic gates only,
as `javascript` assertions receiving the already-parsed `Review`:

1. `output` parses against `reviewSchema` (importable straight from the package barrel).
2. `deriveVerdict(output.criteria)` **does not throw** — the five-criterion contract from
   `verdict.mjs:45-68`. This catches a distinct failure mode from a low score: schema-valid output
   that is policy-invalid.
3. `deriveVerdict(output.criteria).verdict === "failed"` — the change must not merge.
4. At least one finding at `major` or `critical` severity, anchored to the migrated component file.

Note that (3) will most likely fire because a behavioural migration ships no tests — the rubric's
hard blocker is `test-falsifiability` — rather than because the model caught a React flaw. It is a
real assertion about what CI would do, and it is deliberately *not* the flaw-recall measurement;
that is Phase 3's job.

The judge is not wired yet. Introducing a grading provider and a new provider file in the same run
makes a failure ambiguous.

### Success Criteria

#### Automated Verification

- `node -v` reports `>=22.22.0` after the `.nvmrc` bump
- `npm run lint` and `npm run typecheck` pass with `evals/providers/*.ts` and `evals/cases.ts` present and typechecked
- `npm run evals` builds `packages/code-reviewer` and exits 0 on a green run
- The run produces a `Review` that satisfies all four deterministic assertions
- `metadata` in the result carries a non-empty `steps` count, a `finishReason`, and non-zero `tokenUsage` / `cost`

#### Manual Verification

- The reported cost for the single cell is in the expected order of magnitude (cents, not dollars)
- `promptfoo view` renders the cell and the review JSON is readable
- Forcing a failure (temporarily narrowing `paths` to an empty set, or pointing `rootDir` at an empty directory) produces a legible red with an `errorCode`, not an opaque stack trace
- The step count shows the agent actually used its tools rather than answering from the diff alone

**Implementation Note**: Pause for manual confirmation before Phase 3. The step count is the specific
thing to look at — a run that converged in two steps read nothing and is grading the diff text, which
would make the whole "full agent loop" scope decorative.

---

## Phase 3: Three-Model Matrix, LLM Judge, and Precision Penalty

### Overview

Add the other two models as labelled instances of the same provider file, and add the measurement
half: three per-flaw recall metrics and one decoy-precision check, graded by an independent judge.

### Changes Required

#### 1. The matrix

**File**: `evals/promptfooconfig.yaml`

**Intent**: Three cells, one prompt, one case. `REVIEW_RUBRIC` is held constant so the model is the
only variable.

**Contract**: Two more `providers:` entries pointing at the same `file://providers/code-reviewer.ts`,
distinguished by `label` and `config.model` — `glm-5.1` (`z-ai/glm-5.1`) and `claude-sonnet-5`
(`anthropic/claude-sonnet-5`). promptfoo distinguishes repeated instances of one provider file by
`label`, so the labels must be unique and are what the report columns are named after.

#### 2. Judge configuration

**File**: `evals/promptfooconfig.yaml` (`defaultTest.options.provider`)

**Intent**: An independent grader for the model-graded assertions.

**Contract**: `openrouter:google/gemini-3.8-flash`. Chosen for two reasons: it is a **fourth vendor**,
so it grades none of its own siblings (Anthropic, Z-AI and DeepSeek are all under test), and its
provider id cannot collide with the `file://` ids of the systems under test — a matching id triggers
`RangeError: Maximum call stack size exceeded` (promptfoo issue #10501). All judge calls in a sweep
come to roughly $0.05.

#### 3. Per-flaw recall assertions

**File**: `evals/cases.ts` (assertions generated per flaw)

**Intent**: One `llm-rubric` per planted flaw, each a **named metric**, so the matrix shows *which*
flaw each model missed rather than a single aggregate. A model that finds the XSS and misses the
`defaultProps` semantics break tells you something specific; a bare "2/3" does not.

**Contract**: For each entry in `case.json`'s `flaws[]`, the generator emits an `llm-rubric`
assertion whose `value` is built from `whatIsBroken` and whose `metric` is the flaw's `id`. The
rubric asks whether the review's `findings[]` (or `summary`) identifies **this specific defect and
its consequence** — not whether it mentions the API name, which a model could satisfy by listing
every changed line. Each is scored, not gating; the suite threshold comes from Phase 4.

Because the reviewer is instructed to cite file and 1-indexed line, the rubric may treat a finding
anchored far from the flaw's recorded line as weaker evidence — but location is not the primary
criterion, since a correct diagnosis attached to the wrong line is still a caught bug.

#### 4. Decoy precision assertion

**File**: `evals/cases.ts`

**Intent**: Penalise false positives. A recall-only eval rewards a model that flags everything, and
that is exactly the model you least want gating merges — `calibration.md`'s two worst recorded
outcomes were one false negative *and* one false positive.

**Contract**: One `llm-rubric` carrying all three `decoys[].whyItIsCorrect` statements, failing when
the review files any of them as a defect. Its `metric` is `precision`. Per the answers, this one
**does** gate: a review that calls correct React 19 code a bug has failed at its job regardless of
what else it found.

#### 5. Derived recall metric

**File**: `evals/promptfooconfig.yaml`

**Intent**: A single comparable number per cell alongside the per-flaw detail.

**Contract**: A `derivedMetrics` entry summing the three flaw metrics into `flaw-recall` (0-3). No
threshold on it yet — Phase 4 sets that from observed data.

### Success Criteria

#### Automated Verification

- `npm run evals` completes all three cells and exits 0 or 100 (100 is promptfoo's "assertions failed", not a crash)
- The report shows three distinctly labelled columns
- All four named metrics (`flaw-1`, `flaw-2`, `flaw-3`, `precision`) are populated for every cell
- `flaw-recall` is derived and present per cell
- No `RangeError` from grader/SUT id collision
- `npm run lint` and `npm run typecheck` still pass

#### Manual Verification

- Total sweep cost is in the expected range (~$1.70 for the three reviews plus ~$0.05 of judging)
- Spot-check one judge verdict per flaw against the actual review text — the judge is credible, not rubber-stamping
- The three models produce visibly different reviews (if all three are near-identical, the case is too easy to discriminate)
- No cell fails on a deterministic gate for a reason that is actually a provider bug

**Implementation Note**: Pause for manual confirmation before Phase 4. Specifically: read one full
review from the cheapest model and one from Sonnet side by side. If the judge's scores do not match
your own reading, the rubric prose needs fixing before any threshold is calibrated against it.

---

## Phase 4: Calibrate Thresholds and Record the Baseline

### Overview

Run the sweep with repeats, turn the observed numbers into a threshold, and write the result down in
the form this repo already uses for exactly this kind of record.

### Changes Required

#### 1. Repeated sweep and the baseline record

**File**: `context/changes/cr-evals/baseline.md`

**Intent**: `context/archive/2026-09-07-ci-cd-code-review/calibration.md` is the house format for
"here is what the reviewer actually did, run by run, with a human's read on it", and it is the single
most-cited artifact in the research doc. The eval's first sweep belongs in the same shape.

**Contract**: `npx promptfoo eval -c evals/promptfooconfig.yaml --repeat 3 -o results.json`, then a
table with one row per cell per repeat: model, flaw-recall, per-flaw hit/miss, precision, verdict,
steps, tokens, cost, latency — plus a prose section on what the numbers mean and where the three
models actually diverged. The generated `results.json` is a run artifact, not a committed one; add
it to `.gitignore` alongside the other generated outputs.

#### 2. Calibrated threshold

**File**: `evals/promptfooconfig.yaml`

**Intent**: Set the recall bar from data. A threshold guessed before the first run either passes
everything or fails everything, and in both cases stops discriminating.

**Contract**: A `defaultTest.threshold` (or an `assert-set` around the three flaw metrics) set from
the observed spread, with a comment in the YAML recording the sweep it was derived from and the
date — so a future reader knows the number is empirical rather than aspirational.

#### 3. Settle the caching question

**File**: `evals/README.md`

**Intent**: Research open question #3 — "Are custom `file://` providers cached?" — is answerable for
free as a side effect of `--repeat 3`. Recording the answer removes a standing unknown from the cost
model before the corpus grows to a size where it matters.

**Contract**: Compare the cost and latency of repeats 2 and 3 against repeat 1 in `results.json`. If
they are identical and instant, responses are cached; if they are full price, they are not. Write the
observed answer into the README's cost section, with the evidence. No `fetchWithCache` wrapper is
built either way — at ~$1.70 a sweep it does not pay for itself, and the note is what a future
10-case suite needs.

#### 4. Final documentation

**File**: `evals/README.md`, `context/changes/cr-evals/change.md`

**Intent**: Leave the harness usable by someone who was not here.

**Contract**: README gains the calibrated numbers, the cost per sweep, the caching finding, and an
explicit "what this does not measure" section (one case, one rubric, no CI wiring — see *What We're
NOT Doing*). `change.md` moves to `status: implemented`.

### Success Criteria

#### Automated Verification

- `npx promptfoo eval --repeat 3` completes 9 cells without a crash or a hung cell
- `results.json` is written and contains per-repeat cost and latency
- The calibrated threshold produces a mixed result (at least one cell passing and one failing) rather than a uniform sweep
- `results.json` is gitignored; `git status` is clean after a run
- `npm run lint`, `npm run typecheck`, `npm test` pass

#### Manual Verification

- `baseline.md` lets a reader who was not present reconstruct what happened, in the style of `calibration.md`
- The three models are genuinely separated by the numbers — the matrix answers "can I swap Sonnet for something cheaper"
- Run-to-run variance across the three repeats is visible and is discussed, not hidden behind an average
- The caching finding is stated with its evidence

**Implementation Note**: This phase's real output is a decision, not code. If the numbers show the
cheap models matching Sonnet on this case, that is a finding worth acting on separately; if they do
not, `baseline.md` should say by how much and on which flaw.

---

## Testing Strategy

The harness is itself a testing artifact, so "testing" here means the gates that keep it honest.

### Deterministic (no model in the loop)

- `case.diff` regenerates byte-identical from `before/` + `after/`
- `case.json` line references resolve to real lines in `after/`
- `npm run lint`, `npm run typecheck`, `npm test` stay green with the fixture present
- The husky pre-commit hook passes on a staged fixture
- `deriveVerdict` behaviour on a review is checkable without any model at all — hand-write a fake
  `Review` object and confirm the assertion helpers classify it correctly

### Model-in-the-loop

- Phase 2's single cheap cell is the integration test for the provider
- Phase 3's three cells are the actual measurement
- Phase 4's `--repeat 3` measures the non-determinism, which per research is **discovery, not noise**:
  a run that finds a defect another missed *should* score differently, and the report must let that
  be read as discovery rather than flakiness

### Manual

1. Read all three decoys and confirm each is correct under React 19
2. Read one full review per model and compare against your own reading of the diff
3. Spot-check one judge verdict per flaw
4. Confirm step counts show real tool use

## Performance Considerations

Latency, not throughput, is the constraint: each cell is a full 20-step agent loop over a 200-line
diff. Three cells run concurrently under promptfoo's default concurrency, so a sweep is roughly the
latency of its slowest model rather than the sum. The provider's own `AbortSignal` timeout bounds a
hung cell — the specific failure `calibration.md` run 5 recorded, where a cancelled job left the PR
green because a cancellation is not a failure.

`latency` assertions are deliberately not used: promptfoo issue #10595 makes them unreliable when
caching is in play, and the caching question is not settled until Phase 4.

## Migration Notes

Nothing to migrate. The one externally visible change is `.nvmrc` moving from `22.14.0` to `22.23.2`,
which every other tool in the repo tolerates — CI already pins `node-version: 22` and resolves above
the new floor, and `packages/code-reviewer`'s own `engines: >=22.14.0` is unaffected because it does
not depend on promptfoo.

## References

- Research: `context/changes/cr-evals/research.md` — tool survey, seam inventory, the case against promptfoo
- Prior art, the same call site in production: `scripts/pr-review.mjs:233-241`
- The policy under test: `scripts/pr-review/rubric.mjs:47`, `scripts/pr-review/verdict.mjs:45`
- The deferral this change closes: `context/archive/2026-09-02-tool-loop-agent/plan.md:88-89`
- The house format for `baseline.md`: `context/archive/2026-09-07-ci-cd-code-review/calibration.md`
- The standing cost×signal rule: `context/foundation/test-plan.md:25-29`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Case Fixture, Diff, and Answer Key

#### Automated

- [x] 1.1 `npm run lint` passes with the fixture present — 66b12f0
- [x] 1.2 `npm run typecheck` (`astro check`) passes with the fixture present — 66b12f0
- [x] 1.3 `npm test` passes (fixture outside the vitest include set) — 66b12f0
- [x] 1.4 `npm run format` leaves `evals/cases/` byte-identical — 66b12f0
- [x] 1.5 `npm run evals:diff` on an unchanged fixture leaves the working tree clean — 66b12f0
- [x] 1.6 `case.json` parses and every flaw/decoy `file` resolves under `after/` — 66b12f0
- [x] 1.7 The husky pre-commit hook passes when the fixture is staged — 66b12f0

#### Manual

- [x] 1.8 Each of the three decoys is genuinely correct under React 19 — 66b12f0
- [x] 1.9 Each of the three flaws is genuinely broken and independently discoverable — 66b12f0
- [x] 1.10 `case.diff` reads as a plausible PR, not a puzzle — 66b12f0
- [x] 1.11 The `after/` tree looks like it belongs in this repo — 66b12f0

### Phase 2: promptfoo Install, Custom Provider, Single-Model Smoke

#### Automated

- [x] 2.1 `node -v` reports `>=22.22.0` after the `.nvmrc` bump — 271a341
- [x] 2.2 `npm run lint` and `npm run typecheck` pass with the provider and generator typechecked — 271a341
- [x] 2.3 `npm run evals` builds the package and exits 0 on a green run — 271a341
- [x] 2.4 The run's `Review` satisfies all four deterministic assertions — 271a341
- [x] 2.5 `metadata` carries steps, `finishReason`, and non-zero `tokenUsage` / `cost` — 271a341

#### Manual

- [x] 2.6 Reported cost for the single cell is cents, not dollars — 271a341
- [x] 2.7 `promptfoo view` renders the cell and the review JSON is readable — 271a341
- [x] 2.8 A forced failure produces a legible red with an `errorCode` — 271a341
- [x] 2.9 Step count shows the agent actually used its tools — 271a341

### Phase 3: Three-Model Matrix, LLM Judge, and Precision Penalty

#### Automated

- [x] 3.1 `npm run evals` completes all three cells and exits 0 or 100 — ac5ec6f
- [x] 3.2 The report shows three distinctly labelled columns — ac5ec6f
- [x] 3.3 All four named metrics are populated for every cell — ac5ec6f
- [x] 3.4 `flaw-recall` is derived and present per cell — ac5ec6f
- [x] 3.5 No `RangeError` from grader/SUT id collision — ac5ec6f
- [x] 3.6 `npm run lint` and `npm run typecheck` still pass — ac5ec6f

#### Manual

- [x] 3.7 Total sweep cost is in the expected range (~$1.75) — ac5ec6f
- [x] 3.8 Spot-checked judge verdicts are credible, not rubber-stamping — ac5ec6f
- [x] 3.9 The three models produce visibly different reviews — ac5ec6f
- [x] 3.10 No cell fails a deterministic gate because of a provider bug — ac5ec6f

### Phase 4: Calibrate Thresholds and Record the Baseline

#### Automated

- [x] 4.1 `--repeat 3` completes 9 cells without a crash or a hung cell
- [x] 4.2 `results.json` is written with per-repeat cost and latency
- [x] 4.3 The calibrated threshold produces a mixed result, not a uniform sweep
- [x] 4.4 `results.json` is gitignored; `git status` clean after a run
- [x] 4.5 `npm run lint`, `npm run typecheck`, `npm test` pass

#### Manual

- [x] 4.6 `baseline.md` is reconstructable by a reader who was not present
- [x] 4.7 The three models are genuinely separated by the numbers
- [x] 4.8 Run-to-run variance is visible and discussed, not averaged away
- [x] 4.9 The caching finding is stated with its evidence
