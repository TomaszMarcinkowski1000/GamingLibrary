---
date: 2026-09-08T19:42:13+02:00
researcher: Tomasz Marcinkowski
git_commit: b64b1bfeeb080687c4fe40bf848c3b2885cc6630
branch: plan/cr-evals
repository: GamingLibrary
topic: "Eval harness for packages/code-reviewer — is promptfoo the right tool for this stack, and what is actually evaluable today"
tags: [research, codebase, evals, promptfoo, code-reviewer, ai-sdk, openrouter, ci-cd]
status: complete
last_updated: 2026-09-08
last_updated_by: Tomasz Marcinkowski
---

# Research: Eval harness for `packages/code-reviewer`

**Date**: 2026-09-08T19:42:13+02:00
**Researcher**: Tomasz Marcinkowski
**Git Commit**: `b64b1bfeeb080687c4fe40bf848c3b2885cc6630`
**Branch**: `plan/cr-evals`
**Repository**: GamingLibrary

## Research Question

Analyse the current state of `packages/code-reviewer` in the context of introducing evals —
reusability of prompts, importability of the agent, and what seams already exist. First pick for the
eval toolkit is **promptfoo**; confirm the stack is aligned with it, and if not, survey other OSS
tools for evaluating prompts and agents.

**Scope decided with the user before research** (`AskUserQuestion`, this session):

- **Eval target**: the **full agent loop** — run the reviewer end-to-end with its real tools against
  fixture inputs, not single-turn prompt scoring.
- **Cost model**: **live model calls, small case set, on demand** — not on every push. Caching to
  keep re-runs cheap.

## Summary

1. **Go with promptfoo — the stack is aligned.** It is MIT, it loads TypeScript providers natively
   (bundles `tsx`), OpenRouter is first-class, and its `trajectory:*` assertions normalise Vercel AI
   SDK tool-call span attributes (`ai.toolCall.name`, `ai.toolCall.args`, …), which suits the
   "full agent loop" scope chosen. The deciding argument is not feature count, though: **this
   repo's dominant open question is a matrix problem** — `calibration.md` is nine hand-driven runs
   comparing sonnet vs glm-4.7, strict vs non-strict, temperature on vs off. That is exactly what
   promptfoo owns and what every runner-up lacks. See §G for the honest case against.

2. **The system under test is not the package.** `packages/code-reviewer` is a *generic* reviewer:
   its `REVIEW_INSTRUCTIONS` name no criteria at all, and `criterionScoreSchema.id` is deliberately
   a free string because "which criteria a review has is the caller's rubric, not the package's
   business" (`src/schemas/criterion.ts:9-13`). The five criteria, their scoring anchors and the
   pass/fail thresholds live in `scripts/pr-review/rubric.mjs` and `scripts/pr-review/verdict.mjs`.
   **What ships — and therefore what must be evaluated — is the composition**
   `REVIEW_RUBRIC → reviewCode({extraInstructions}) → deriveVerdict()`. An eval that drives the
   package with its bare default instructions measures nothing that runs in CI.

3. **The package was built for this, on purpose, and it shows.** `plan-brief.md:11` of the
   originating change states the export shape exists "so promptfoo evals can drive it with an
   injected model later", and the harness itself was explicitly scoped out. The seams are real and
   still hold: pure side-effect-free barrel, injected `LanguageModel`, exported prompt constant,
   zod-validated output, injectable `env`, and `temperature`/`stepBudget` knobs.

4. **One API gap blocks the most valuable assertions.** `reviewCode` returns only the `Review`
   object — `result.steps`, token usage and `finishReason` are discarded at
   `src/agent/review-code.ts:91`. This is not theoretical: the calibration table's `steps` column is
   literally `n/r` for **every** recorded run because nothing surfaces it. Either the eval provider
   drops to `createReviewAgent` and reads the result itself, or `reviewCode` grows a metadata
   return.

5. **Half the dataset already exists.** `calibration.md` records 9 live runs with human verdict
   labels, and **6 of its 7 head SHAs are reachable in this worktree**, so those cases are
   replayable through the existing `collectInputs({baseSha, headSha})` path.

6. **The metric is verdict agreement with a human label — not score stability.** This is settled,
   not open: calibration runs 7 and 8 scored the same SHA `4` then `3` across the gate, and the flip
   was *correct* — run 8 found a real deletion-bypass bug run 7 missed. The record's own conclusion:
   "Demanding score stability from such a reviewer is close to demanding it stop discovering."

