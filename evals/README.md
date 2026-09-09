# `evals/` — measuring the AI code reviewer

This directory measures `packages/code-reviewer` the way CI actually uses it, and exists to answer
one concrete question:

> Does a 10–20× cheaper model review a React 16 → React 19 migration as well as the
> `anthropic/claude-sonnet-5` that `scripts/pr-review.mjs` runs on every PR today?

The reviewer has had no falsifiable measurement of its own quality — nine hand-driven calibration
runs (`context/archive/2026-09-07-ci-cd-code-review/calibration.md`) are all the evidence there is.
This harness replaces that with a repeatable matrix.

## What is under test

Not the package on its own. What ships is a **composition**:

```
REVIEW_RUBRIC (scripts/pr-review/rubric.mjs)
  → reviewCode({ extraInstructions })   (packages/code-reviewer)
  → deriveVerdict()                     (scripts/pr-review/verdict.mjs)
```

The eval reproduces that call site (`scripts/pr-review.mjs:233-241`) rather than the package's bare
defaults. `REVIEW_RUBRIC` is held constant; **the model is the only variable**.

## Layout

```
evals/
  promptfooconfig.yaml       providers × tests × assertions — the entry point
  providers/code-reviewer.ts one cell = one full run of the reviewer (default-exported class)
  cases.ts                   test generator (`tests: file://cases.ts:generate`), and the judged
                             assertions — the answer key rendered as rubric prose
  assertions.ts              the deterministic gates, as `file://assertions.ts:<name>`
  case.ts                    the answer key as a zod schema, plus `loadCase`
  reviewer.ts                the system under test, loaded from the package's built dist/
  paths.ts                   repo-root resolution
  cases/react-19-migration/
    before/       the pre-migration tree: React 16, hand-mounted via ReactDOM.render
    after/        the migrated tree — this is the agent's sandboxed rootDir
    tsconfig.json (in both trees, identical) — pins jsx: react-jsx and the @/ alias
    case.diff     generated from before/ + after/, committed
    case.json     the answer key: flaws[] and decoys[]
