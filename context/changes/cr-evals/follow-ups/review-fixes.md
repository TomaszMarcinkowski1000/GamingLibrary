# Follow-ups from the implementation review

Queued during triage of `reviews/impl-review.md` (2026-09-09). Items here were deliberately **not**
fixed inside this change; they need their own change folder.

## The band/digit contradiction in the production PR gate

- **From**: F9 (OBSERVATION, Scope Discipline)
- **Evidence**: `context/changes/cr-evals/baseline.md:172-200` — keep this citation; it is the only
  record of the run.
- **Touches**: `scripts/pr-review/verdict.mjs`, and the "decide the band first, then the digit"
  section of `scripts/pr-review/rubric.mjs`.

The calibration sweep found a defect in the **shipping merge gate**, not only in the models under
test. Cell 2.1 (`deepseek/deepseek-v4-flash`, repeat 2) filed a real, correct finding for the stored
XSS, wrote `Band: 1–2 (blocking)` in its own `security-isolation` rationale — "Score 4 because the
defect is nameable and concrete, placing it in the blocking band (1–2)" — and then emitted **4**.
`deriveVerdict` reads only the digit, so `verdict: passed` on a diff shipping a stored XSS.

Not a one-in-nine event: repeat 3 produced the same contradiction and was saved from being a second
false green only by unrelated criteria landing at 1. Two of three deepseek repeats. `baseline.md`
also records criterion digits swinging hard on identical input (`test-falsifiability` 2 → 7 → 1).

**Why it was left here.** This plan's "What We're NOT Doing" ruled out tuning the rubric, and that
boundary was correct — the discovery is the harness working as intended. But the write-up lives only
in prose inside a change folder that `/10x-archive` will move, so without this note the finding goes
with it.

**What a follow-up has to weigh**, before anyone reaches for prompt wording:

- The hard part is making a model's digit obey its own stated band. `baseline.md:199-200` already
  records that rubric prose alone was not enough on a cheap model — the same failure
  `context/archive/2026-09-07-ci-cd-code-review/calibration.md` runs 1 and 2 saw on Sonnet.
- A mechanical remedy (parse the stated band out of the rationale and let the *lower* of band and
  digit decide; or make a blocking phrase in the rationale block the merge regardless of score) does
  not depend on the model cooperating. It costs false negatives on models that write loosely.
- **Production exposure is unassessed.** CI runs Sonnet, which scored 1.00 on every repeat here and
  never produced the contradiction. That is an argument about likelihood, not about the gate being
  sound — and it is exactly the assumption to check first, since it is the only thing standing
  between this defect and a real merge.
- Whatever lands should be re-measured on this harness rather than argued about: it is the
  instrument that found it.