7. **Three prerequisites, none of them optional.** Node floor (`>=22.22.0` vs `.nvmrc` at
   `22.14.0`), the package must be `npm ci && npm run build`-ed before any provider can import it,
   and **custom `file://` providers appear not to be auto-cached** — meaning `--repeat` re-hits
   OpenRouter at full price unless the provider calls `promptfoo.cache.fetchWithCache` itself.

## Detailed Findings

### A. What is actually under test

The live path, end to end:

| Stage | Lives in | Role |
|---|---|---|
| Input assembly | `scripts/pr-review/inputs.mjs` | `git diff` + changed-path filtering → `{paths, deleted, diff, excluded, truncated}` |
| Policy prose | `scripts/pr-review/rubric.mjs:47` | 268 lines: five criteria, band anchors, output contract |
| Agent run | `packages/code-reviewer` | `reviewCode({model, rootDir, paths, title, description, diff, extraInstructions})` |
| Verdict | `scripts/pr-review/verdict.mjs:45` | pure function of `criteria[]` → `passed`/`failed` |
| Rendering | `scripts/pr-review/comment.mjs` | markdown PR comment |

The call site an eval provider must reproduce is `scripts/pr-review.mjs:233-241`:

```js
review = await reviewCode({
  model,
  rootDir: process.cwd(),
  paths, title, description: body, diff,
  extraInstructions: REVIEW_RUBRIC,
  ...(temperature === undefined ? {} : { temperature }),
});
```

`deriveVerdict` is the single most valuable eval observable, because it is **deterministic given
`criteria[]`** and it is what gates the merge. Ground truth per case is therefore a boolean plus
expected criterion bands — which makes `javascript` assertions against an answer key the primary
tool, and `llm-rubric` a secondary one reserved for free-text `detail`/`suggestion` quality.

Note also that `deriveVerdict` **throws** when the criteria set is not exactly the five expected
(`verdict.mjs:52-68`). That is a distinct, assertable failure mode: schema-valid output that is
still policy-invalid.

### B. Eval seams that already exist

These are unusually good, and they are deliberate rather than accidental:

- **Pure barrel.** `src/index.ts:1-13` exports only. The package README states it plainly:
  "importing the package reads no environment, touches no `.env`, and constructs nothing … That is
  what lets an eval harness import this package from an unrelated directory."
- **Injected model.** `createReviewAgent({model})` (`src/agent/create-agent.ts:41`) takes any AI SDK
  `LanguageModel`. Comment at `:38-40`: "Required rather than derived from `loadConfig()`, which is
  what lets an eval harness drive this package with a mock model and no OpenRouter credential."
- **Injectable environment.** `loadConfig(env)` (`src/config.ts:35`) skips the `.env` file entirely
  when handed an explicit env — "no hidden side effect on the real `process.env`."
- **Prompt as a named constant.** `REVIEW_INSTRUCTIONS` sits alone in `src/prompts/instructions.ts`
  "so prompt variants can be diffed and evaluated without touching the agent that consumes them."
- **Pure prompt builder.** `buildReviewPrompt` (`src/prompts/review-request.ts:27`) is "a pure
  function of its input, so the prompt shape can be asserted on without a model in the loop."
- **Schema-validated output.** `reviewSchema` (`src/schemas/review.ts:5-11`) means no free-text
  parsing in assertions, and `z.toJSONSchema()` can emit a JSON Schema for promptfoo's `is-json`.