```

The calibrated recall threshold arrives in Phase 4 of `context/changes/cr-evals/plan.md`. Until
then the flaw metrics are reported, not enforced.

## How a cell is scored

Two halves, split on a single rule: **what is objectively checkable gates; what is a judgement call
is measured.**

| | Where | Gates? |
|---|---|---|
| Schema validity, the five-criterion contract, the derived verdict, a serious finding on the flaw file | `assertions.ts`, wired in `defaultTest.assert` | yes, hard-fails the cell |
| One recall rubric per planted flaw (`flaw-<id>`), rolled up as `flaw-recall` | generated in `cases.ts` | no — `threshold: 0` until Phase 4 calibrates it |
| One precision rubric over all three decoys (`precision`) | generated in `cases.ts` | **yes** |

The judge is `openrouter:google/gemini-3.8-flash`, set once in `defaultTest.options.provider`. It is
a fourth vendor on purpose — Anthropic, Z-AI and DeepSeek are all under test, so the grader is never
a sibling of what it grades — and its id cannot collide with the `file://` ids of the systems under
test, which promptfoo answers with `RangeError: Maximum call stack size exceeded` rather than an
error message (promptfoo issue #10501). Judging a full sweep costs about $0.05.

**Recall is graded on the whole review, not on `findings[]`.** That is deliberate. A model that
diagnoses a defect correctly and writes it into prose instead of `findings[]` has failed the output
contract — but that failure is already caught deterministically by `assertSeriousFindingOnFlawFile`,
and production renders its PR comment from `findings[]`. Scoring recall on `findings[]` alone would
make the two measurements say the same thing twice and throw away the interesting half: whether the
model saw the bug at all. The gate asks "did it use the contract"; the metric asks "did it see the
bug". Keeping them orthogonal is what lets the matrix separate a model that cannot analyse from a
model that cannot format.

### Four promptfoo behaviours the wiring is shaped by

All four were found by running it, not by reading docs, and all four fail in ways that do not look
like what they are:

- **An array-valued `var` is a test matrix, not a value.** Carrying `flaws` and `decoys` through
  `vars` silently turned one case into three cells, each holding one flaw zipped against one decoy.
- **String vars are rendered through nunjucks.** Inlining `case.diff` as a var failed the entire
  run with `Template render error … expected variable end` at line 70 — the planted
  `dangerouslySetInnerHTML={{ __html: entry.notes }}`, whose `{{` nunjucks tried to open as a
  variable.
- **So is every string assertion `value`.** The judged rubrics are built by interpolating
  `case.json` prose, which no one writes with a template engine in mind, so each rubric is wrapped
  in `{% raw %}` before it is handed over. Same trap as above, one layer further in.
- **`derivedMetrics` expressions are evaluated by mathjs, where `-` is subtraction.** The obvious
  spelling of the recall rollup — `flaw-default-prop-ignored + flaw-effect-teardown-lost + …` —
  parses as arithmetic on an undefined symbol `flaw`, throws, and is swallowed at debug level. The
  metric then sits at 0, which is indistinguishable from a model that found nothing. `flaw-recall`
  is therefore an `assert-set` metric (promptfoo scores a set as the mean of its children) rather
  than a derived one; any future derived metric here needs identifiers mathjs can parse.

So `vars` carries the case **id** and nothing else, and everything that needs the case reads it off
disk through `loadCase`. Keep it that way: a future case whose diff happens to contain `{{` would
otherwise take the whole sweep down.

A fifth, on the way to the same place: **`weight: 0` does not make an assertion "scored but not
gating".** It does stop the assertion failing the cell, but promptfoo normalises a named score by
its accumulated weight, so a zero-weighted assertion reports its metric as 0 whatever the judge
said. An `assert-set` with an explicit `threshold` is the mechanism that actually works.

## The case

One hand-authored migration PR carrying **three planted flaws** and **three decoys**.

| Flaw | Severity | Why nothing else catches it |
|---|---|---|
| Default prop values kept on the converted function component | critical | React 19 dropped the mechanism for function components (it survives only on classes), and the automatic JSX runtime the sandbox pins ignores the object outright. The prop is optional and the call site carries a non-null assertion, so typecheck is clean; React 19 emits no deprecation warning; no configured lint rule covers it. |
| The unmount teardown is lost in the effect conversion | major | `react-hooks/exhaustive-deps` checks the dependency array — which is correct here — not a missing cleanup return. |
| Owner-authored notes rendered as raw markup | major | `react/no-danger` is off in `eslint-plugin-react`'s `recommended`, which is what this repo extends; `astro/no-set-html-directive` is scoped to `.astro` files and never reaches a `.tsx`. |

| Decoy | Why it is correct |
|---|---|
| `forwardRef` unwrapped; `ref` taken as a plain prop | React 19 passes `ref` to function components as an ordinary prop. |
| A `useMemo` around a cheap derived value dropped | The helper is two string concatenations, its `[entry]` key changed on every refetch, and the result is a string primitive no memoised child depends on. |
| `ReactDOM.render` entry deleted for an Astro island with `client:load` | This repo mounts every React component that way — `src/` contains no `createRoot`, `ReactDOM` or `getElementById` at all. |

The decoys are the reason this is a measurement rather than a recall count: a recall-only eval
rewards the model that flags everything, and that is the model you least want gating merges. Each
decoy is written so that a reviewer who correctly reasons about it will *not* file it — see
"Scoring inversions", below, for the failure mode that guards against.

**`case.json` is the artifact that matters.** The runner is replaceable; a hand-verified answer key
is not. It is plain data, readable and useful with no eval tooling at all.

## Scoring inversions

The one failure this fixture must never have is a decoy whose `whyItIsCorrect` is itself false —
because then a reviewer that is *right* gets scored as having produced a false positive, and the
harness silently punishes the sharpest model in the matrix. Two were caught and fixed during
Phase 1 review; both are worth remembering when the corpus grows:

- A decoy justified by "this repo runs the React Compiler, which memoises automatically". It does
  **not**: `eslint-plugin-react-compiler` is a lint plugin, `astro.config.mjs` passes no babel
  options, and neither `babel-plugin-react-compiler` nor `react-compiler-runtime` is a dependency.
  A reviewer pointing that out would have been correct.
- A decoy built on a hand-rolled `createRoot` entry point, in a repo that hydrates React
  exclusively through Astro islands. A reviewer objecting that it bypassed the Astro renderer would
  have been correct.

The rule the corpus follows: **a decoy's justification must be checkable from inside the sandbox or
against the real repository — never asserted.**

### The answer key must never reach the model

`case.json` carries two prose fields and they are not interchangeable:

| Field | Audience | Contains |
|---|---|---|
| `description` | humans reading this repo | what the case is for, including that flaws and decoys are planted |
| `prDescription` | **the model** | the PR body as its author would have written it |

The provider sends `title` + `prDescription` + `case.diff` and nothing else. Sending `description`
hands the reviewer the answer key — and the first green run of this harness did precisely that. The
model's summary opened:

> "Three defects are planted per the PR description; all three are correctly identified in
> findings."

Three of four assertions passed and the cell looked healthy. **A leaked answer key does not fail —
it flatters.** That is what makes it worth a section: nothing in the run said anything was wrong,
and every recall number it produced was worthless. Any field added to `case.json` from here needs
an explicit answer to "does this reach the model?"

## Commands

```bash
npm run evals         # build the package under test, then run the sweep
npm run evals:view    # open the last run's report in a browser
npm run evals:diff    # regenerate case.diff from before/ + after/
npm run evals:check   # validate every case.json against its fixture
```

`npm run evals` is the only supported way to start a sweep. It runs `npm ci` and `npm run build`
inside `packages/code-reviewer` first, because the provider imports that package's `dist/` — which
is gitignored, and whose dependencies the root `npm ci` never fetches (`packages/*` are standalone
projects, not workspaces; see the `packages` job in `.github/workflows/ci.yml`). A bare
`promptfoo eval` on a clean checkout fails on a missing build rather than running.

It needs `OPENROUTER_API_KEY` in `.env` — the same key `scripts/pr-review.mjs` uses. Every cell is
a real OpenRouter call against real files; nothing here is mocked.

`evals:diff` runs `git diff --no-index` over the two trees and rewrites the tree prefixes away so
every path matches what the agent's `read_file` tool sees under `rootDir`. On an unchanged fixture
**it must leave the working tree clean** — that is this layer's gate.

`evals:check` re-verifies the answer key's structural claims: `rootDir` and `diffPath` exist, every
`paths[]` entry resolves, ids are unique, severities are known, and every flaw/decoy `line` both
sits in range **and** still contains that entry's `anchor` substring.

The anchor is the part that matters. Line references go stale silently — insert one line above a
flaw and every reference below it shifts, stays comfortably "in range", and the eval keeps running
while grading against code the answer key never meant. Falsified during Phase 1 by prepending a
single line to `GameShelf.tsx`: five of the six anchors went red, naming the line each one landed
on instead. Run both commands after touching either tree.

The diff is also verifiable end to end: applying `case.diff` to a copy of `before/` with
`git apply -p0` reproduces `after/` exactly.

## Why the fixture is excluded from the repo's gates

The `after/` tree is deliberately broken, so three exclusions carry it past checks that would
otherwise reject or repair it:

| File | Entry | Without it |
|---|---|---|
| `tsconfig.json` | `exclude: evals/cases/**/*` | `astro check` typechecks the fixture and blocks the pre-commit hook. |
| `eslint.config.js` | `ignores: evals/cases/**` | Eight lint errors across the two trees (measured below), none of them about a planted defect. |
| `.prettierignore` | `evals/cases/` | `npm run format` reformats the trees and desynchronises `before/`, `after/`, `case.diff` and every line number in `case.json` — silently, since the eval keeps running against stale lines. |

`evals/*.ts` and `evals/providers/**` are real code and stay linted and typechecked.

### What lint actually reports — measured, not assumed

With both exclusions removed, `eslint` over the fixture's twelve files (eleven `.ts`/`.tsx` plus
one `.astro`) reports exactly eight errors:

