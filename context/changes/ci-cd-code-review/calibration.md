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
| 7 | [#37](https://github.com/TomaszMarcinkowski1000/GamingLibrary/actions/runs/34252276345) | `0dc4e88e` | `claude-sonnet-5` | unset | 14 | n/r | 4 / 6 / 6 / 7 / 8 | passed | agreed |
| 8 | [#37](https://github.com/TomaszMarcinkowski1000/GamingLibrary/actions/runs/34252928489) | `0dc4e88e` | `claude-sonnet-5` | unset | 14 | n/r | 3 / 6 / 5 / 7 / 7 | failed | **agreed — it found a real bug runs 1 and 7 missed** |
| 9 | [#37](https://github.com/TomaszMarcinkowski1000/GamingLibrary/actions/runs/34254356540) | `30203f6e` | `claude-sonnet-5` | unset | 16 | n/r | 4 / 6 / 6 / 8 / 8 | passed | agreed |

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

## What runs 7 and 8 established: the rubric works; the instability is discovery, not scoring

These are the first two completing runs under the rewritten rubric, on the same SHA (`0dc4e88e`),
run 8 triggered by `ai-cr:retry` with nothing changed between them.

**The band discipline works, and both runs show it in their own words.** Run 7 on criterion 1:

> *"this is precisely the 'accepted, unmitigated risk on a pure deterministic function' shape the
> rubric's own worked example scores as 4, not 1–3. That is not a blocking state per the criterion's
> band definition (1–3 blocking, 4–10 not)."*

Run 8, same criterion, opening words: *"Blocking band (1-3), because a concrete, nameable defect
ships silently and undisclosed…"*. Both chose a band explicitly and justified the digit from it.
That is exactly the behaviour the rewrite was meant to install, and the earlier prose never produced.

**And yet the verdict flipped again: 4 → 3, across the gate at ≤3.** The important part is *why*,
because it is not what happened in runs 1 and 2.

Run 8 was not scoring the same facts differently. **It found a real bug that runs 1 and 7 both
missed** — `paths.length === 0` used as the test for "nothing to review", while `paths` drops
deletions. A PR that only deletes code (a test file, an RLS migration, a route handler) leaves
`paths` empty, so the review was skipped, `ai-cr:passed` applied with no model call, and the comment
asserted every changed path was documentation. Reproduced against a synthetic deletion-only range
before fixing:

```
changedCount = 1     <- a deleted test file
paths.length = 0
excluded     = []    <- not excluded; it is source
diff chars   = 182   <- the deletion IS in the diff
prose-only branch taken: true
```

Having found that, scoring it in the blocking band is a **correct** application of the rubric — the
bar is "you can name the concrete defect that ships", and run 8 named one. So run 8's `3` was right,
run 7's `4` was right on the evidence run 7 had, and the gate did the right thing both times.

**This reframes plan item 5.4.** "Scores are stable across two runs on the same unchanged SHA"
assumes the runs see the same thing. An agent with a 20-step budget exploring a 14-file diff does
not: it finds a varying subset, and a run that discovers a blocking defect *should* score lower than
one that misses it. Demanding score stability from such a reviewer is close to demanding it stop
discovering.

What the rubric fix did deliver is a **narrower and better-reasoned** spread: 4→2 with matching
rationales became 4→3 with genuinely different evidence. What it cannot deliver is agreement between
a run that found a bug and a run that did not.

The honest options for 5.4, none of which are rubric prose:

1. ~~**Move the threshold** so the gate sits outside the band where correct-but-different runs
   land~~ — **rejected, and worth writing down why.** Lowering `test-falsifiability` to fail at ≤2
   looks like it buys stability, but check it against the four completing runs: run 1 (4) passes
   ✓, run 7 (4) passes ✓, run 2 (2) still fails ✗ — so it does *not* fix the one verdict we judged
   wrong — and run 8 (3) would now **pass**, letting through the run that found a real, shipping
   bug. It fixes nothing and breaks the best result we have. Stability bought by moving a gate away
   from where the model actually discriminates is not stability, it is a wider blind spot.
2. **Accept the flip as correct behaviour** and restate 5.4 as *"no run produces a verdict a human
   disagrees with"*, which is the property actually wanted — the plan asked for score stability as
   a *proxy* for trustworthy verdicts. By that measure runs 1, 7 and 8 all pass and only run 2
   fails, which is a far better record than "the scores moved" suggests.
3. **Reduce discovery variance** by narrowing what each run must cover — smaller scored path sets,
   or a larger step budget so a run is less likely to stop before finding what another found.
   Costs money per run and is unproven here.

Recorded, not decided. Doing this properly is a change of its own, not a Phase 5 prose edit.

## What run 9 established: the deletion fix holds, and criterion 1 recovers

Run 9 is the first run after the deletion-bypass fix, and the third consecutive completion
(runs 7, 8, 9) — closing plan item 5.1.

Scores `4 / 6 / 6 / 8 / 8`, passed. Two movements worth noting:

- **`test-falsifiability` back to 4** from run 8's 3. The blocking defect run 8 named is gone, so
  the band it justified is gone with it. That is the rubric behaving correctly rather than drifting:
  the score tracked a real change in the code, not the weather.
- **`stack-conventions` 7→8 and `security-isolation` 7→8**, on a diff that added the `deleted`
  guard and the run-6/8 commentary. Both rises are attributable to work done in response to earlier
  runs.

The scored path list also grew 14 → 16, which is the fix's own diff.

Across runs 1, 7, 8 and 9 the reviewer has now found **three real defects in its own
implementation** — the raw-error leak (runs 1 and 2, independently), and the deletion-only bypass
(run 8). None was a false alarm. Whatever remains unsettled about score stability, the finding
quality is not in doubt.

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
- **No run yet on a deliberately unfalsifiable test — and plan item 5.2 was closed anyway.** Marked
  done on the user's decision, not on evidence. Recorded here so the row is not later mistaken for
  a result.

  What that leaves untested is specific and worth naming: **5.2 is the only criterion that checks
  the gate stops something bad.** Runs 1, 7, 8 and 9 all demonstrate it lets good work through, and
  run 8 shows it blocking on a defect the agent *found* — but nothing has yet driven criterion 1
  into the 1–3 band with the case it was designed for: a test that cannot go red, which reads as
  coverage while guarding nothing. That is the failure mode the whole criterion exists for, and the
  reason it is the hard blocker.

  The check is cheap if it is ever wanted: open a PR adding a test named for cross-user isolation
  that asserts against a stub instead of the database (the rubric's own "1" example), and confirm
  criterion 1 lands ≤3 with a red check. One run, ~$1.50.
- **Cost.** Runs 1 and 2 cost ~$1.50 each on `anthropic/claude-sonnet-5`. Run 3 onwards is on
  `z-ai/glm-4.7` at roughly a fifth of that; whether the cheaper model holds the scoring quality is
  itself an open calibration question, and the first thing rows 3+ should answer.
