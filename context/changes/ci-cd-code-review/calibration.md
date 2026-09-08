# Calibration record

What the reviewer actually said on real PRs, so rubric edits are driven by observed failures rather
than intuition. One row per run, newest last.

Columns: **run** links the GitHub Actions run id. **paths** is the size of the scored path list
after prose filtering, not the PR's changed-file count. **steps** is how many of the 20-step budget
the agent used. **scores** are the five criteria in rubric order —
`test-falsifiability / assertion-oracle / test-layer / stack-conventions / security-isolation`.
**verdict** is what the threshold produced; **on the verdict** is a human's judgement of whether
that was right (agreed / false positive / false negative).

## Runs

| # | PR | head SHA | model | temp | paths | steps | scores | verdict | on the verdict |
|---|----|----------|-------|------|-------|-------|--------|---------|----------------|
| 1 | [#37](https://github.com/TomaszMarcinkowski1000/GamingLibrary/actions/runs/34159218589) | `04055d95` | `anthropic/claude-sonnet-5` | unset | 14 | n/r | 4 / 6 / 6 / 7 / 4 | passed | agreed |
| 2 | [#37](https://github.com/TomaszMarcinkowski1000/GamingLibrary/actions/runs/34159617713) | `04055d95` | `anthropic/claude-sonnet-5` | unset | 14 | n/r | 2 / 6 / 3 / 7 / 5 | failed | **false negative** |
| 3 | [#37](https://github.com/TomaszMarcinkowski1000/GamingLibrary/actions/runs/34161583108) | `70a7dae2` | `z-ai/glm-4.7` | 0 | 14 | — | — | failed (`no-output-generated`) | agreed — the review genuinely did not complete |
| 4 | [#37](https://github.com/TomaszMarcinkowski1000/GamingLibrary/actions/runs/34162833528) | `e9cbff02` | `z-ai/glm-4.7` + `require_parameters` | 0 | 14 | — | — | failed (`no-output-generated`) | agreed — did not complete |
| 5 | [#37](https://github.com/TomaszMarcinkowski1000/GamingLibrary/actions/runs/34245777802) | `24f59b04` | `z-ai/glm-4.7` + `strict: false` | 0 | 14 | — | — | **cancelled** — job timeout at 20m20s | **wrong, and it left the PR green** |
| 6 | [#37](https://github.com/TomaszMarcinkowski1000/GamingLibrary/actions/runs/34251866385) | `0b073e09` | `claude-sonnet-5` + `require_parameters` + `temperature: 0` | 0 | 14 | — | — | failed (no eligible endpoint, 14s) | agreed — config error, no provider reached |

`n/r` = not recorded. The step count is not currently surfaced anywhere the workflow captures; runs
from here on should note it from the job log.

## What runs 1 and 2 established

Both runs scored **the same commit** (`04055d95`, 14 scored paths) and reached **opposite verdicts**.
Run 2 was triggered by the `ai-cr:retry` label with nothing changed in between, so this is a clean
same-input comparison rather than two different reviews.

**They did not disagree about the code.** Both wrote essentially the same finding for criterion 1 —
the new pure functions under `scripts/pr-review/` (the threshold, the diff collector, the comment
renderer) gate every future merge and ship with no unit test. Run 1 called that a **4**; run 2
called it a **2**. The gate is at ≤3. The entire flip lives in that one digit, on a point of
substance both runs agreed about.

Judged after the fact, **run 1 was right and run 2 was the false negative.** The untested threshold
function is a real gap, and the change's own `plan-brief.md:87-89` names it as an accepted,
unmitigated risk — but no defect ships on merge, and the omission is disclosed rather than hidden.
That is the passing band.

Both runs also independently found a genuine defect: `scripts/pr-review.mjs:168` / `:184` passed a
raw provider error into the publicly-posted comment. That one was correct, and is fixed in this
phase. Two independent runs converging on a real bug is the strongest evidence so far that the
reviewer is worth its cost.

### What changed as a result

1. **The rubric now decides the band before the digit** (`rubric.mjs`, "Decide the band first, then
   the digit"). The threshold sits inside the low end of the scale, so adjacent numbers down there
   carry the whole merge decision; the rubric previously anchored only **1** and **10** and left
   2–4 entirely to interpolation. It now names the blocking band per criterion and sets a specific
   bar for entering it — you must be able to name the concrete defect that ships on merge.
2. **Criterion 1 gained explicit 3 and 4 anchors**, plus this exact case as a worked example, so the
   4-versus-2 judgement is resolved by the rubric rather than re-litigated per run.
3. ~~**Sampling temperature is pinned to 0**~~ — **withdrawn, see run 6.** This was recorded as the
   mechanical half of the stability fix. It is inert on `anthropic/claude-sonnet-5`: none of that
   model's nine OpenRouter endpoints declares `temperature` support, so the pin is either silently
   dropped or (with `require_parameters: true`) fails the request outright. The plumbing through
   `reviewCode` was a real gap and stays, unset by default; the claim that it stabilises scores here
   was wrong.

So changes 1 and 2 — the rubric's decision bands and criterion 1's boundary anchors — are the
**entire** fix for item 5.4, not the senior partner in a pair. Two runs on one unchanged SHA remain
the check.

## What run 3 established: provider routing, not the model

Run 3 was the first on the cheaper model. It ran for **9m41s** and threw
`ReviewError: The review finished without producing a verdict.` — `no-output-generated`, *not*
`step-budget-exhausted`. It did not run out of steps and get cut off; it stopped on its own having
produced no schema-valid object.

**The first diagnosis was wrong.** It was recorded here as "glm-4.7 cannot do this job", by analogy
with the `claude-haiku-4.5` note in the package README. The OpenRouter activity log contradicted
that: 23,243 prompt tokens, **160,547 completion tokens**, cost **$0.00**, model reported as
`Unknown`. At the observed 277 tok/s those 160k tokens account for 579s — the run's entire 9m41s.
So the model generated enormously and never closed with the object.

`GET /api/v1/models/z-ai/glm-4.7/endpoints` explains why. That model is served by **seven
independent endpoints, and three of them — Novita, Z.AI, Mancer 2 — do not support
`structured_outputs` at all.** Our `max_price` of 0.6/2.7 excluded only Mancer 2 on price, leaving
two structurally incapable endpoints eligible. OpenRouter's `require_parameters` — *"only use
providers that support all parameters in your request"* — **defaults to `false`**, so nothing
stopped the request from landing on one.

**The trap worth remembering:** the model-level `supported_parameters` array in `GET /api/v1/models`
is the **union across a model's endpoints**, not a property of the endpoint you are served. It
answers "can some endpoint do this?" when the question is "will mine?". The candidate shortlist for
this swap was filtered on that union, which is why an incapable route was never ruled out.

The fix is one flag, `require_parameters: true` in `buildProviderOptions` — not a model change. With
it, the eligible set under the same price caps is DeepInfra ($0.40/$1.75), AtlasCloud, Venice, and
Google: four endpoints, all `structured_outputs`-capable.

Two designed behaviours were confirmed by the failure, which is worth as much as the diagnosis:

- **It failed closed.** An incomplete review became `verdict=failed`, a red check and `ai-cr:failed`
  — never a false green.
- **The leak fix held.** The posted comment named the reason and pointed at the run log; the stack
  trace went to stderr only. This was the first live exercise of that path.

**Still confounded.** Run 3 changed model, `temperature: 0`, and the rubric together. Routing is now
the strong explanation, but the temperature pin has still never been observed on a completing run.
Run 4 keeps model, temperature and rubric fixed and adds only `require_parameters`, which tests the
routing hypothesis directly.

**It also cost nothing.** OpenRouter billed $0.00 for run 3, so this diagnosis was free.

## What run 4 established: the routing fix was necessary but not sufficient

Run 4 added `require_parameters: true` and changed nothing else — same model, same temperature, same
rubric, same SHA range. It failed **identically**: `no-output-generated`, this time after 5m11s
rather than 9m41s.

So the routing gap was real, and fixing it was right on its own merits — a request carrying
`response_format` should never be eligible for an endpoint that ignores it, whatever model ships.
But it was **not the cause**, and the run-3 correction above overstated the case by presenting it as
the explanation rather than as one contributing defect.

The evidence now points back at the model, and more precisely at one behaviour: `z-ai/glm-4.7` does
not reliably emit a schema-valid object at the *end of a long tool loop*. Note what did **not**
happen in either run — neither hit `step-budget-exhausted`, and neither had `finishReason:
"tool-calls"`. The loop ended on the model's own terms, with the tools already withdrawn by the
final-step net, and it still produced no object. That is a structured-output failure, not a
budget one.

Two runs is enough. The model is recorded here as a dead end for this workload rather than retried a
third time.

**If it is ever revisited**, the specific untried lever is `structuredOutputs: { strict: false }` on
the model factory — the OpenRouter provider documents it as *"allow non-strict mode for less strict
models"*, and strict `json_schema` at the end of a 20-step loop is exactly the demand these runs
failed. That is a package change, not a config one, and it should be its own experiment with its own
calibration rows — not folded into a phase that needs a working reviewer.

## What run 5 established: a job timeout silently un-gates the merge

Run 5 was glm-4.7's third and last attempt, adding `structuredOutputs: { strict: false }` — the
provider's documented allowance for "less strict models", and the one lever runs 3 and 4 never
touched. It did not return a verdict either. It ran until the job's `timeout-minutes: 20` killed it
at **20m20s**.

**The far more important finding is what the timeout did to the gate.** A job killed by
`timeout-minutes` is **cancelled**, and every remaining step is skipped:

```
3 Run ./.github/actions/ai-code-review -> cancelled
4 Post the review comment              -> skipped
5 Apply the verdict label              -> skipped
6 Fail the check when the verdict...   -> skipped
```

No comment. No label (the `ai-cr:failed` on the PR was stale, left over from run 4). No `exit 1`.
And the resulting check:

```
review: state=CANCELLED bucket=cancel
gh pr checks 37           → exit 0
gh pr checks 37 --watch   → exit 0
```

`bucket=cancel` is neither pass nor fail, and `gh pr checks` only exits non-zero on `fail`.
**`tm-ship` reads exactly that exit code and, on 0, proceeds to merge.** A review that never ran to
completion would have let the merge through — the precise failure the whole design exists to
prevent, and the opposite of what Phase 4 recorded.

The Phase 4 claim that an incomplete review always resolves to `failed` was **wrong**. It holds for
every failure the *script* can observe, and the script's 0/1/2 contract is sound. It does not hold
when the *job* is cancelled out from under it, because the steps that carry the verdict never run.
`continue-on-error` cannot help: it handles a failing step, not a cancelled job.

### The fix

**A step-level `timeout 900` around the script**, in the composite action. Bounded there, an
over-running review is an ordinary *step* failure — `bucket=fail`, red check, `gh pr checks` exits
1, `tm-ship` stops. The job's `timeout-minutes: 20` goes back to being a genuine backstop for a hang
somewhere other than the script.

`if: always()` was also added to the workflow's comment, label, and fail steps. That is defence in
depth, **not** the fix: a job cancelled by GitHub reports `bucket=cancel` no matter what those steps
do. Only keeping the cancellation from happening keeps the gate honest.

**Generalisable lesson.** "The check goes red on failure" is not one property. A CI gate has at
least three non-success shapes — failed, cancelled, and skipped — and a consumer that branches on
an exit code may treat only one of them as blocking. Any gate whose value is *stopping* something
needs testing against a timeout and a cancellation, not just against a failing assertion.

## What run 6 established: the two Phase 5 fixes were mutually exclusive

Run 6 was the return to `anthropic/claude-sonnet-5` — the model that completed runs 1 and 2. It
failed in **14 seconds**, before a single token, with:

```
AI_APICallError: No endpoints found that can handle the requested parameters.
```

`require_parameters: true` filters on **every** parameter in the request, not only the interesting
ones. And `GET /api/v1/models/anthropic/claude-sonnet-5/endpoints` shows that **not one of its nine
endpoints declares `temperature` support** — all nine report `temperature=false`. So the two fixes
this phase introduced were mutually exclusive on the shipping model: `require_parameters: true`
(routing safety) and `temperature: 0` (scoring stability) together left zero eligible endpoints.

**The larger correction: the temperature pin never could have worked here.** Not "it worked and we
traded it away" — on Sonnet it is inert by construction. Without `require_parameters` OpenRouter
silently drops it; with it, the request fails. Every claim made in this phase about pinning
temperature to stabilise scores was wrong for the model that actually ships.

So the stability fix for item 5.4 is **the rubric's decision-band section alone**, not a pair of
levers with prose as the junior partner. That raises what rides on runs 7+: they are now the only
evidence that the band anchors work.

Resolution: keep `require_parameters: true`, drop the temperature pin. Three of Sonnet's nine
endpoints report `structured_outputs=false` (the Google ones), so the routing protection is worth
real money here and is not glm-specific. The temperature plumbing stays in place, unset by default
and env-driven, because it is genuine and another model may honour it.

**Cost: $0.** The request never reached a provider.

### Standing conclusion on model choice

Two models now have evidence against them at this job — `claude-haiku-4.5` (package README) and
`z-ai/glm-4.7` (runs 3, 4 and 5) — against one with evidence for it, `anthropic/claude-sonnet-5`
(runs 1 and 2, both completing with all five criteria). The demanding part of this workload is
emitting a valid structured object after a long tool loop, and it is not predicted by a model's
advertised `tools` + `structured_outputs` support. **Treat any future model swap as an experiment
requiring its own calibration runs, never a config edit.**

`z-ai/glm-4.7` is settled: three attempts, three non-completions, across strict and non-strict
enforcement and with provider routing corrected. Every lever identified as plausible has been
pulled. Do not try it again without a new hypothesis.

## Open

- **No run yet on a PR with ≥19 changed files.** The 20-step budget is untested at the size of this
  repository's average PR (19.4 changed files, though prose filtering removes most). Plan item 5.5.
- **No run yet on a deliberately unfalsifiable test.** Criterion 1's floor is unexercised — nothing
  has yet driven it into the 1–3 band on purpose. Plan item 5.2.
- **Cost.** Runs 1 and 2 cost ~$1.50 each on `anthropic/claude-sonnet-5`. Run 3 onwards is on
  `z-ai/glm-4.7` at roughly a fifth of that; whether the cheaper model holds the scoring quality is
  itself an open calibration question, and the first thing rows 3+ should answer.