```
after/  GameShelf.tsx:77   @typescript-eslint/no-non-null-assertion
after/  shelf.ts:25        @typescript-eslint/no-unsafe-assignment
after/  library.astro:9    @typescript-eslint/no-unsafe-assignment
after/  library.astro:9    @typescript-eslint/no-unsafe-member-access
before/ GameShelf.tsx:99   @typescript-eslint/no-non-null-assertion
before/ shelf.ts:25        @typescript-eslint/no-unsafe-assignment
before/ main.tsx:8         react/no-deprecated  (ReactDOM.render)
before/ main.tsx:8         @typescript-eslint/no-unsafe-call
```

The two Astro-page errors are sandbox artifacts — `Astro.locals` is untyped without the repo's
`env.d.ts` — not findings about the change.

**No `react-hooks` or `react-compiler` rule fires on any of the three planted defects**, and none
of the eight errors is auto-fixable. That is the property the whole fixture rests on, so it is
measured here rather than asserted. The `after/` tree also typechecks clean under its own
`tsconfig.json` (`tsc --noEmit`, exit 0), which is what makes "typecheck does not catch these" a
fact rather than a claim.

## What the single-model smoke showed — measured 2026-09-08

The single-model smoke was specified against the cheapest model. It was moved to
`anthropic/claude-sonnet-5` because the cheap models could not clear the deterministic gates, and a
smoke test that fails tells you nothing about the harness it is supposed to be smoke-testing. What
separated them was not reasoning quality:

| Model | Steps | Tool calls | Outcome | Cost |
|---|---|---|---|---|
| `deepseek/deepseek-v4-flash` | 1 | 0 | Schema-valid, but `findings[]` **empty** — the whole review written as prose in `summary`. Found the XSS and scored `security-isolation` 2. | $0.001 |
| `z-ai/glm-5.1` | 1 | 0 | Ran away to the output cap, `finishReason: length`, **no object at all**. | ~$0.05 |
| `anthropic/claude-sonnet-5` | 4 / 11 | 6 / 14 | All four gates green, twice. **3/3 planted flaws, 0 decoys filed, both times.** | $0.218 / $0.518 |

Three things worth carrying forward:

- **Neither cheap model called a single tool.** Both answered from the diff text alone. This was
  verified not to be a harness defect: the agent demonstrably carries `read_file`, `list_files` and
  `search_code`, and Sonnet used all three — including `read_file(src/lib/services/shelf.ts)`, a
  file the diff never touches and which the answer key names as where the teardown flaw's
  consequence actually shows. Reading the sandbox is what the case was built to reward.
- **The cheap failure mode is the output contract, not the analysis.** deepseek identified the XSS
  correctly and then declined to put it in `findings[]`. A recall metric reading only `findings[]`
  would score that 0/3 — which is arguably right, since `scripts/pr-review.mjs` renders the comment
  from that array — but it is a different claim from "the model missed it", and Phase 3's judge
  should be pointed at `findings[]` **or** `summary` deliberately rather than by accident.
- **Cost is driven by tool use, and varies 2.4× run to run on identical input.** Two Sonnet runs of
  the same case cost $0.218 (4 steps, 6 tool calls, 59k prompt tokens) and $0.518 (11 steps, 14 tool
  calls, 207k prompt tokens). The prompt is not bigger — it is the same conversation plus
  accumulated tool results resent on *every* step, so prompt tokens grow faster than linearly in
  step count and the cheap-model cells are cheap partly because they read nothing.

  Do not budget from one sample. The plan's ~$1.70 estimate for a three-model sweep is the right
  order of magnitude; a single number is not. Phase 4's `--repeat 3` should report the spread, not
  an average — and note that the two runs above found the same 3/3 flaws and filed no decoys
  despite that spread, so cost variance here is not accuracy variance.

