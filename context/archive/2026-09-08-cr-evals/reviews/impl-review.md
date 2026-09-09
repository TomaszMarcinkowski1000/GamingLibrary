<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: promptfoo Eval Harness for `packages/code-reviewer`

- **Plan**: `context/changes/cr-evals/plan.md`
- **Scope**: Full plan — Phases 1-4 of 4 (42 of 42 Progress rows checked)
- **Date**: 2026-09-09
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 6 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria — verified this review

| Gate | Result |
|---|---|
| `npm run lint` | pass, 0 errors |
| `npm run typecheck` (`astro check`) | pass, 112 files, 0 errors / 0 warnings |
| `npm test` | pass, 15 files / 261 tests |
| `npm run evals:check` | pass, all 6 answer-key anchors resolve |
| `npm run evals:diff` | pass, regenerated 7955 bytes, `git status` clean |
| `npx prettier --check .` | only pre-existing `stryker.config.json` (untouched by this change) |
| `node -v` >= 22.22.0 | v22.23.2 |
| `git diff main...HEAD -- packages/ .github/` | empty — two "NOT doing" boundaries hold |

All eight "What We're NOT Doing" boundaries hold. All three "Critical Implementation Details"
(bare-then-per-instance `loadConfig`, the throwing `.output` two-arm diagnosis with
`metadata.errorCode`, the load-bearing `.prettierignore` entry) are faithfully implemented and
verified against `packages/code-reviewer/src/config.ts` and `.../agent/review-code.ts`.

