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
3. **Sampling temperature is pinned to 0** (`pr-review.mjs`). The seam existed on
   `createReviewAgent` all along — its docstring says "pin it low for reproducible eval runs" — but
   `reviewCode` never forwarded it, so no caller could reach it. This is the smaller half of the
   fix and buys no determinism on its own: OpenRouter can route one model id to different providers
   between runs.

Runs 3+ test whether that holds. Two runs on one unchanged SHA remain the check for plan item 5.4.

## Open

- **No run yet on a PR with ≥19 changed files.** The 20-step budget is untested at the size of this
  repository's average PR (19.4 changed files, though prose filtering removes most). Plan item 5.5.
- **No run yet on a deliberately unfalsifiable test.** Criterion 1's floor is unexercised — nothing
  has yet driven it into the 1–3 band on purpose. Plan item 5.2.
- **Cost.** Runs 1 and 2 cost ~$1.50 each on `anthropic/claude-sonnet-5`. Run 3 onwards is on
  `z-ai/glm-4.7` at roughly a fifth of that; whether the cheaper model holds the scoring quality is
  itself an open calibration question, and the first thing rows 3+ should answer.
