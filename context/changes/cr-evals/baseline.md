# Eval baseline — the first repeated sweep

The record `context/archive/2026-09-07-ci-cd-code-review/calibration.md` is for the reviewer running
on real PRs by hand. This is its counterpart for the harness: what the eval actually measured the
first time it was run with repeats, and what the numbers were allowed to decide.

The question, in the form the harness was built to answer it: **can a 10–20× cheaper model replace
`anthropic/claude-sonnet-5` as the reviewer that gates merges?** One case
(`evals/cases/react-19-migration`), three models, one judge, three repeats — nine cells.

```
npx promptfoo eval -c evals/promptfooconfig.yaml --repeat 3 -o results.json
```

`results.json` is a run artifact and is gitignored. Everything below is transcribed from it and was
re-verified against it; where a claim comes from somewhere else — the run's stderr step log, an
earlier sweep, the fixture — this file says so, because that distinction is what makes the rest
checkable.

**Run**: `eval-NzH-2026-09-09T18:07:25`, 2026-09-09. 9 cells, **0 errors**, 5m05s wall clock at
concurrency 4 with `cache: true`. Node 22.23.2, promptfoo 0.122.2. No cell differed from another in
anything that reaches the model: `config.model` is the only behavioural difference (`config.pricing`
also differs, but it is a cost constant the provider never sends).

## The case, in one paragraph

A hand-authored React 16 → React 19 migration of a `GameShelf` component, carrying **three planted
defects** — an inert `GameShelf.defaultProps` on a converted function component, a `useEffect`
conversion that drops the unmount teardown, and owner-authored notes rendered through
`dangerouslySetInnerHTML` — and **three decoys**, changes that read as wrong to a React 16 reviewer
and are correct here: `forwardRef` unwrapped with `ref` taken as a plain prop, a `useMemo` around a
cheap derived value dropped, and the hand-rolled `ReactDOM.render` entry point deleted in favour of
an Astro island with `client:load`. Full text and line anchors in
`evals/cases/react-19-migration/case.json`; the reasoning behind each decoy is in `evals/README.md`
under "Scoring inversions".

## The nine cells

Columns: **recall** is `flaw-recall`, the mean of the three per-flaw judge scores. Each per-flaw
score is 0.0 / 0.5 / 1.0 by rubric, but **no judge verdict in this sweep was ever 0.5**, so the ✓/✗
rendering below loses nothing and recall is quantised to {0, ⅓, ⅔, 1}. `default` is the inert
`defaultProps`, `teardown` the lost `useEffect` cleanup, `xss` the notes rendered as raw markup.
**gates** is how many of the four deterministic assertions passed. **cell** is what promptfoo
recorded on the night, under the placeholder `threshold: 0` the sweep was run with — see "The
calibrated bar" for what the same scores produce under the threshold this phase set.

| # | model | recall | default | teardown | xss | precision | gates | cell | steps | tools | prompt tok | out tok | cost | latency |
|---|-------|--------|---------|----------|-----|-----------|-------|------|-------|-------|-----------|---------|------|---------|
| 1.1 | `deepseek/deepseek-v4-flash` | 0.33 | ✗ | ✗ | ✓ | 1.0 | 4/4 | pass | 1 | 0 | 6 946 | 1 733 | $0.0009 | 69.1s |
| 1.2 | `z-ai/glm-5.1` | **0.00** | ✗ | ✗ | ✗ | 1.0 | 2/4 | fail | 1 | 0 | 6 668 | 336 | $0.0075 | 5.9s |
| 1.3 | `anthropic/claude-sonnet-5` | **1.00** | ✓ | ✓ | ✓ | 1.0 | 4/4 | pass | 6 | 9 | 96 779 | 11 464 | $0.3082 | 154.2s |
| 2.1 | `deepseek/deepseek-v4-flash` | 0.33 | ✗ | ✗ | ✓ | 1.0 | **3/4** | fail | 1 | 0 | 6 946 | 1 322 | $0.0008 | 56.3s |
| 2.2 | `z-ai/glm-5.1` | 0.33 | ✗ | ✗ | ✓ | 1.0 | 4/4 | pass | 1 | 0 | 6 668 | 1 714 | $0.0116 | 30.2s |
| 2.3 | `anthropic/claude-sonnet-5` | **1.00** | ✓ | ✓ | ✓ | 1.0 | 4/4 | pass | 8 | 12 | 149 995 | 12 158 | $0.4216 | 174.8s |
| 3.1 | `deepseek/deepseek-v4-flash` | 0.33 | ✗ | ✗ | ✓ | 1.0 | 4/4 | pass | 1 | 0 | 6 946 | 1 671 | $0.0009 | 77.2s |
| 3.2 | `z-ai/glm-5.1` | **0.00** | ✗ | ✗ | ✗ | 1.0 | 3/4 | fail | 1 | 0 | 6 668 | 1 953 | $0.0124 | 28.8s |
| 3.3 | `anthropic/claude-sonnet-5` | **1.00** | ✓ | ✓ | ✓ | 1.0 | 4/4 | pass | 10 | 15 | 181 091 | 11 090 | $0.4731 | 174.3s |