- **Determinism and cost knobs.** `temperature` (`create-agent.ts:54`, "pin it low for reproducible
  eval runs"), `stepBudget`, and `createModel(config, {provider})` exposing OpenRouter `max_price`
  as "a per-request cost wall" (`src/model.ts:8-13`).
- **Typed failure modes.** `ReviewError` with `code: "no-output-generated" | "step-budget-exhausted"`
  (`src/errors.ts:6`) — an eval can distinguish "bad review" from "no review".
- **Per-case sandbox root.** `createReviewTools({rootDir})` and `createPathGuard`
  (`src/tools/paths.ts:79`) are exported, so a fixture repo per case is a one-liner — and the path
  guard is itself directly testable for prompt-injection escape attempts.
- **An offline dry-run already exists.** `node scripts/pr-review.mjs --dry-run` "imports nothing
  from the package and constructs no model, so it runs offline, with no cost" — it prints the
  filtered path set and prompt shape. Free regression coverage for the input-assembly half.

### C. Gaps that the eval work has to close

1. **Run metadata is discarded.** `review-code.ts:91` returns `result.output` and nothing else. For
   the chosen full-agent-loop scope, steps / tool calls / usage / `finishReason` are exactly the
   signal. Two options: (a) the provider calls `createReviewAgent` + `agent.generate()` directly and
   reads `result.steps` / `result.usage`; (b) `reviewCode` returns `{review, meta}`. Option (a)
   keeps the package untouched but duplicates the `reviewCode` body — including its `ReviewError`
   mapping, which is non-trivial (`review-code.ts:78-108`). Option (b) is the smaller long-term
   surface and would also fix the `n/r` step column in calibration.
2. **The package has zero tests.** No test script, no test files, no runner. This was named as a
   known tension at the time: "A reviewer whose hard blocker is test falsifiability, shipping with
   no falsifiable tests, is a tension worth naming out loud." Note this is *not* the eval layer's
   job to fix — unit tests for `deriveVerdict`, `collectInputs` and `createPathGuard` are cheap,
   deterministic and belong in vitest, not in promptfoo.
3. **No fixture corpus with an answer key.** Nothing in the repo pairs a diff with "the defect is at
   `file:line`, severity X, and the correct verdict is Y". This is the bulk of the work and it is
   **tool-independent** — the corpus outlives any choice of harness.
4. **`temperature` is a dead knob on the shipping model.** `pr-review.mjs:41-56` records that not
   one of Sonnet's nine OpenRouter endpoints declares `temperature` support, and sending it with
   `require_parameters: true` fails the request outright (calibration run 6, 14 seconds, $0).
   Determinism must come from `--repeat N` and pass-rate thresholds, never from a temperature pin.
5. **The package is isolated from every root gate.** `eslint.config.js` has
   `{ ignores: ["packages/**"] }`, root `tsconfig.json` excludes `packages`, root `vitest.config.ts`
   includes only `src/**/*.test.ts` and `*.test.ts`. The husky pre-commit hook therefore does
   effectively nothing for files under `packages/code-reviewer`. Whatever the eval harness is, it
   needs its own install and its own gates — as the `packages` job in `ci.yml` already does.

### D. promptfoo fit — verified against live sources

Version **0.122.2**, MIT, `engines: { node: ">=22.22.0" }` (npm registry, fetched 2026-09-08).

**What lands well:**

- **TypeScript providers work natively.** `src/esm.ts` registers the `tsx` loader on any
  `.ts`/`.mts`/`.cts` module path, and `tsx` is promptfoo's own dependency. No build step for the
  provider itself.
- **`trajectory:*` assertions understand the Vercel AI SDK.** From the tracing docs: promptfoo
  recognises "framework-specific ones such as Vercel AI SDK's `ai.toolCall.name`,
  `ai.toolCall.args`, `ai.toolCall.arguments`, and `ai.toolCall.input`", and it runs its own OTLP
  receiver (port 4318) so no external collector is needed. **Mind the v7 wiring**: AI SDK 7 moved
  span collection out of `ai` into [`@ai-sdk/otel`](https://www.npmjs.com/package/@ai-sdk/otel) and
  replaced the per-call `tracer` with a global `registerTelemetry(new OpenTelemetry())` at startup;
  `experimental_telemetry` survives only as a deprecated alias for `telemetry`. Every promptfoo
  example still shows the pre-v7 form. With that wired, the tool loop becomes assertable:

  ```yaml
  assert:
    - type: trajectory:tool-used
      value: { pattern: 'read_file', min: 1 }
    - type: trajectory:step-count
      value: { type: tool, max: 12 }     # convergence, not budget exhaustion
    - type: trajectory:tool-args-match
      value: { name: read_file, mode: partial, args: { path: 'scripts/pr-review/verdict.mjs' } }
  ```

  The provider must also propagate the W3C `traceparent` it receives (issue #10518 is a live example
  of exactly that being forgotten).

- **OTel is an upgrade, not a prerequisite — and this is the key de-risking move.** Assertions also
  receive `context.providerResponse.metadata`. So the provider can simply return
  `metadata: { steps, toolCalls, usage, finishReason }` read straight off `agent.generate()`, and a
  plain `javascript` assertion checks convergence and tool discipline with **no tracing stack at
  all**. Start there; add `trajectory:*` only if the richer vocabulary earns its wiring. This
  collapses the main practical objection to promptfoo for this SUT.
- **OpenRouter is first-class** (`openrouter:anthropic/claude-sonnet-5`) — useful for the
  *grader*, though the system under test goes through the custom provider.
- **Structured output is easy.** `output` may be a structured object, and a `javascript` assertion
  receives it already parsed. `is-json` accepts a JSON Schema from a file, which
  `z.toJSONSchema(reviewSchema)` can emit at build time.
- **Named metrics + weights + `derivedMetrics`** map cleanly onto per-criterion scoring, and
  `assert-set` groups assertions under their own threshold.
- **CI story is adequate**: exit code `100` on failures, `-o results.json`, `--repeat N`,
  `--filter-pattern`, and a `promptfoo/promptfoo-action@v1` that posts PR comments.
- **The free tier covers this.** Local eval and `promptfoo view` stay free; Enterprise gates team
  sharing, RBAC/SSO, monitoring and probe limits beyond 10k/month.
- **There is a guide for almost exactly this use case**:
  [Evaluate Coding Agents](https://www.promptfoo.dev/docs/guides/evaluate-coding-agents/) — structured-output
  audit, `javascript` assertion parsing findings, cost/latency thresholds, `--repeat 3` for
  non-determinism.

**What does not land, and must be designed around:**

- **`file://provider.ts:ClassName` is NOT supported for JS/TS providers.** `registry.ts:1472-1491`
  calls `importModule(modulePath)` with no function name. The provider must be a **default-exported
  class** implementing `id()` and `callApi()`. (`:functionName` *does* work for assertions,
  transforms and test generators — just not providers.)
- **The prompt argument is a poor fit.** promptfoo's model is `prompts × providers × tests`, and our
  input is not a prompt string but `{baseSha, headSha}` → paths + diff. The case identity has to
  travel in `context.vars`, with the `prompt` reduced to a serialised case descriptor. This is
  normal practice for agent providers, but it means the prompt-matrix headline feature only applies
  to whatever the provider threads through — e.g. rubric variants passed as a var and forwarded as
  `extraInstructions`.
- **Custom providers appear not to be auto-cached** (issues #922 / #1667; docs silent). With the
  chosen "live, small, on-demand" cost model and `--repeat N` for flakiness measurement, this is the
  single biggest practical gotcha: **budget for it explicitly**, either by calling
  `promptfoo.cache.fetchWithCache` inside the provider or by accepting full cost per repeat.
- **`latency` assertions are unreliable with caching on** (#10595), and there is **no built-in
  "compare to last run and fail on regression"** — the documented pattern is to parse `results.json`
  and compare yourself.
- **Give the grader a distinct provider id** from the system under test — a matching id triggers a
  `RangeError: Maximum call stack size exceeded` (#10501, regression in 0.121.13).
- **Node floor.** `>=22.22.0`, against `.nvmrc` pinned at `22.14.0` and CI on `node-version: 22`.
  The CI matrix will resolve to a current 22.x and be fine; the local `.nvmrc` needs a bump.

### E. Dataset — what exists and what is replayable

`context/archive/2026-09-07-ci-cd-code-review/calibration.md` is a 9-row table with columns
`PR / head SHA / model / temp / paths / steps / scores / verdict / on the verdict`, the last being a
human judgement (agreed / false positive / false negative). Reachability checked in this worktree:

| head SHA | reachable | outcome recorded |
|---|---|---|
| `04055d95` | yes | run 1 passed (agreed), run 2 failed (**false negative**) |
| `70a7dae2` | yes | `no-output-generated` (glm-4.7) |
| `e9cbff02` | **missing** | `no-output-generated` (glm-4.7) |
| `24f59b04` | yes | cancelled at job timeout — **left the PR green** |
| `0b073e09` | yes | no eligible endpoint (temperature pin), 14s, $0 |
| `0dc4e88e` | yes | run 7 passed (agreed), run 8 failed (**agreed — found a real bug**) |
| `30203f6e` | yes | run 9 passed (agreed) |

Six of seven are replayable through `collectInputs({baseSha, headSha})` without touching the
network. That is a real seed corpus of *hard* cases — including the one same-SHA pair that produced
opposite verdicts for the wrong reason (runs 1/2) and the pair that produced opposite verdicts for
the right reason (runs 7/8). Any harness that cannot tell those two pairs apart is not measuring
what matters.

Cost anchor from the same record: "Runs 1 and 2 cost ~$1.50 each on `anthropic/claude-sonnet-5`."
A 10-case suite at `--repeat 3` is therefore roughly **$45 per full sweep** — which is precisely why
the chosen cost model is on-demand rather than per-push, and why the caching gotcha in §D matters.

### F. The second prompt surface, and the precedent it sets

`packages/code-reviewer` is not the repo's only model call. `src/lib/services/vision.ts` holds a
`PROMPT` constant, a zod `modelOutputSchema`, a strict `json_schema` response format, and a
`CONFIDENCE_THRESHOLD = 0.6` abstain gate. And `scripts/identify-harness.mjs` is **already a
hand-rolled eval harness** for it: a labelled CSV (`fixtures/shelf/labels.example.csv` with
`filename,true_title,true_platform,angled,true_igdb_id`), accuracy-when-answered against an FR-005
≥90% bar, abstain rate, latency p50/p95, and an angled-vs-straight split, emitting `report.json`.

Two consequences:

1. There is precedent in this repo for measuring a prompt against a labelled dataset — the eval
   layer is not a new idea here, only a new *tool*.
2. Whatever is chosen should be able to absorb `identify-harness.mjs` later. promptfoo can: a second
   provider wrapping `identifyGameFromPhoto`, tests generated from the CSV via
   `tests: file://cases.ts:generate`, and `derivedMetrics` for accuracy/abstain. Not in scope for
   this change, but it should not be foreclosed.

### G. Alternatives considered, and the honest case against promptfoo

The brief was "promptfoo if the stack aligns, otherwise survey OSS alternatives". It aligns — but the
survey turned up one genuine rival and one landmine, so both are recorded rather than buried.

**Context that reframes the field:** AI SDK 7 (2026-06-25) changed the provider interface to
`LanguageModelV4` and moved OTel into `@ai-sdk/otel`. Most TS eval tooling still integrates against
v5/v6.

| Tool | Calls our code? | `ai@7` | Trajectory scoring | Runs in vitest | New CI secret | Health |
|---|---|---|---|---|---|---|
| **promptfoo** 0.122.2 | ✅ TS provider | ✅ (nests `ai@6` in its own tree) | ✅ via OTel | ⚠️ assertions importable only | ❌ reuses OpenRouter | 🟢 weekly, MIT, 24.9k★ |
| **DeepEval (TS)** 0.9.15 | ✅ in-process | ✅ peer `>=5.0.0` | ✅ deterministic + LLM | ✅ native | ❌ `OpenRouterModel` | 🟢 daily, backlog growing, pre-1.0 |
| **Mastra evals** 1.10.0 | ✅ `scorer.run()` | ✅ (`@mastra/core` has no `ai` dep) | ✅ **best catalog**, zero-LLM | ⚠️ peers vitest `<5` | ❌ | 🟢 daily |
| **Evalite** | ✅ `task` | ❌ **peer `ai@^6`** | ⚠️ v6-typed | ⚠️ pins vitest 4 | ❌ | 🔴 **stalled** |
| **autoevals** 0.3.0 | ❌ scorers only | n/a | ❌ | manual | ❌ | 🟡 stable, low churn |
| **Langfuse** | ✅ `experiment.run` | ✅ **explicit v7 peer** | ✅ OTel spans | ❌ | ✅ 3 keys | 🟢 very active |
| **Inspect AI / Ragas / OpenAI Evals** | — | ❌ Python | — | ❌ | — | 🟢 / 🔴 / 🔴 **dead** |

**The landmine: Evalite is the obvious-looking choice and it is stalled.** vitest-based, AI-SDK-native,
MIT — exactly the shape this repo would reach for. But stable `0.19.0` (2025-11-06) depends on
`@ai-sdk/provider@^2` (the v5 interface), the `1.0.0-beta` line peers `ai: "^6"` and types against
`LanguageModelV3`, [issue #400 "Support for AI SDK v7"](https://github.com/mattpocock/evalite/issues/400)
has been open since 2026-06-29, `main` has not moved since 2025-11-10, and
[issue #405 "Is this still an active project"](https://github.com/mattpocock/evalite/issues/405)
(2026-08-13) has no maintainer reply. Adopting it means pinning `ai@6`. **Rejected.**

**The real rival: DeepEval's TypeScript SDK.** No longer Python-only — `deepeval@0.9.15` is
"The LLM Evaluation Framework for TypeScript", runs *as vitest*
(`import "deepeval/vitest"`, `await expect(testCase).toPass([metric])`), peers `ai: ">=5.0.0"`
(so v7 satisfies it), needs no server, and its `OpenRouterModel` reads the `OPENROUTER_API_KEY`
already wired into `ai-code-review.yml`. It ships `ToolCorrectnessMetric` (deterministic, no LLM
call), `TaskCompletionMetric`, `StepEfficiencyMetric`, `GEval`. Its pitch is precise: our SUT is a
*function call*, `reviewCode({model, rootDir, paths})`, and promptfoo's provider entry point is
`callApi(prompt: string, context)` — so the case identity has to travel as vars and be unwrapped in
a shim.

**Why promptfoo still wins here, on this repo's evidence:**

1. **The open question is a matrix question.** `calibration.md` is nine manual runs comparing models
   and provider configs, and its unresolved option 3 — "reduce discovery variance by … a larger step
   budget … Costs money per run and is unproven here" — is a sweep over `stepBudget`. promptfoo runs
   `providers × tests` natively with a side-by-side report; DeepEval has no equivalent and Mastra
   none at all.
2. **The impedance mismatch is mild.** `context.vars` carries the case; the `prompt` degrades to a
   case descriptor. Awkward, not costly.
3. **Project health.** DeepEval's TS SDK is pre-1.0 with 111 issues opened against 31 closed in 90
   days, and its AI SDK integration is documented only against `ai==6.0.97` using the pre-v7 tracing
   pattern. promptfoo ships weekly against a stable API.
4. **The one-way door is the corpus, not the tool.** Fixtures plus an answer key are plain data;
   `deriveVerdict` is a pure function. Switching runners later is a provider rewrite, roughly a day.

**Where this conclusion would flip:** if the question becomes "did this PR regress the reviewer"
rather than "which model/config reviews best", DeepEval belongs next to the existing vitest suite
and promptfoo becomes a parallel YAML universe for no gain. Worth revisiting once the corpus exists.

**Worth stealing regardless of runner:** Mastra's `createToolCallAccuracyScorerCode` and
`createTrajectoryAccuracyScorerCode` are **deterministic, zero-LLM** trajectory scorers, and
`@mastra/core` carries no `ai` dependency at all (it aliases `@ai-sdk/provider-v5/v6/v7` side by
side), so it cannot fight the `ai@^7` pin. If `trajectory:*` wiring proves painful, these are
importable into a `javascript` assertion.

**One trap for whichever runner is chosen:** `test/setup/no-network.ts` installs a deny-all `fetch`
for every root vitest run. Any suite that makes live model calls must be a **separate vitest project
or config**, not an addition to the existing one.

### H. Where the harness should live

Constraints that decide this:

- The provider must import **both** `packages/code-reviewer/dist/index.js` (built output — `main`,
  `types` and `exports` all point at `dist/`) **and** `scripts/pr-review/{rubric,verdict,inputs}.mjs`
  (repo policy, outside the package).
- Putting evals inside `packages/code-reviewer` would invert the dependency: the generic package
  would reach up into repo-specific policy. That is precisely the separation
  `src/schemas/criterion.ts:9-13` was written to preserve.
- Root `eslint`/`tsconfig`/`vitest` all exclude `packages/**` but **do** cover the root tree.

**Recommendation: a root-level `evals/` directory with promptfoo as a root devDependency.** It
mirrors exactly how `scripts/pr-review.mjs:40` already reaches into the package
(`new URL("../packages/code-reviewer/dist/index.js", import.meta.url)`), keeps the provider under
root lint/typecheck, and adds no third standalone npm project. The pre-build step (`npm ci &&
npm run build` in `packages/code-reviewer`) is the same one the composite action already performs at
`.github/actions/ai-code-review/action.yml:154-162`.

## Code References

- `packages/code-reviewer/src/index.ts:1-13` — the pure barrel; the import surface an eval uses
- `packages/code-reviewer/src/agent/create-agent.ts:41` — injected `LanguageModel` (the substitution seam)
- `packages/code-reviewer/src/agent/create-agent.ts:16` — `DEFAULT_STEP_BUDGET = 20`
- `packages/code-reviewer/src/agent/create-agent.ts:84-93` — last-step `toolChoice: "none"` safety net
- `packages/code-reviewer/src/agent/review-code.ts:91` — **returns `result.output` only; drops steps/usage**
- `packages/code-reviewer/src/agent/review-code.ts:99-107` — budget-exhausted vs no-output diagnosis
- `packages/code-reviewer/src/prompts/instructions.ts:6-26` — `REVIEW_INSTRUCTIONS`, names no criteria
- `packages/code-reviewer/src/prompts/review-request.ts:27` — pure `buildReviewPrompt`
- `packages/code-reviewer/src/schemas/review.ts:5-11` — `reviewSchema` (`summary`, `criteria[]`, `findings[]`)
- `packages/code-reviewer/src/schemas/criterion.ts:9-13` — why `id` is a free string, not an enum
- `packages/code-reviewer/src/model.ts:8-13` — OpenRouter `provider` routing / `max_price` cost wall
- `packages/code-reviewer/src/config.ts:35` — `loadConfig(env)` with injectable environment
- `packages/code-reviewer/src/tools/paths.ts:79` — `createPathGuard`, the containment rule
- `packages/code-reviewer/src/errors.ts:6` — the two `ReviewErrorCode` values
- `scripts/pr-review.mjs:40` — `PACKAGE_ENTRY` → `packages/code-reviewer/dist/index.js`
- `scripts/pr-review.mjs:233-241` — the live `reviewCode` call an eval provider must reproduce
- `scripts/pr-review.mjs:41-56` — why `temperature` is unset by default on Sonnet
- `scripts/pr-review/rubric.mjs:30-36` — `CRITERION_IDS`, the five-criterion contract
- `scripts/pr-review/rubric.mjs:47` — `REVIEW_RUBRIC`, passed as `extraInstructions`
- `scripts/pr-review/verdict.mjs:15-19` — thresholds: hard blocker ≤3, others ≤2
- `scripts/pr-review/verdict.mjs:45-68` — `deriveVerdict`, throws on an incomplete criteria set
- `scripts/pr-review/inputs.mjs` — `collectInputs({baseSha, headSha})`, the replay entry point
- `.github/actions/ai-code-review/action.yml:154-162` — install + build before invoking the package
- `.github/workflows/ci.yml` — the `packages` job (typecheck + build, no tests)
- `eslint.config.js` — `{ ignores: ["packages/**"] }`
- `src/lib/services/vision.ts` / `scripts/identify-harness.mjs` — the second prompt surface and its existing harness

## Architecture Insights

- **Generic engine, repo-specific policy.** The package knows a review *has* scored criteria; it
  does not know which five. That split is load-bearing and every eval decision should preserve it —
  it is what would let the package be reused, and what makes "which rubric" an eval *variable*
  rather than a code edit.
- **The verdict is derived in code, never asked of the model** (`verdict.mjs` header): "the rule
  becomes un-forgeable by prompt injection". This is a gift to evals — the most important observable
  is deterministic given the model's scores, so most assertions need no judge at all.
- **Non-determinism here is discovery, not noise.** The agent explores a 14-file diff with a 20-step
  budget and finds a varying subset. A run that discovers a blocking defect *should* score lower
  than one that misses it. The eval metric must therefore be **agreement with a human label across
  `--repeat N`**, reported as a pass rate, with disagreement triaged into "found more" vs "judged
  the same facts differently" — the exact distinction runs 1/2 and 7/8 illustrate.
- **Three independent cost walls already exist** — step budget, job timeout, OpenRouter `max_price`
  — and an eval harness inherits all three. It should also inherit the fourth lesson: calibration
  run 5 timed out and left the PR **green**, because a cancelled job is `bucket=cancel`, not a
  failure. Any eval runner needs its own bounded timeout below the job's.
- **Security posture is part of the SUT.** The tools are read-only and root-confined but *not*
  gitignore-aware; the action's header forbids creating `.env`/`.dev.vars` in the review job and
  forbids uploading the raw trace. An eval fixture that plants a fake secret in a sandbox root and
  asserts it never appears in `findings[].detail` is a legitimate, cheap case — and the path guard
  is directly unit-testable for escape attempts.

## Historical Context (from prior changes)

- `context/archive/2026-09-02-tool-loop-agent/plan-brief.md:11` — "The package exports a
  side-effect-free factory so promptfoo evals can drive it with an injected model later." The
  promptfoo direction is ~6 days old and was designed for, not retrofitted.
- `context/archive/2026-09-02-tool-loop-agent/plan-brief.md:27` — "Importing the package with no
  environment variables set succeeds and reads no `.env` — the invariant a promptfoo provider
  depends on." Verified still true (`src/index.ts` is exports-only).
- `context/archive/2026-09-02-tool-loop-agent/plan.md:88-89` — "Not configuring the eval
  environment. No promptfoo install, no config file, no eval cases, no provider adapter. This change
  only makes the package *shaped* for that later." This change is that later.
- `context/archive/2026-09-07-ci-cd-code-review/plan.md:104-105` — "Not adding a calibration corpus
  or an eval harness. Replaying the three PR #33 falsification diffs against the reviewer is a
  separate change." Also this change.
- `context/archive/2026-09-07-ci-cd-code-review/research.md:369-377` — the prior-art note on
  `anthropics/claude-code-action`: "a **complement (a harness), not a substitute** for
  schema-validated scores."
- `context/archive/2026-09-07-ci-cd-code-review/calibration.md` — the 9-run record; §"What runs 7
  and 8 established" is the single most important input to the eval metric design.
- `context/foundation/test-plan.md:25-29` — the standing cost×signal rule: "The cheapest test that
  gives a real signal for the risk wins." And `:128` — an "(optional) AI-native" layer was judged
  **not justified for the app**, because deterministic tests already covered the risk. That
  precedent does not block this work (the SUT here *is* a model), but it does set the bar: prefer
  deterministic assertions over model-graded ones wherever ground truth exists.

**One correction worth recording:** there is no artifact in this repository stating that OpenRouter
was chosen over `claude-code-action` for a course/10xChampion reason. The only in-repo comparison is
the technical prior-art note above. If that rationale matters to the plan, it needs to be written
down rather than cited.

## Related Research

- `context/archive/2026-09-07-ci-cd-code-review/research.md` — the CI wiring around this package
- `context/archive/2026-09-07-ci-cd-code-review/requirements.md` — where the five criteria and the
  ≤3 hard-blocker threshold were signed off
- `context/foundation/test-plan.md` — the app's layer taxonomy; note it predates the package and
  names neither it nor any eval layer

## Open Questions

1. **Does `reviewCode` grow a metadata return, or does the eval provider bypass it?** (gap C.1)
   Bypassing duplicates the `ReviewError` mapping; extending changes a shipped signature. Leaning
   toward extending, since it also fixes calibration's `n/r` step column.
2. **Is `--repeat` worth its cost at the chosen budget?** ~$1.50/run on Sonnet ⇒ ~$45 for 10 cases ×
   3 repeats. Possibly `--repeat 3` on a 4-case "hard" subset and `--repeat 1` on the rest.
3. **Are custom `file://` providers cached?** Docs are silent; issue evidence says no. Needs a
   10-minute empirical check before the cost model is trusted.
4. **Do the criteria need their own per-criterion ground truth, or only the verdict?** Verdict-only
   is cheaper and is what gates merges; per-criterion catches drift earlier. Probably: verdict as the
   hard assertion, per-criterion bands as a soft named metric.
5. **How are synthetic fixtures built?** Replaying real SHAs gives realism but the answer key is a
   human judgement of a whole PR. Small planted-defect fixtures give a crisp key but risk being
   unrepresentative. Likely both, weighted differently.
6. **Does `.nvmrc` move to 22.22.0+, or does the eval harness declare its own engine?**
7. **Provider metadata or full OTel?** Returning `metadata: {steps, toolCalls, usage}` needs no
   tracing stack; `trajectory:*` needs `@ai-sdk/otel` + `registerTelemetry` + `traceparent`
   propagation. Start with metadata (§D) and treat tracing as a later upgrade — but confirm the
   `@ai-sdk/otel` path works on `ai@7` before any plan depends on trajectory assertions.