## The first full sweep — measured 2026-09-09

One case, three models, one judge. `npm run evals`, exit 0, 2m40s wall clock at concurrency 4.

| Model | flaw-recall | default-prop | teardown | notes-XSS | precision | Steps | Tool calls | Cost | Latency |
|---|---|---|---|---|---|---|---|---|---|
| `deepseek/deepseek-v4-flash` | **0.33** | ✗ | ✓ | ✗ | 1.0 | 1 | 0 | $0.0008 | 23s |
| `z-ai/glm-5.1` | **0.33** | ✗ | ✗ | ✓ | 1.0 | 1 | 0 | $0.0117 | 29s |
| `anthropic/claude-sonnet-5` | **1.00** | ✓ | ✓ | ✓ | 1.0 | 6 | 6 | $0.2696 | 151s |

All three cells passed every deterministic gate, so the answer is not "the cheap models are broken".
It is narrower and more useful than that:

- **The two cheap models each found exactly one flaw, and not the same one.** deepseek found the
  lost effect teardown and missed the XSS; glm found the XSS and missed the teardown. Neither found
  the `defaultProps` semantics break — the flaw that requires knowing what React 19 *removed* rather
  than reading the diff carefully. On a case with three planted defects, 1/3 each is not a
  cheaper reviewer, it is a different failure per merge.
- **Both of them argued the flaw away rather than missing it.** deepseek noticed
  `dangerouslySetInnerHTML` and wrote "noted but is not a defect introduced by this PR — it renders
  what the old entry point rendered", which is false: the `before/` tree renders notes as text. glm
  filed `defaultProps` as a **minor** "deprecated in React 19" note, which gets the severity and the
  semantics both wrong — deprecated is not removed, and the value silently never applies. A recall
  rubric that accepted a keyword match would have scored those 1.0. This is the single strongest
  argument for grading recall on the diagnosis rather than on the mention.
- **Neither cheap model called a single tool, again.** Both answered from the diff text alone, as in
  the smoke. Sonnet made six calls across six steps — including `read_file(src/lib/services/shelf.ts)`
  and `search_code(entry.notes)`, files the diff never touches — and it is the only one that scored
  the flaw whose consequence is only visible outside the changed component. Reading the sandbox is
  what the case was built to reward, and it is what the price difference buys.
- **Precision was 1.0 across the board.** No model filed any of the three decoys as a defect; glm and
  Sonnet both explicitly approved of the ref-as-prop change and the `client:load` island. The
  decoys did not discriminate on this sweep. Worth remembering when reading the recall numbers: the
  cheap models are not failing by over-reporting, they are failing by under-reading.

**Cost: $0.33 for the whole sweep** — $0.282 of reviewing plus $0.049 of judging (36,431 grading
tokens). The plan budgeted ~$1.75. The gap is not a saving to bank: it is Sonnet landing at the
cheap end of its own 2.4× spread (6 steps here, against 4 and 11 on the two smoke runs), and the
two cheap cells costing essentially nothing because they read nothing. See the caveat below — one
sample is not a budget.

**The computed cost column was checked against the bill, once.** The provider does not read a real
per-request cost back from OpenRouter — it multiplies `config.pricing` by the run's own token counts
(see the `pricing` comment in `providers/code-reviewer.ts` for why) — so the number is only as good
as the prices pinned in `promptfooconfig.yaml`. On this sweep the harness computed **$0.331** and
the OpenRouter credit balance moved **$6.17 → $5.84**, i.e. $0.33. The basis is sound as of
2026-09-09. It will go quietly wrong when OpenRouter re-prices; `metadata.costBasis` says so in
every cell, and re-checking the balance across one sweep is how you find out.