The repeat grouping is not an assumption: `testIdx` is 0/0/0, 1/1/1, 2/2/2 across the nine results,
so consecutive triples really are repeats.

Recall, by model, across the three repeats:

| model | repeats | spread | tool calls | cost / cell |
|---|---|---|---|---|
| `deepseek/deepseek-v4-flash` | 0.33, 0.33, 0.33 | none *(see caveat below)* | 0, 0, 0 | $0.0008 – $0.0009 |
| `z-ai/glm-5.1` | 0.00, 0.33, 0.00 | 0.33 | 0, 0, 0 | $0.0075 – $0.0124 |
| `anthropic/claude-sonnet-5` | 1.00, 1.00, 1.00 | none | 9, 12, 15 | $0.3082 – $0.4731 |

**The input really was byte-identical**, and the artifact proves it rather than asserting it:
deepseek's prompt is 6 946 tokens in all three repeats and glm's is 6 668 in all three. Sonnet's
grows (96 779 → 149 995 → 181 091) only because it took more steps, and every step resends the
accumulated conversation.

## What the sweep answers

**The answer is no.** Neither cheap model can replace `anthropic/claude-sonnet-5` as the reviewer
that gates merges on this case. Sonnet found all three planted defects in all three repeats. The
best either cheap model managed was one of three, and `z-ai/glm-5.1` managed zero in two of its
three.

That is not a close call needing a threshold to adjudicate, which is worth saying plainly: the
observed recall values are 0.00, 0.33 and 1.00 and nothing sits between 0.33 and 1.00. The gap is
the finding. The threshold is only where it gets written down.

### The separation is reading, not reasoning

Across the six cheap-model cells, `deepseek/deepseek-v4-flash` and `z-ai/glm-5.1` made **zero tool
calls** — every review written from the diff text alone in a single step. Sonnet made 9, 12 and 15
calls across 6, 8 and 10 steps, using all three tools in every repeat.