Three plan deviations were found, all documented in-repo with the evidence that forced them, and
none is treated as a finding: `vars` carries only `caseId` (array vars expand into a test matrix;
string vars render through nunjucks and the fixture's `dangerouslySetInnerHTML={{` broke a run),
`flaw-recall` is an `assert-set` rather than `derivedMetrics` (mathjs parses `-` as subtraction,
throws, and promptfoo swallows it — leaving the metric at 0, indistinguishable from a model that
found nothing), and the calibrated bar lives as `RECALL_BAR` in TS with its derivation recorded in
the YAML. Progress row 3.4 says `flaw-recall` is "derived and present"; it is present, not derived.

## Findings

### F1 — `evals:diff` silently writes an empty `case.diff` when the trees are identical

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/evals-diff.mjs:72-80`
- **Detail**: `git diff --no-index` exit **0** means the two trees are identical. The guard at :72
  accepts 0 and 1 alike, then :78-79 unconditionally `writeFileSync`s the (empty) result and prints
  `— 0 bytes`, exit 0. This is precisely the silent desync the file's own header (:5-9) says it
  exists to prevent: an empty diff shows the reviewer under test no change at all, every model
  scores whatever it invents, and nothing errors. It also destroys the committed diff in the same
  stroke.
- **Fix**: Treat `status === 0` (or `diff.trim() === ""`) as a hard error and throw before writing,
  rather than folding it in with the expected exit 1.
  - Strength: Restores the property the header claims; the empty-diff case is never legitimate.
  - Tradeoff: None — three lines, no behaviour change on a healthy fixture.
  - Confidence: HIGH — the branch is right there and the intent is stated in the same file.
  - Blind spot: None significant.
- **Decision**: FIXED — exit 0 and an empty diff now throw before `case.diff` is written (scripts/evals-diff.mjs:71-88); `npm run evals:diff` re-verified clean

### F2 — Neither eval gate is enforced by CI or the pre-commit hook

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `.github/workflows/ci.yml`, `.husky/pre-commit`, `package.json:23-24`
- **Detail**: `grep -rn "evals" .github/ .husky/` returns nothing, and `lint-staged` does not invoke
  them either. `evals/README.md:188` calls the clean-tree result of `evals:diff` "this layer's
  gate", but it is a gate only if someone remembers to type it. Compounding this: `evals/cases/**`
  is deliberately excluded from `tsconfig.json`, `eslint.config.js` *and* `.prettierignore`, so no
  automated check whatsoever touches the fixture tree. Edit `after/`, forget both commands, and the
  eval keeps running while grading against stale line numbers — the exact failure the anchor
  mechanism was built to catch. This is a gap the plan left open, not a deviation from it: the plan
  named these as phase gates, never as standing checks.
- **Fix A ⭐ Recommended**: Add `npm run evals:check && npm run evals:diff && git diff --exit-code evals/cases`
  as a step in the existing `ci` job.
  - Strength: Needs no secrets and makes no model call, so it fits the `ci` job's existing
    constraints exactly; catches the desync on every push and PR rather than at the next sweep.
  - Tradeoff: A few seconds of CI time; a contributor who edits the fixture learns about it at push
    rather than at commit.
  - Confidence: HIGH — both commands already run offline and green in this review.
  - Blind spot: Whether `git diff --exit-code` is stable on the CI runner's line endings —
    `.gitattributes` sets `* text=auto eol=lf`, which should settle it, but it is untested there.
- **Fix B**: Add the same pair to the husky pre-commit hook.
  - Strength: Fails at commit time, closest to the mistake.
  - Tradeoff: Slows every commit in the repo for a fixture almost no commit touches; the hook
    already runs `lint-staged` plus a full `astro check`.
  - Confidence: MEDIUM — works, but the cost lands on all contributors for a narrow risk.
  - Blind spot: Interaction with `lint-staged`'s partial-staging stash is not verified.
- **Decision**: FIXED via Fix A — new `Eval fixture gates` step in the `ci` job (.github/workflows/ci.yml:64-76) runs `evals:check`, `evals:diff` and `git diff --exit-code -- evals/cases`; verified green locally

### F3 — `rootDir` / `paths[]` containment is asserted in the failure message but never checked

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `evals/case.ts:64,98`; `scripts/evals-check-case.mjs:53-58,68`
- **Detail**: `rootDir` and `paths[]` come out of `case.json` as free strings (`case.ts:64` enforces
  only `min(1)`) and are joined onto the case directory at `case.ts:98` with no containment check.
  `createPathGuard` then faithfully sandboxes the agent to whatever that resolves to — so a
  `case.json` with `"rootDir": "../../.."` would hand the model the whole repository, including the
  `.env` holding `OPENROUTER_API_KEY` and the Supabase keys, and the model could echo file contents
  into `findings[]`. The gate does not catch it: `evals-check-case.mjs:53` tests only `existsSync`,
  which `../../..` satisfies, and :58 accepts a `paths[]` entry of `../../.env` while printing
  "does not resolve under rootDir" — a message claiming a property it never verifies. Only reachable
  through a committed, human-reviewed `case.json`, hence WARNING rather than CRITICAL; but the
  sandbox root is the one invariant this harness rests on and it is the one the gate skips.
- **Fix**: In `evals-check-case.mjs` (and/or as a `.refine` on the zod schema), assert
  `path.relative(caseDir, resolvedRoot)` is non-empty and does not start with `..`, and apply the
  same test to every `paths[]`, `flaws[].file` and `decoys[].file` against the resolved root.
  - Strength: Makes the existing failure message true, and closes it before the corpus grows past
    one hand-authored case.
  - Tradeoff: None meaningful — a few lines in a script that already walks all of these.
  - Confidence: HIGH — the check is local and the current fixture passes it trivially.
  - Blind spot: None significant.
- **Decision**: FIXED — lexical `containedPath` refinement on `rootDir`/`paths[]`/`diffPath`/`flaws[].file`/`decoys[].file` (evals/case.ts:20-36) plus a `contains()` assertion in scripts/evals-check-case.mjs; verified with negative fixtures (`../../..` rootDir and a `../../../.env` flaw file both now FAIL in the gate and throw in `loadCase`), lint + typecheck green

### F4 — `evals/reviewer.ts` hand-mirrors ~120 lines of package types with no compile-time link

- **Severity**: WARNING
- **Impact**: HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Scope Discipline
- **Location**: `evals/reviewer.ts:26-148`
- **Detail**: The largest unplanned surface in the change, and the plan never mentions the file. It
  exists because two plan constraints collide that the plan did not notice: "Not changing
  `packages/code-reviewer`" plus a root `astro check` that must pass on a clean checkout where the
  package's `dist/` does not exist. The header's justification is sound and matches how
  `scripts/pr-review.mjs:40` loads the same package. But `pr-review.mjs` is `.mjs` and restates
  *nothing*; this file restates `Review`, `CriterionScore`, `Finding`, `RunUsage`, `AgentStep` and
  the barrel signatures. They match `packages/code-reviewer/src/schemas/*` exactly today, and there
  is no compile-time link, so a schema change in the package drifts silently and the harness keeps
  compiling. The stated mitigation (`reviewer.ts:12-15` — `npm run evals` builds first, so drift
  surfaces as a TypeError on cell 1) is runtime, costs a paid sweep to discover, and nothing in CI
  exercises it.
- **Fix A ⭐ Recommended**: Accept the duplication and make the drift detectable cheaply — add a
  pointer comment in the package's schema files back to `evals/reviewer.ts`, and a note in
  `evals/README.md` under "What this does not measure".
  - Strength: Preserves both plan constraints, costs nothing, and puts the warning where someone
    editing the schema will actually see it.
  - Tradeoff: Still relies on a human noticing the pointer; the drift remains runtime-detectable only.
  - Confidence: HIGH — matches how the rest of this change handles known-imperfect boundaries
    (`metadata.costBasis`, the caching caveat): record the risk in place rather than engineer it away.
  - Blind spot: Whether the package's schemas are stable enough that this suffices — nothing here
    has measured their churn rate.
- **Fix B**: Add a typecheck-time structural assertion inside `packages/code-reviewer` that fails if
  its exported shapes diverge from a copy of the mirrored interfaces.
  - Strength: Turns silent drift into a build failure in the package's own CI job, which already
    runs and already builds.
  - Tradeoff: Puts eval-specific knowledge inside the generic reviewer — the exact dependency
    inversion the plan's `evals/` placement exists to avoid, and a change to `packages/` this plan
    explicitly ruled out.
  - Confidence: MEDIUM — mechanically straightforward, but it trades a stated architectural boundary
    for a maintenance convenience.
  - Blind spot: Not checked whether the package's CI job would need new deps to host the assertion.
- **Decision**: FIXED via Fix A — duplication accepted; pointer header added to packages/code-reviewer/src/index.ts and a one-line pointer to src/schemas/{criterion,finding,review}.ts, plus a "What this does not measure" bullet in evals/README.md. Note: this makes the change's first comment-only edit under packages/ (the "not changing packages/code-reviewer" boundary now holds for behaviour, not for bytes); the same edit also corrected the stale "No CI wiring" bullet to match F2's new CI step. Package typecheck and prettier green

### F5 — The `.mjs` validator duplicates `case.ts`'s zod schema and has already diverged from it

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `scripts/evals-check-case.mjs:22,53-101` vs `evals/case.ts:18,64`
- **Detail**: Two validators make different claims about the same file. `case.ts:18` declares
  `severities = ["info","minor","major","critical"]`, mirroring the package's finding schema;
  `evals-check-case.mjs:22` has `new Set(["critical","major","minor"])` and omits `info` — while the
  script's own doc comment at :12 says it checks "a severity the review schema uses". A flaw marked
  `info` passes zod at runtime and fails the gate. Same root cause, second symptom: the script reads
  `key.rootDir`, `key.paths`, `key.flaws`, `key.decoys` with no shape validation after `JSON.parse`,
  so a `case.json` missing `flaws` dies with `TypeError: key.flaws is not iterable` instead of
  emitting the `FAIL` line the script exists to produce.
- **Fix**: Align the script's severity set with `case.ts` (or have it consume the zod schema), and
  guard the property reads so a malformed key produces a `FAIL` line rather than a stack trace.
  - Strength: Removes a divergence that is already real, in the gate whose whole job is to be
    trustworthy about the answer key.
  - Tradeoff: Sharing the zod schema across the `.ts`/`.mjs` boundary is the awkward part; syncing
    the literal and adding the guards is the cheap 90%.
  - Confidence: HIGH — both files read directly.
  - Blind spot: None significant.
- **Decision**: FIXED — went past the cheap 90%: the script now imports `evalCaseSchema` from evals/case.ts (Node 22 strips the types on import) and runs it as the structural pass, so the duplicated severity list and the unguarded property reads are both gone and the two validators cannot disagree again. Verified: an `info` severity now passes, a missing `flaws` yields `FAIL flaws: Invalid input: expected array, received undefined` instead of a TypeError, and a bogus severity names the four valid options. lint + typecheck + both gates green

### F6 — `evals-diff.mjs` follows neither script convention and can leave a partial regeneration

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `scripts/evals-diff.mjs:83-96`
- **Detail**: The repo has two established shapes: `scripts/pr-review.mjs:176,288` uses
  `async function main()` returning an exit code with `process.exitCode = await main()`, and
  `scripts/seed-e2e-user.mjs` uses a `fail()` helper plus `process.exit(1)`. Its sibling
  `evals-check-case.mjs:24-28,105-108` correctly follows the second. `evals-diff.mjs` follows
  neither: the driver loop is top-level with no `try`/`catch`, so a case directory missing
  `before/`/`after/` makes git exit 128, `generate` throws, and the process dies with a raw stack
  *after* having already rewritten earlier cases' `case.diff` — a partial regeneration silently left
  in the working tree.
- **Fix**: Wrap the driver in the `main()`/`process.exitCode` shape its sibling already uses, so a
  failure reports legibly and does not half-rewrite the corpus.
- **Decision**: FIXED — driver wrapped in `main()` with `process.exitCode = main()` (the pr-review.mjs shape), and `generate()` no longer writes: every case is generated into memory first and written only once all of them succeed, so a mid-corpus throw leaves the tree untouched. Verified with a deliberately broken case directory sorting after the real one — output was a single `FAIL` line plus "Nothing was written", exit 1, and the existing case.diff kept its md5

### F7 — Cell-timeout comment says twelve minutes; the constant is twenty

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `evals/providers/code-reviewer.ts:34-37`
- **Detail**: The doc block closes "Twelve minutes is roughly twice the slowest completed calibration
  run" directly above `const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000`. `evals/README.md:372`
  corroborates that twelve minutes was the value when the deepseek cell was killed, so the constant
  was raised later and the justification left behind. The prose no longer supports the number. In a
  codebase where comments carry this much of the reasoning, a stale one is a real defect, not a nit.
- **Fix**: Update the sentence to state the twenty-minute value and what it is now twice of.
- **Decision**: FIXED — comment now states the twenty-minute value and re-derives it against the record rather than the stale "twice the slowest run" claim: slowest completed cell 174.8s (baseline.md), longest runaway 9m41s (calibration.md run 3), and since the output cap landed a runaway ends in minutes with `finishReason: "length"`, so this ceiling is only the wedged-connection backstop

### F8 — Onboarding docs omit the node floor, and `CLAUDE.md` never mentions the harness

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `evals/README.md`, `CLAUDE.md`
- **Detail**: Two gaps in the same seam. (a) The plan's Phase 1 doc contract for `evals/README.md`
  names three prerequisites — the node floor, `OPENROUTER_API_KEY`, and the build step. The README's
  488 lines cover the last two (:184, :178-183) but never state `>=22.22.0` or mention `.nvmrc`; the
  one prerequisite a newcomer hits first is the one not written down, and it currently lives only in
  `CLAUDE.md:51`. (b) `CLAUDE.md` carries dedicated `## E2E tests` and `## Mutation testing` sections
  for comparable subsystems and gains no `evals/` section at all — none of
  `npm run evals{,:view,:diff,:check}` appears in its Commands list, so a future agent will not learn
  the harness exists or that `evals/cases/` is deliberately excluded from all three repo gates. The
  plan never asked for a `CLAUDE.md` section, so (b) is a gap in the plan rather than a deviation.
- **Fix**: Add a Prerequisites line to `evals/README.md` naming the node floor, and a short
  `## Evals` section to `CLAUDE.md` in the shape of its E2E section — the four commands, and the
  warning that the fixture's tsconfig/eslint/prettier exclusions are load-bearing.
- **Decision**: FIXED — (a) `**Prerequisites**` paragraph added above evals/README.md's Commands block naming the >=22.22.0 floor, .nvmrc, the key and the build, and noting that evals:check/evals:diff need neither key nor build; (b) new `## Evals` section in CLAUDE.md in the shape of its E2E section — the four commands, the load-bearing tsconfig/eslint/prettier exclusions and the new CI step, plus the evals/reviewer.ts mirroring warning from F4

### F9 — The sweep found a production false-green in `deriveVerdict`, recorded but not tracked

- **Severity**: OBSERVATION
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `context/changes/cr-evals/baseline.md:172-200`; `scripts/pr-review/verdict.mjs`
- **Detail**: The calibration sweep surfaced a defect in the shipping merge gate, not just in the
  models under test: two of nine cells returned `verdict: passed` on a diff shipping a stored XSS.
  deepseek wrote `Band: 1-2 (blocking)` in its own rationale and then scored the criterion **4** —
  `deriveVerdict` reads the digit, so the change passed. `baseline.md:194` records this happened in
  two of three deepseek repeats, and notes the criterion digits swing hard on identical input
  (`test-falsifiability` 2 → 7 → 1). This is arguably the most valuable output of the whole change
  and it is written up thoroughly — but it lives only in prose inside a completed change folder,
  with no follow-up opened, and the plan's "Not tuning the rubric" boundary means it was correctly
  left unfixed here. Once `cr-evals` is archived, the finding goes with it.
- **Fix**: Open a follow-up change for the band/digit contradiction in the production PR gate
  (`scripts/pr-review/verdict.mjs` and/or the rubric's band prose), citing `baseline.md`'s evidence,
  so the discovery outlives this change folder.
  - Strength: Preserves a real production-safety finding that the harness was built to produce and
    that nothing else in the repo currently tracks.
  - Tradeoff: Opens scope this plan deliberately closed; the fix itself is non-trivial (making a
    model's digit obey its own stated band is the hard part, and `baseline.md:199-200` already
    observes rubric prose alone was not enough on a cheap model).
  - Confidence: HIGH that the finding is real — quoted verbatim from the run. MEDIUM on the remedy.
  - Blind spot: Not assessed whether production is meaningfully exposed, since CI runs Sonnet, which
    scored 1.00 on every repeat and never produced the contradiction.
- **Decision**: QUEUED — not fixed here (the plan's "not tuning the rubric" boundary stands). Written up in context/changes/cr-evals/follow-ups/review-fixes.md with the baseline.md:172-200 citation, the two-of-three repeat rate, the mechanical-vs-prompt remedy tradeoff, and the unassessed-production-exposure caveat, so the finding survives `/10x-archive`. No change folder opened