### glm-5.1's Phase 2 runaway did not reproduce

The smoke recorded `z-ai/glm-5.1` running away to the 16k output cap with `finishReason: "length"`
and producing no object at all. On this sweep, with **no configuration change**, it stopped
normally after 1,743 output tokens and returned a schema-valid review that cleared all four gates.

So the runaway was run-to-run variance, not a deterministic structured-output failure, and the
`structuredOutputs: { strict: false }` lever (`providers/code-reviewer.ts`) was not needed and was
not used. Every cell in this sweep ran with identical settings; the model is the only variable, as
intended. Keep it that way — reaching for a per-model knob to rescue a failing cell leaves that
column measuring a differently-configured system than its neighbours. If glm's runaway returns,
that is a data point about its reliability before it is a reason to change the config.

### Judge spot-checks

Four verdicts were read against the raw review text, chosen as the ones most likely to be
rubber-stamped:

| Verdict | Checked | Correct? |
|---|---|---|
| deepseek, notes-XSS = 0 | It *does* name `dangerouslySetInnerHTML` and then dismisses it | yes — naming the sink is not diagnosing it |
| glm, default-prop = 0 | It files a `minor` "deprecated in React 19" finding | yes — deprecated ≠ removed, and the rubric's "names the API without saying what is wrong" clause is exactly this |
| Sonnet, 3/3 | Three findings, correct files, `critical`/`critical`/`major` | yes |
| precision = 1.0 ×3 | No forwardRef / `useMemo` / `client:load` finding in any review | yes |

The judge distinguished "mentioned it" from "diagnosed it" in both cheap cells without being asked
twice, which is the property the rubric prose was written for. Re-check it whenever the rubric text
changes: a rubric that has drifted toward keyword matching will show up as recall rising while the
reviews stay the same.

### The output cap is a blast radius

`DEFAULT_MAX_OUTPUT_TOKENS` (16k, in `providers/code-reviewer.ts`) exists because the first
uncapped run of this harness had `deepseek-v4-flash` emit **88,045 output tokens** against a
6,785-token prompt in a single request — twelve minutes at 122 tok/s, no review, killed by the
cell timeout. `calibration.md` run 3 has the same shape on a different model: 160k output tokens
over 9m41s, no object.

Capped, that failure ends in minutes with `finishReason: "length"`, which is a diagnosis. Uncapped,
it ends with `timeout`, which is not. Do not raise it to "give a model more room" — a review is a
few thousand tokens, and anything approaching the cap is a runaway, not a thorough review.

## What this does not measure

- **One case.** Three flaws on one diff is a narrow instrument; a model can get lucky.
- **One rubric.** `REVIEW_RUBRIC` is weighted toward *test* quality: three of its five criteria are
  about tests, `stack-conventions` is a closed list carrying only two React-relevant entries (no
  Next.js directives, and the `@/` alias), and `security-isolation` is anchored on RLS and secrets
  rather than DOM injection. The flaw signal therefore rests on the review prose and the judge
  rather than on the criterion scores — though the notes-as-markup flaw should move
  `security-isolation` too.
- **One judge, ungraded.** `google/gemini-3.8-flash` grades every rubric and nothing grades it. The
  spot-checks above are a human reading four verdicts, not a measurement of judge agreement.
- **One sweep.** Every number above is n=1 per model. Phase 4's `--repeat 3` is what turns them
  into a claim with a spread attached; until then, treat a 0.33 and a 1.00 as the same kind of
  evidence the nine hand-driven calibration runs were.
- **No CI wiring.** This is an on-demand harness. No workflow, no repository secret, no PR gate.

## See also

- Plan: `context/changes/cr-evals/plan.md`
- Research: `context/changes/cr-evals/research.md`
- The policy under test: `scripts/pr-review/rubric.mjs`, `scripts/pr-review/verdict.mjs`
- Prior calibration, by hand: `context/archive/2026-09-07-ci-cd-code-review/calibration.md`