*(Tool **names** are in `results.json`; tool **arguments** are not, so the specific files below come
from the run's stderr step log, not the artifact.)* Sonnet reached
`src/lib/services/shelf.ts`, `astro.config.mjs` and `src/lib/format.ts` — three files `case.diff`
never touches. The case was built so that one flaw's consequence, the lost teardown, is only fully
visible outside the changed component.

**This is a model behaviour, not a harness gap.** The same provider code builds the agent for every
cell and hands every model the identical three tools; nothing in the config withholds them from the
cheap models. It is also the most stable thing the harness has measured — three sweeps now, never
varied.

One correction to the obvious reading of that: **reading is not strictly necessary to score the
teardown flaw.** On the Phase 3 sweep deepseek scored it with zero tool calls
(`evals/README.md`). So the honest claim is that tool use is what reliably separates the models
here, not that the flaw is unreachable without it.

### Which flaw gets found is unstable even when the score is not

`deepseek/deepseek-v4-flash` scored 0.33 on every one of its six recorded runs, and did **not** find
the same flaw each time. On the Phase 3 sweep it found the lost teardown and missed the XSS
(`evals/README.md`, external to this sweep). On all three repeats here it found the XSS and missed
the teardown.

A per-cell recall number that is stable at 0.33 therefore hides a model whose *single* finding moves
between runs. That is why the harness reports the three flaw metrics separately and not just their
mean: the mean was the stable part and the least informative part.

**The "spread: none" in the table above is also narrower than it looks.** A seventh deepseek run —
the single filtered cell used to verify the threshold, `eval-Kau-2026-09-09T18:15:33` — returned an
empty review (`criteria: []`, `findings: []`) and scored recall **0.00**. So deepseek's stability at
0.33 holds across three repeats of this sweep and not across every run ever recorded of it; it
shares glm's degenerate-output failure mode, just more rarely.

### The criterion digits move much more than the recall does

Recall is stable per model. **The digits `deriveVerdict` actually reads are not**, on byte-identical
input. deepseek's five criterion scores across its three repeats:

| criterion | r1 | r2 | r3 |
|---|---|---|---|
| `test-falsifiability` | 2 | **7** | 1 |
| `assertion-oracle` | 6 | 6 | **1** |
| `test-layer` | 6 | 6 | 4 |
| `stack-conventions` | 8 | 8 | 7 |
| `security-isolation` | 1 | **4** | 4 |

`test-falsifiability` swings 2 → 7 → 1 on the same diff. This is the variance that decides the merge
verdict, and it is far larger than anything in the recall column. Severity and line assignment move
too: deepseek filed the same XSS as `critical` / `major` / `critical`, and the three models anchored
it at lines 45 / 72 / 49.

### `z-ai/glm-5.1` produced an empty review in two of three repeats

This is the reliability finding, and it is a **different** failure from the one Phase 2 recorded.

The Phase 2 smoke had glm run away to the 16k output cap with `finishReason: "length"` and produce
no object at all. That did not reproduce here — nor on the Phase 3 sweep. All three repeats finished
normally with `finishReason: "stop"` and a schema-valid object. On four subsequent runs the runaway
has not returned, so it is **provisionally** run-to-run variance rather than a deterministic
structured-output failure; four non-reproductions cannot fully separate that from something having
changed upstream. Either way the `structuredOutputs: { strict: false }` lever was never needed and
never used, and every cell in this sweep ran identically configured.

What replaced it is quieter and worse, and the two instances are **not the same event**:

- **Repeat 1** — `findings: []`, `summary: ""`, all five `rationale` fields empty strings. 336 output
  tokens, 5.9s.
- **Repeat 3** — `findings: []`, `summary: "."`, every one of the five rationales the literal string
  `"..."`. **1 953 output tokens, 28.8s** — more output than its one real review (1 714 tokens) spent
  producing a 312-byte document containing a full stop. `completionDetails.reasoning` is 0 in both,
  so where those tokens went is unexplained by the artifact.

Both are schema-valid. Both would have been posted as a PR comment by `scripts/pr-review.mjs`, which
renders from `findings[]`. Repeat 3 even scored `security-isolation: 2`, inside the blocking band, so
it produced a **correct verdict with no stated reason** — a red check a human cannot act on or
appeal.

The deterministic gates caught both. That is the gates doing exactly the job the measurement split
was designed around: an empty review is not a judgement call.

### The false green, and how close it came to being two

**Two cells returned `verdict: passed` on a diff shipping a stored XSS** — deepseek repeat 2 (cell
2.1) and glm repeat 1 (cell 1.2), both caught by `assertVerdictFailed`. They are not equivalent: glm
r1 passed on an *empty* review, which is a formatting failure. **Cell 2.1 is the only cell in the
sweep that filed a real, correct finding and still passed the change**, and that is what makes it
the most important cell here.

It did not miss the bug. Its `security-isolation` rationale reads, in full at the end:

> Band: 1–2 (blocking). The introduction of `dangerouslySetInnerHTML={{ __html: entry.notes }}` … is
> a concrete security defect. … A stored XSS vulnerability ships with this change. **Score 4 because
> the defect is nameable and concrete, placing it in the blocking band (1–2).**

The final sentence contradicts itself inside one clause: it gives the reason for a blocking score and
then emits a non-blocking number. `deriveVerdict` reads only the digit, so the change passed.

**And this was not a one-in-nine event.** deepseek repeat 3 did the same thing — its
`security-isolation` rationale opens `Band: 1–2 (blocking)` and closes *"so the band is 1–2, and
within that band … makes it a **1**"* — and then scored **4**. That cell was saved from being a
second false green only by luck on unrelated criteria: `test-falsifiability` and `assertion-oracle`
happened to land at 1, which blocked the merge for reasons having nothing to do with the XSS. So the
band/digit contradiction occurred in **two of three deepseek repeats**, and produced a false green in
one of them.

This is the same failure `calibration.md` runs 1 and 2 recorded on Sonnet — the whole verdict living
in one digit on a point of substance both runs agreed about — and it is what the rubric's "decide the
band first, then the digit" section was written to fix. **On a cheap model, that section is not
enough.** The rubric can make the band explicit; it cannot make the model's score obey its own
reasoning.

Two things follow. First, this is a stronger argument against the cheap models than the recall
numbers are: a review that finds a defect and then passes the change is worse than one that finds
nothing, because it consumes the reviewer's credibility while un-gating the merge. Second,
`deriveVerdict`'s reliance on the criterion digit is a load-bearing assumption about the model, and
the digit-volatility table above says it is a shaky one. Worth revisiting separately — this eval is
not the place to change it.

### Precision did not discriminate, and partly could not

`precision` was **1.0 in all nine cells**. No model filed any of the three decoys as a defect, in any
repeat.

That number is weaker than it looks. **Two of the nine cells filed no findings at all**, and an empty
review scores precision 1.0 trivially — the metric rewards silence. So the honest reading is that the
decoys were not filed by the seven cells that said anything, and were untested by the other two.

Keeping the decoys is still right — the failure they guard against (a recall-only eval rewarding the
model that flags everything) has not been ruled out, only not observed. But the current matrix
separates models entirely on recall, and a future case should carry decoys with more bite if
precision is to earn its judge tokens.

## The calibrated bar

`flaw-recall` now gates at **0.66** — two of the three planted defects, diagnosed.
(`RECALL_BAR` in `evals/cases.ts`; the sweep above ran under the placeholder `threshold: 0`.)

With three flaws and no observed half-scores, recall is quantised to {0, ⅓, ⅔, 1}, so **every
threshold in (0.33, 0.667] is behaviourally identical on data of this shape** — the choice is
"two of three", and 0.66 is how that is spelled. What the placement buys is robustness to a change
in the *data*, not to a change in the threshold:

- A bar at or below 0.33 passes a model that found one defect and argued another away. Both
  cheap-model behaviours observed here.
- A bar at 1.00 demands perfection and fails Sonnet the first time it misses anything, which makes
  the gate uninformative in the other direction.
- 0.66 sits inside the empty band the data left and is the natural policy line: a reviewer that
  misses more than one of three planted defects has not reviewed the change.

`0.66` rather than `0.67` so an exact two-of-three (0.666…) passes rather than failing on a float
comparison. **Re-derive it when the corpus grows** — a bar calibrated against one case is a claim
about that case, and with a different number of flaws the quantisation moves.

### What it produces — mixed, as Phase 4's success criteria require

Applying the bar to the nine recorded scores (a cell needs all four gates, `precision`, **and**
recall ≥ 0.66):

| model | cells passing | why |
|---|---|---|
| `anthropic/claude-sonnet-5` | **3 / 3** | recall 1.00 every repeat, all gates green |
| `deepseek/deepseek-v4-flash` | 0 / 3 | recall 0.33 — below the bar in every repeat |
| `z-ai/glm-5.1` | 0 / 3 | recall 0.00, 0.33, 0.00 |

**3 pass, 6 fail** — a mixed sweep, not a uniform one. Under the placeholder `threshold: 0` the same
nine cells scored 6 pass / 3 fail, and all three of those failures came from a deterministic gate;
the recall and precision assertions passed in all nine. So the calibrated bar is now doing work the
gates were not: it fails the three cheap-model cells (1.1, 2.2, 3.1) that produced a well-formed,
correctly-verdicted review which nonetheless missed two of three defects.

The threshold was verified live, not only recomputed. In the sweep, cells 1.2 and 3.2 scored
`flaw-recall: 0` and the assert-set component still reported **PASS** — that is what `threshold: 0`
means. After the change, a single filtered cell (`--filter-providers deepseek`,
`eval-Kau-2026-09-09T18:15:33`, $0.001) scored `flaw-recall: 0` and the assert-set reported **FAIL**.
Same score, opposite verdict: the bar is wired in and gating. Only the FAIL side was exercised live;
the three Sonnet passes are recomputed on paper.

## Cost, and whether the cost model is real

**$1.35 for nine cells** — $1.2369 of reviewing plus $0.1145 of judging (75 316 grading prompt
tokens, 15 475 completion, 36 rubric verdicts at `google/gemini-3.8-flash`'s $0.75/$3.75 per M),
$1.3514 all in. That is **~$0.45 per three-model sweep**, against the plan's pencilled ~$5 for this
phase and ~$1.75 per sweep.

Sonnet's three cells are $1.2029 — **89% of the all-in total, 97% of the reviewing line.** The two
cheap models together cost **$0.034 across six cells**.

**The computed column was checked against the bill for the second time.** The provider does not read
a per-request cost back from OpenRouter — it multiplies `config.pricing` by the run's own token
counts (see the `pricing` comment in `providers/code-reviewer.ts`) — so the number is only as good as
the prices pinned in `promptfooconfig.yaml`. Here the harness computed **$1.3514** and the OpenRouter
credit balance moved **$5.84 → $4.50**, i.e. ~$1.34. The basis holds as of 2026-09-09, to about a
cent — which is not fine enough to resolve the caveat below.

### Cost varies with reading, and reading did not vary the answer

Sonnet's three repeats cost $0.308, $0.422 and $0.473 — a 1.5× spread on byte-identical input, rising
monotonically with step count (6, 8, 10) and tool calls (9, 12, 15). Prompt tokens went 96 779 →
149 995 → 181 091, because the whole conversation plus accumulated tool results is resent on every
step, so prompt tokens grow faster than linearly in steps.

**All three scored 1.00 and found the same three defects.** Combined with the Phase 2 smoke's 2.4×
spread ($0.218 at 4 steps, $0.518 at 11) producing the same 3/3 both times, that is now five Sonnet
runs where cost varied by more than 2× and accuracy did not vary at all. Budget from the spread, not
from a sample; do not read a cheap Sonnet run as a worse one.

glm's spread is larger in relative terms — **1.66×**, $0.0075 → $0.0124 — and points the other way:
its *most expensive* cell is one of the two empty reviews. Spending more bought nothing at all there.

## The caching question — narrower than it was asked

Research open question #3 asks whether custom `file://` providers are cached by promptfoo. **This
sweep does not answer that question, and an earlier draft of this file said it did.** What it
answers, decisively, is the cost-relevant half.

**What the sweep shows: `--repeat N` costs N×.** Evidence, all from `results.json`:

- **Three real requests per provider.** Each cell reports `tokenUsage.numRequests: 1`, and each
  prompt's metrics attribute 3 requests to each provider.
- **Full latency on repeats 2 and 3.** deepseek 69.1s → 56.3s → 77.2s; Sonnet 154.2s → 174.8s →
  174.3s; glm 5.9s → 30.2s → 28.8s. A cache hit is instant.
- **Full, and *differing*, cost per repeat.** Sonnet's $0.308 / $0.422 / $0.473 at 6 / 8 / 10 steps
  are three distinct agent runs, not one replayed three times.
- **Nine distinct outputs.** glm returned an empty review, then a real one, then an empty one; no two
  of the nine reviews are byte-identical. A replayed cache cannot do that.
- **The cache was on.** `runtimeOptions` in `results.json` records `cache: true`, so none of the
  above is the trivial consequence of `--no-cache`.

**Why it does not settle the general question.** promptfoo 0.122.2 namespaces its cache *per repeat
index* — `getRepeatCacheNamespace(repeatIndex, …)` wraps every eval step
(`node_modules/promptfoo/dist/src/evaluator-*.js`). A fully cache-aware built-in provider under
`--repeat 3` would produce every observation listed above. So this data cannot tell "custom providers
bypass the cache" apart from "`--repeat` never reuses anything".

**The general answer is still no, but by construction rather than by measurement.** promptfoo's cache
lives inside its `fetchWithCache` helper; this provider drives the AI SDK directly and never routes
through it (`grep -c fetchWithCache evals/providers/code-reviewer.ts` → 0). That mechanism, not this
sweep, is why re-running the same sweep *without* `--repeat` would also be full price.

No `fetchWithCache` wrapper was built either way: at $0.45 a sweep it does not pay for itself. The
note is what a future ten-case suite needs before it budgets.

### A second cache, which must not be confused with the first

`tokenUsage.cached` is 0 on every cell of repeat 1 and on all three Sonnet cells, but 6 912 / 6 912
on deepseek's repeats 2 and 3 and 6 656 / 6 592 on glm's — against ~6 900-token prompts. That is
**upstream OpenRouter prompt caching**, warmed by repeat 1 and read by the later repeats. It is a
property of the provider, not of promptfoo — the provider maps it straight from
`usage.inputTokenDetails.cacheReadTokens` — and it does not make a repeat free.

Sonnet shows none of it. The likely reason is that Anthropic prompt caching requires explicit
`cache_control` breakpoints, and this codebase sends none (`grep -rn "cache_control\|cacheControl"`
over `packages/code-reviewer/src`, `evals/` and `scripts/` returns nothing but prose). The absence of
breakpoints is verified; that it is *the* reason is a vendor fact carried on no experiment here.

**The cost caveat, with its magnitude.** `computeCost` multiplies total prompt tokens by
`pricing.prompt`, cache reads included, so the computed column charges cache reads at full price. It
affects **four cells** — the cheap models' repeats 2 and 3; every repeat-1 cell reports `cached: 0`.
Upper bound if cache reads were free: 13 824 × $0.084/M + 13 248 × $0.966/M = **$0.014**. That is 1%
of the $1.35 sweep — invisible — but **41% of the $0.034 the cheap models cost**. On a suite where
the cheap models dominate the bill it would not be invisible at all. Note also that this is the same
order as the $0.01 gap between the computed total and the balance delta, so the bill check cannot
resolve it.

## What this baseline does not establish

- **One case.** Nine cells, but three flaws on one diff. Every claim above is a claim about a React
  16 → 19 migration.
- **One judge, ungraded.** `google/gemini-3.8-flash` produced 36 rubric verdicts here and nothing
  graded it. The four spot-checks in `evals/README.md` are from the Phase 3 sweep, not this one.
- **Three repeats.** Enough to see that glm is unreliable, that the criterion digits are volatile,
  and that Sonnet is stable. Not enough to put an interval on anything.
- **No preserved raw output.** `results.json` is gitignored, so the tables here are the surviving
  record. Anything a future reader needs to re-check must be quoted in this file.
- **Not fully re-runnable.** The command, config, model ids, judge, node and promptfoo versions and
  the bar are recorded; the repo commit SHA and the provider-side model versions are not, so a later
  sweep can be compared but not proven identical.
- **Nothing about production PRs.** The corpus is hand-authored. The six replayable head SHAs from
  `calibration.md` remain the natural second case set (research §E).

## See also

- Harness, its gotchas, and the earlier sweeps: `evals/README.md`
- The answer key, including every decoy's justification: `evals/cases/react-19-migration/case.json`
- Plan: `context/changes/cr-evals/plan.md` — Phase 4
- The hand-driven predecessor: `context/archive/2026-09-07-ci-cd-code-review/calibration.md`
- The policy under test: `scripts/pr-review/rubric.mjs`, `scripts/pr-review/verdict.mjs`
