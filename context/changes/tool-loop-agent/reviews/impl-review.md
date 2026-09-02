<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Tool-Loop Code Review Agent

- **Plan**: `context/changes/tool-loop-agent/plan.md`
- **Scope**: Full plan — Phases 1-3 of 3 (commits `fd3506f`, `5e8ca86`, `7a76d3c`, `25e9a71`)
- **Date**: 2026-09-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 7 warnings, 4 observations (F7-F11 appended 2026-09-02 from a safety-scan sub-agent that reported after the report was written)
- **Triage**: complete — F1-F5 and F7-F11 fixed, F6 skipped (2026-09-02)

## Triage outcome

| Finding | Decision |
|---|---|
| F1 `search_code` subtree-relative paths | FIXED |
| F2 step budget 10 vs 20 in plan | FIXED (plan Addendum A) |
| F3 unplanned `prepareStep` / widened options | FIXED via Fix A (plan Addendum B) |
| F4 README example disables the net | FIXED |
| F5 `search_code` reads before size cap | FIXED |
| F6 symlink branch unpinned by a test | SKIPPED |
| F7 `read_file` returns unbounded bytes | FIXED via Fix A |
| F8 mistyped search path returns empty success | FIXED |
| F9 rethrown errors leak the absolute path | FIXED via Fix A |
| F10 walk unbounded on directories | FIXED |
| F11 `step-budget-exhausted` unreachable | FIXED via Fix A |

Re-verified after every fix: `npm run typecheck` exit 0, `npx eslint packages/code-reviewer/src`
exit 0, `npm run build` exit 0. Behaviourally, against the built package: `search_code` returns
root-relative paths from a subtree search and refuses a mistyped path; `read_file` caps a 1.9 MB
one-liner at 150,003 chars with `truncated:true` while leaving a normal file whole; `opaqueFsError`
strips the absolute path and keeps the original on `cause`. F11's diagnosis is verified by reading
both files together, not against a live budget-exhausted run.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria — independently re-run

| Criterion | Result |
|---|---|
| 1.1 / 2.1 / 3.1 `npm run typecheck` | exit 0 |
| 1.2 / 2.2 / 3.2 `npx eslint packages/code-reviewer/src` | exit 0 (from repo root) |
| 1.3 / 2.3 / 3.3 `npm run build`, declarations emitted | exit 0, `dist/*.d.ts` present |
| 3.4 barrel import purity | Verified: imported `dist/index.js` from a scratch dir holding a `.env` with `PURITY_CANARY`, `OPENROUTER_API_KEY` unset — canary still unset after import, clean exit |
| 3.5 `MockLanguageModelV4` | Verified: `createReviewAgent({model: new MockLanguageModelV4({}), rootDir})` returns a `ToolLoopAgent`, no credential |
| 3.6 no `./review.ts` imports | Verified: file deleted in `7a76d3c`; remaining matches are `schemas/review.ts` / `agent/review-code.ts` |
| Barrel export list vs. plan's named list | Exact match — all 11 names, zero extras, zero top-level statements |
| 3.9 escaping path refused as a tool result | Verified directly: `read_file`, `list_files`, `search_code` all return `{ok:false, error:"Refused: …"}` rather than throwing |

**Manual checkboxes are not rubber-stamped.** `README.md:72-86` records empirical run data
("reviewing a single small file has been observed to take nine tool calls";
`claude-haiku-4.5` "often kept calling tools until the budget ran out"), and the step-budget
change from 10 to 20 could only have come from real runs. 2.4-2.6 and 3.9 were re-verified
first-hand during this review.

**Path guard re-verified adversarially.** `src/tools/paths.ts` was probed with 18 cases:
`..`, `../secret.txt`, `../../secret.txt`, `src/../../secret.txt`, the backslash variants
(`src\..\..\secret.txt`, `..\repo-evil\x.txt`, `\..\secret.txt`), absolute paths outside the
root, the `/repo` vs `/repo-evil` segment-boundary case, drive-relative `C:secret.txt`, the UNC
form `//server/share/x`, the `\\?\` prefix, a nonexistent deep path, the legitimate name
`..config`, and a case-mismatched root (`/REPO` vs `/repo`). **Every escape was refused and
every legitimate path allowed.** The `relative()`-based containment is segment-wise and
case-insensitive on Windows as the comment claims, and `realpathOfNearestExisting` correctly
re-appends an unresolved tail that `resolve()` has already normalised. `search-code.ts:82-84`
does not descend symlinked directories (`isDirectory()` is false for a symlink), so the walk
cannot leave the root either. Symlink-escape could not be executed under this shell
(unprivileged `symlinkSync` fails on Windows) — see F6.

## Findings

### F1 — `search_code` returns subtree-relative paths, contradicting its own contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: `packages/code-reviewer/src/tools/search-code.ts:109`
- **Detail**: The match path is computed against the *searched subtree*, not the review root:

  ```ts
  path: relative(resolved.absolutePath, entryPath).split(sep).join("/"),
  ```

  `resolved.absolutePath` is whatever subtree the model passed in `path`. But the tool's own
  `description` (`search-code.ts:41`) says "Paths are relative to the review root", the
  `SearchMatch` doc comment (`search-code.ts:32`) says "One hit: a root-relative path", and
  `REVIEW_INSTRUCTIONS` (`prompts/instructions.ts:16-23`) tells the model paths are
  root-relative and to cite them in findings. `read_file` and `list_files` both echo
  `resolved.relativePath`, which *is* root-relative — only `search_code` diverges.

  Reproduced against the package itself:

  ```
  search_code({query:"createPathGuard", path:"src/tools"})
    -> matches[0].path === "index.ts"             // should be "src/tools/index.ts"
  read_file({path:"index.ts"})
    -> {ok:false, error:"\"index.ts\" does not exist in the review root."}

  search_code({query:"createPathGuard", path:"."})
    -> matches[0].path === "src/tools/index.ts"   // correct only when path is omitted
  ```

  Failure scenario: the model narrows a search to a subdirectory — exactly the usage the
  description encourages ("prefer a specific subdirectory over the root") — then either wastes
  steps on `read_file` calls that are refused, or emits a finding citing `index.ts` when it
  means `src/tools/index.ts`. Wrong file citations in the package's primary output.
- **Fix**: Make the hit path root-relative. `createPathGuard` already returns `root`, which
  `createReviewTools` currently discards (`tools/index.ts:98`); thread it into
  `createSearchCodeTool` and compute `relative(root, entryPath)`. Alternatively compose from
  the guard's own `resolved.relativePath` without changing signatures.
  - Strength: Restores the contract the description, the `SearchMatch` doc, and the agent
    instructions all already state; brings `search_code` in line with the two sibling tools.
  - Tradeoff: Threading `root` is a small signature change across `tools/index.ts` and
    `search-code.ts`; the compose-from-`relativePath` variant avoids that but needs a
    `"." -> ""` special case.
  - Confidence: HIGH — reproduced end-to-end above, and the correct shape is visible in
    `read-file.ts:65` and `list-files.ts:57`.
  - Blind spot: None significant. The `searchedPath` field means a careful model *could*
    reconstruct the path, so the bug degrades rather than breaks a run.
- **Decision**: FIXED — `search_code` now computes hit paths against the guard's `root` (threaded into `createSearchCodeTool`). Verified end-to-end: `search_code({path:\"src/tools\"})` returns `src/tools/index.ts`, and `read_file` accepts it.

### F2 — Default step budget is 20, but `plan.md` still says 10 in four places

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `packages/code-reviewer/src/agent/create-agent.ts:16`
- **Detail**: `export const DEFAULT_STEP_BUDGET = 20;`. The plan specifies `isStepCount(10)` at
  `plan.md:117`, `:359` and `:367`, and its Performance section (`plan.md:524`) budgets on it:
  "Cost per review moves from one model call to up to ten steps. `isStepCount(10)` is the
  ceiling". The change is well justified — the code comment and `README.md:79-80` both record
  that a single small file drew nine tool calls, so the budget rather than the evidence was
  deciding when the verdict came — and it is disclosed in `7a76d3c`'s commit message. But the
  plan was never corrected, so the source of truth now understates the per-review cost ceiling
  by 2x, and a future reader diffing plan against code sees an unexplained mismatch.
- **Fix**: Add an addendum to `plan.md` recording the 10 -> 20 change with the nine-tool-call
  evidence, and update the Performance paragraph's cost figure.
- **Decision**: FIXED — `plan.md` gained Addendum A recording the 10 -> 20 change with the nine-tool-call evidence; the Performance section's cost figure now says twenty steps.

### F3 — `prepareStep` and a `stepBudget` option were added, unplanned, against a "not doing" guardrail

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `packages/code-reviewer/src/agent/create-agent.ts:75-80`
- **Detail**: The factory installs a per-step SDK hook:

  ```ts
  ...(budget === undefined ? {} : {
    prepareStep: ({ stepNumber }: { stepNumber: number }) =>
      stepNumber >= budget - 1 ? { toolChoice: "none" as const } : {},
  }),
  ```

  The plan's "What We're NOT Doing" says "Not adding lifecycle callbacks, telemetry, or
  token/cost accounting" (`plan.md:96`). `prepareStep` is a lifecycle callback. It is
  genuinely defensible — without it a model that keeps reading returns nothing rather than a
  verdict from the evidence it has, which is precisely the `claude-haiku-4.5` failure the
  README documents — and it is disclosed in the commit message. Related: `ReviewOptions`
  (`agent/review-code.ts:17-20`) gained `stopWhen?` and `stepBudget?`, where the plan fixed the
  shape at `{model, rootDir, paths, context?}`; and `CreateReviewAgentOptions` gained
  `temperature` and `maxOutputTokens`. All are benign, but together they widen the public
  surface the plan defined without the plan recording it.
- **Fix A ⭐ Recommended**: Keep the code, add a plan addendum covering `prepareStep`, the
  `stepBudget` option, and the widened `ReviewOptions` / `CreateReviewAgentOptions`.
  - Strength: The hook solves a failure mode observed in real runs; removing it would
    reintroduce empty-verdict runs on weaker models. Updating the plan keeps it usable as
    ground truth for the promptfoo work that follows.
  - Tradeoff: The "no lifecycle callbacks" guardrail becomes a softer boundary in retrospect.
  - Confidence: HIGH — the README's model-choice section documents the exact failure the hook
    prevents.
  - Blind spot: Not verified whether `toolChoice: "none"` reliably yields a schema-valid object
    on the final step across providers; only Sonnet was exercised.
- **Fix B**: Remove `prepareStep` and rely on `stopWhen` alone, restoring the planned surface.
  - Strength: Strict scope discipline; smaller API.
  - Tradeoff: Loses the net; budget-exhausted runs return `ReviewError` instead of a partial
    verdict, which the README explicitly warns about.
  - Confidence: MEDIUM — would likely regress the haiku behaviour already observed.
  - Blind spot: No test pins the current behaviour, so the regression would surface only in a
    live run.
- **Decision**: FIXED via Fix A — code kept; `plan.md` gained Addendum B covering `prepareStep`, `stepBudget`, the widened `ReviewOptions` / `CreateReviewAgentOptions`, the `stopWhen`-without-`stepBudget` coupling, and the unverified cross-provider blind spot.

### F4 — README's own example disables the safety net the README documents 30 lines later

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `packages/code-reviewer/README.md:52`
- **Detail**: The "build the agent once" example is:

  ```ts
  const agent = createReviewAgent({ model, rootDir, stopWhen: isStepCount(20) });
  ```

  `create-agent.ts:64` computes
  `budget = stepBudget ?? (stopWhen === undefined ? DEFAULT_STEP_BUDGET : undefined)`,
  so passing `stopWhen` without `stepBudget` leaves `budget` undefined and the `prepareStep`
  net is not installed at all. `README.md:84-85` states this explicitly — "Override `stopWhen`
  and that net goes with it unless you also pass `stepBudget`" — but the example above it does
  exactly that. A reader copying the documented example silently loses the protection the same
  document tells them to keep. The example also uses `isStepCount` without importing it.
- **Fix**: Change the example to `createReviewAgent({ model, rootDir, stepBudget: 20 })`, or
  pass both `stopWhen` and `stepBudget`, and add `isStepCount` to the example's import line.
- **Decision**: FIXED — README example is now `createReviewAgent({ model, rootDir, stepBudget: 20 })`; `isStepCount` is no longer referenced there, so the import line needed no change.

### F5 — `search_code` reads each file fully into memory before applying its size cap

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `packages/code-reviewer/src/tools/search-code.ts:96-101`
- **Detail**: `contents = await readFile(entryPath, "utf8")` runs before
  `if (contents.length > MAX_FILE_BYTES || contents.includes(NUL)) continue;`. The cap is
  therefore a post-hoc filter, not a bound on memory: a 500 MB text file inside the root is
  fully decoded to a JS string and then discarded. `read-file.ts:48-51` gets this right, using
  `stat()` before reading. Also `contents.length` counts UTF-16 code units, not bytes, so the
  constant's name overstates what it enforces. Bounded in practice by `MAX_FILES_WALKED` and
  by the fact that no review root should contain such files, which is why this is an
  observation and not a warning.
- **Fix**: `stat()` each candidate and skip on `size > MAX_FILE_BYTES` before `readFile`,
  matching `read-file.ts`.
- **Decision**: FIXED — `search-code.ts` now `stat()`s each candidate and skips on `size > MAX_FILE_BYTES` before `readFile`, matching `read-file.ts`. The NUL check is unchanged, and the constant now genuinely measures bytes.

### F6 — The guard's symlink branch is the one containment case still unverified, and nothing pins it

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `packages/code-reviewer/src/tools/paths.ts:37-50`
- **Detail**: The plan made a deliberate no-tests decision and put the weight on a manual read,
  adding: "It is written to be small enough to audit by eye — if it grows past that, that is
  the signal to revisit the no-tests decision" (`plan.md:539-543`). The file landed at 108
  lines and the logic is correct — 18 adversarial cases all behaved (see above). But the
  symlink-escape case, the one requirement that motivated `realpathSync` over plain `resolve`,
  could not be executed here: creating a symlink on Windows needs Developer Mode or elevation.
  So the security property rests on reading `realpathOfNearestExisting`, and the verification
  performed during this review lives only in a transcript — the next edit to this file has
  nothing to catch a regression.
- **Fix**: Add a single focused test file for `paths.ts` (the ~18 cases probed here, with the
  symlink case skipped when `symlinkSync` throws EPERM). This does not reopen the broader
  no-tests decision — it covers only the module the plan itself singled out as the one piece of
  security-relevant logic shipping unverified.
  - Strength: Locks in a property that is currently re-derivable only by hand; the plan
    pre-authorised exactly this reconsideration.
  - Tradeoff: Introduces the test runner the plan excluded — a `vitest` devDependency and a
    `test` script in this package (root vitest does not reach `packages/**`).
  - Confidence: HIGH — the cases are already written and passing.
  - Blind spot: Whether the user wants any test infrastructure in this package before the
    promptfoo work lands and settles what the harness looks like.
- **Decision**: SKIPPED — the symlink branch was independently exercised after the report was written (a real `C:\Users\All Users` junction; both the existing-leaf and nonexistent-leaf cases refused), so the property is no longer unverified. Test infrastructure deferred until the promptfoo harness settles.

### F7 — `read_file` bounds file size and line count, but never the bytes it returns

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `packages/code-reviewer/src/tools/read-file.ts:8-10,61-73`
- **Detail**: The two bounds are `MAX_FILE_BYTES = 2_000_000` on the file and `MAX_LINES = 1_500`
  on the slice. Neither bounds the *result*: `MAX_LINES` does not bind when lines are long, and
  unlike `search-code` (`MAX_LINE_LENGTH = 200`) `read-file` truncates no line.

  Reproduced against the built package, with a 1.9 MB single-line file inside the root:

  ```
  read_file({path:"min.js"})
    -> {ok:true, totalLines:1, truncated:false, content: 1_900_003 chars}
  ```

  `stats.size` passes the 2 MB gate, `allLines.length === 1` so `MAX_LINES` never binds, and
  roughly 1.9 MB — on the order of 500k tokens — lands in one tool result, reported as *not*
  truncated. Failure scenario: the model reads a minified bundle, a generated single-line
  `.json`, or a long-line lockfile inside the review root and floods or hard-fails the context
  window on one call. This is the "a single tool call cannot flood the context window"
  requirement (`plan.md` Performance Considerations) failing on its own terms.
- **Fix A ⭐ Recommended**: Cap the total characters returned; when the cap cuts the slice short,
  set `truncated: true` and report the line actually reached in `endLine`.
  - Strength: Bounds the thing that actually costs — the serialized result — regardless of how
    the bytes are distributed across lines. Keeps every returned line intact and citable.
  - Tradeoff: `endLine` becomes "where the cap stopped", so the field means something slightly
    different when the cap fires than when the range ends naturally.
  - Confidence: HIGH — the overflow is reproduced above and the fix is local to `read-file.ts`.
  - Blind spot: None significant.
- **Fix B**: Truncate each returned line to a maximum length, as `search-code` already does.
  - Strength: One constant, mirrors an existing convention in the package.
  - Tradeoff: Silently corrupts the one thing `read_file` exists to provide — a faithful copy of
    the source the model is about to cite. A finding could quote a line that was cut mid-token.
  - Confidence: MEDIUM — bounds the common case, but N long lines still multiply.
  - Blind spot: No cap on how many truncated lines come back, so the result is still unbounded
    in the limit.
- **Decision**: FIXED via Fix A — `read-file.ts` gained `MAX_RESULT_CHARS = 150_000` and a `fitToBudget` helper that fills the budget with whole lines, cutting a single overlong line only when it overflows alone. `endLine` now reports where the result actually stops and `truncated` accounts for the cap. Verified: the 1.9 MB one-liner returns 150,003 chars with `truncated:true` (was 1,900,003 with `truncated:false`); a normal 109-line file still returns whole and untruncated.

### F8 — A mistyped search path returns a successful empty search instead of a refusal

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Safety & Quality
- **Location**: `packages/code-reviewer/src/tools/search-code.ts:70`
- **Detail**: The mid-walk recovery swallows ENOENT for *every* directory popped off the stack:

  ```ts
  if (code === "ENOENT" || code === "EACCES" || code === "EPERM") continue;
  ```

  That rule is right for a subtree that vanished mid-walk. But the first `dir` popped is the
  caller-supplied path, where ENOENT means "you got the path wrong". Reproduced:

  ```
  search_code({query:"anything", path:"src/typo-does-not-exist"})
    -> {ok:true, filesWalked:0, matches:[]}
  list_files({path:"src/typo-does-not-exist"})
    -> {ok:false, error:"\"src/typo-does-not-exist\" does not exist in the review root."}
  ```

  Failure scenario: the model mistypes a directory, reads `{ok:true, matches:[]}` as "this
  symbol has no other callers", and then either files a finding or suppresses a real one on the
  strength of a typo. A confident wrong negative is the worst possible result for a tool whose
  whole job is gathering evidence. The two sibling tools both refuse the same input, so this is
  a divergence in the package's own convention as well as a correctness problem.

  The same first-iteration confusion affects the ENOTDIR branch two lines down
  (`search-code.ts:71-73`), which names `requested` regardless of which directory actually
  failed — so a nested entry replaced by a file mid-walk produces a message about the wrong path.
- **Fix**: Track whether the popped directory is the first (the requested path) and, only for it,
  return the same `does not exist in the review root` refusal `list_files` returns; keep
  `continue` for nested entries. The same flag fixes the ENOTDIR message.
- **Decision**: FIXED — the walk now compares the popped directory against `resolved.absolutePath`; on the requested path ENOENT, ENOTDIR, and EACCES/EPERM each return a refusal, while nested entries keep the mid-walk `continue`. The ENOTDIR message no longer names `requested` for a nested failure. Verified: a typo path returns the same refusal `list_files` gives, and a file passed as `path` returns the use-read_file message. Note the fix also covers EACCES/EPERM on the requested path, which the finding named only in passing — the silent-empty failure mode is identical.

### F9 — Rethrown Node errors send the absolute path and OS username to the model

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `packages/code-reviewer/src/tools/read-file.ts:58`, `list-files.ts:43`,
  `search-code.ts:74`
- **Detail**: `paths.ts:17` states the policy deliberately: a refusal "never leaks the absolute
  path it resolved to", and every `ok:false` message honours it by echoing the model's own
  relative input. The rethrow branches bypass that policy. A raw Node system error message is
  `EPERM: operation not permitted, open 'C:\Users\lordt\Sources\...\file'` — the full absolute
  path, including the OS username.

  The SDK does hand that string to the model: `ai/dist/index.js:2013-2016` converts a
  `tool-error` part with `errorMode: "text"` into `{type:"error-text", value:
  getErrorMessage(output)}`, which becomes the tool result in the conversation — and therefore
  travels to OpenRouter as history for every subsequent step.

  Failure scenario: the model calls `read_file` on a lock-held or ACL-restricted file inside the
  root — a running dev server's log, a file open in an editor — and learns the real absolute
  location of the review root and the username, both of which then leave the machine.
- **Fix A ⭐ Recommended**: Keep rethrowing, but rethrow a sanitized error whose message names the
  caller-supplied relative path, attaching the original via `{ cause }` so local logs keep the
  detail.
  - Strength: Preserves the SDK's intended tool-error flow (a genuinely unexpected failure still
    aborts the tool rather than being papered over as a result) while restoring the one policy
    `paths.ts` states explicitly. Uniform across all three tools.
  - Tradeoff: A small helper in `fs-errors.ts` and a touched line in each tool.
  - Confidence: HIGH — the SDK conversion is verified in `ai/dist/index.js:2013-2016` and the
    Node message format is standard.
  - Blind spot: Whether any caller depends on reading the raw `cause` chain; `cli.ts:52` prints
    only `.message`, so nothing in-repo does.
- **Fix B**: Handle `EACCES` / `EPERM` / `EISDIR` / `ELOOP` as explicit `ok:false` refusals and
  leave the rethrow for genuinely unexpected codes.
  - Strength: Turns the cases that are actually *expected* on a real filesystem into results the
    model can react to rather than errors — better loop behaviour, not just better hygiene.
  - Tradeoff: Does not close the leak for the residual unexpected codes, so it complements Fix A
    rather than replacing it.
  - Confidence: HIGH on behaviour, but it leaves the stated policy still bypassable.
  - Blind spot: The list of codes worth enumerating is platform-dependent.
- **Decision**: FIXED via Fix A — `fs-errors.ts` gained `opaqueFsError(error, requested)`, and all three tools rethrow through it; no raw `throw error` remains in `tools/`. Verified: a Node EPERM carrying `C:\Users\lordt\...\secret.log` becomes `Accessing "secret.log" failed (EPERM).` with the original preserved on `cause`.

### F10 — The search walk is bounded on files but not on directories

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `packages/code-reviewer/src/tools/search-code.ts:55,83-84`
- **Detail**: `MAX_FILES_WALKED` is decremented only by files (`filesWalked += 1`). Directories
  are pushed onto `stack` with no count bound and no depth bound, so a file-sparse tree walks
  indefinitely — and there is no timeout anywhere in the call chain. A deep generated-artifact
  tree or a vendor drop inside the review root stalls the tool call. `SKIP_DIRS` covers only
  `node_modules`, `.git`, and `dist`, and is explicitly documented as a cost measure rather than
  a boundary, so it is not the thing to lean on here.
- **Fix**: Count directory visits against the same `truncated` mechanism, and/or bound depth
  relative to the search root.
- **Decision**: FIXED — `MAX_DIRS_WALKED = 2_000` bounds directory visits against the same `truncated` mechanism, and `dirsWalked` is reported alongside `filesWalked` so a truncated walk says which budget ran out.

### F11 — README promises `step-budget-exhausted`, which the `prepareStep` net makes unreachable

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Pattern Consistency
- **Location**: `packages/code-reviewer/src/agent/review-code.ts:68`, `README.md:74-75`
- **Detail**: The discriminator is `result.finishReason === "tool-calls"`, which is exactly the
  SDK's own condition for leaving `output` unset — the detection is correctly written. But
  `create-agent.ts:78-79` forces `toolChoice: "none"` at `stepNumber >= budget - 1`, so on the
  default path the final step *cannot* emit tool calls, `finishReason` is never `"tool-calls"`,
  and the branch never fires. It is reachable only when a caller passes a custom `stopWhen`
  **without** `stepBudget` — the same coupling F4 was about.

  So a user who hits genuine exhaustion gets `ReviewError("no-output-generated", "The review
  finished without producing a verdict.")` rather than the `step-budget-exhausted` code and its
  actionable "Raise stopWhen or narrow the paths" hint — the one message that would tell them
  what to do. `README.md:74-75` states the opposite. The net itself is good design; this is the
  diagnostics and the documentation not having caught up with it.
- **Fix A ⭐ Recommended**: Also raise `step-budget-exhausted` when the budget is known and
  `result.steps.length >= budget` with no output, keeping the `finishReason` check as the other
  arm.
  - Strength: Makes the error code mean what both the README and `errors.ts` say it means, on the
    path users actually run. Preserves the existing branch for the custom-`stopWhen` case.
  - Tradeoff: `reviewCode` has to know the effective budget, duplicating the
    `stepBudget ?? DEFAULT_STEP_BUDGET` resolution at `create-agent.ts:64` — two places that must
    agree, unless the resolution is extracted into one exported helper.
  - Confidence: HIGH — the unreachability follows from reading both files together.
  - Blind spot: Not exercised against a live budget-exhausted run; only Sonnet has been used, and
    it converges.
- **Fix B**: Correct `README.md:74-75` to say the net converts exhaustion into
  `no-output-generated`, and leave the code alone.
  - Strength: Zero code risk; documents the behaviour that actually ships.
  - Tradeoff: Leaves a declared error code that fires only in a configuration the README
    discourages, and the least actionable message on the most likely failure.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — the `stepBudget ?? DEFAULT_STEP_BUDGET` resolution is extracted into one exported `resolveStepBudget` helper used by both `createReviewAgent` and `reviewCode`, so the two cannot drift. The exhaustion branch now also fires on `budget !== undefined && result.steps.length >= budget`, which is the arm that fires on the default path. `README.md:74-75` is correct as written and needed no change. Not exercised against a live budget-exhausted run — the finding's declared blind spot stands.

## Not findings — checked and clean

- **Import-time purity**: the full transitive graph from `src/index.ts` has no module-scope
  side effect. `config.ts:36` guards `loadEnvFile()` behind `env === process.env`, and only
  `cli.ts:38` calls `loadConfig()`. Verified empirically, not just by reading.
- **Scope guardrails**: no promptfoo, no test runner or tests, no git tools, no CI/PR wiring,
  no write/edit/shell tools, no new CLI flags, package absent from root workspaces / vitest /
  CI. `search-code.ts:16-21` explicitly disclaims `SKIP_DIRS` as "a cost measure, not a
  security boundary", honouring the plan's "no denylist" rule.
- **`src/config.ts` untouched** since the Phase 1 baseline commit. (The package was untracked
  before `fd3506f`, so there is no earlier revision to diff against — the claim is verifiable
  only from Phase 1 onward.)
- **`.env` is not tracked**; root `.gitignore`'s `.env` rule covers it and `git ls-files`
  shows only `.env.example`.
- **`ReviewError` wrapping is correct.** `result.output` is a throwing getter, which is why
  `agent/review-code.ts:61-77` wraps the *read* rather than only the `generate()` call; the
  `finishReason === "tool-calls"` discriminator for `step-budget-exhausted` is reachable and
  correctly conditioned.
- **`tools/fs-errors.ts`** is an unplanned 11-line file, but it is benign decomposition —
  a `nodeErrorCode()` narrowing helper used uniformly by all three tools.
- **`erasableSyntaxOnly` / `verbatimModuleSyntax` / `exactOptionalPropertyTypes` /
  `noUncheckedIndexedAccess` / `.ts` import specifiers** are respected consistently across
  every new file.
