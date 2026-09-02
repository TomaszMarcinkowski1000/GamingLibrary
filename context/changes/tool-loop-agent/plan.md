# Tool-Loop Code Review Agent Implementation Plan

## Overview

Restructure `packages/code-reviewer` from a single-shot `generateText` wrapper into a modular,
reusable code review agent built on the AI SDK's `ToolLoopAgent`. Structured output schemas and
prompts move into their own concern-directories, the agent gains sandboxed read-only filesystem
tools so it can pull in the code it needs rather than being handed a blob, and the package
exports a side-effect-free `createReviewAgent` factory so a promptfoo provider can drive it with
an injected model later.

## Current State Analysis

The package is three files and roughly 160 lines, all untracked (`?? packages/` in git status),
with no committed consumers — export surfaces can be reshaped freely.

- `src/review.ts:61` — `reviewCode()` is one `generateText` call with `Output.object`. No agent,
  no tools, no loop. The caller must read the code and pass it as a string.
- `src/review.ts:7-24` — `severities`, `findingSchema`, `reviewSchema` and their inferred types
  live inline in the same file as the model wiring and the review call.
- `src/review.ts:41-46` — `SYSTEM_PROMPT` is a module-level template literal in that same file.
- `src/review.ts:31-39` — `createModel(config)` builds the OpenRouter provider. Already cleanly
  separated from the review logic, and already handles `exactOptionalPropertyTypes` correctly with
  the `...(x ? {y} : {})` spread at line 35.
- `src/index.ts` — does double duty as the public barrel (lines 7-10) **and** the CLI smoke test
  (lines 19-43), with a file-wide `eslint-disable no-console` at line 12 leaking into the library
  surface. The direct-execution guard at line 38 keeps importing side-effect free today, but the
  console disable and `argv` import do not belong in a library entry point.
- `src/config.ts` — already correct and injectable; `loadConfig(env)` skips the `.env` read when
  given an explicit env. **This file is not touched by this plan.**

Constraints discovered:

- `ai@7.0.90` is installed and is the current release (`npm view ai version` matches), so no
  upgrade is needed and the bundled docs in `node_modules/ai/docs/` are version-matched.
- `tsconfig.json` runs `erasableSyntaxOnly` (no enums, no parameter properties),
  `verbatimModuleSyntax` (type-only imports must say `import type`),
  `exactOptionalPropertyTypes` (an optional property cannot be assigned `undefined` explicitly —
  build the object conditionally), and `noUncheckedIndexedAccess` (indexed reads are
  `T | undefined`).
- `rewriteRelativeImportExtensions` is on and every existing relative import carries a `.ts`
  specifier. New modules must follow that, including barrel re-exports (`./finding.ts`).
- Root ESLint covers the package: `npx eslint packages/code-reviewer/src` exits 0 today, because
  `projectService: true` resolves the package's own tsconfig. Root rules include
  `strictTypeChecked` + `stylisticTypeChecked` and `no-console: warn`.
- Root `vitest.config.ts` has `include: ["src/**/*.test.ts", "*.test.ts"]`, which does **not**
  reach `packages/**`. The package has no test runner and no `test` script.

## Desired End State

`packages/code-reviewer` exposes a `ToolLoopAgent`-based reviewer that, given a root directory and
a set of target paths, reads those files itself through sandboxed tools, follows imports and
neighbouring code as needed, and returns a schema-validated `Review`.

Verification that this is done:

- `import { createReviewAgent } from "@gaminglibrary/code-reviewer"` succeeds with **no**
  environment variables set and triggers no `.env` read — the invariant the future promptfoo
  provider depends on.
- `createReviewAgent({ model, rootDir })` accepts any AI SDK `LanguageModel`, including
  `MockLanguageModelV4` from `ai/test`, with no OpenRouter involvement.
- `npm start -- <file>` still produces a human-readable review, and the run visibly makes tool
  calls rather than one round trip.
- A path escaping `rootDir` (via `../` or a symlink) is refused by the tools rather than read.

### Key Discoveries:

- `ToolLoopAgent` constructor takes `{ model, instructions, tools, output, stopWhen, toolChoice }`
  and `agent.generate({ prompt })` returns `{ output }` when `Output.object` is configured
  (`node_modules/ai/docs/03-agents/02-building-agents.mdx`). Verified at runtime that `ai` exports
  `ToolLoopAgent`, `tool`, `Output`, `isStepCount`, and `NoObjectGeneratedError`.
- **Generating the structured output consumes a step.** `stopWhen` must budget for tool calls plus
  the final output generation (`node_modules/ai/docs/03-ai-sdk-core/10-generating-structured-data.mdx:312`).
  Default is `isStepCount(20)` if unset.
- The system prompt goes in `instructions`, not `system`. `allowSystemInMessages` defaults to
  `false`, so system content passed through `prompt`/`messages` is rejected.
- **The SDK already soft-fails tool execution errors**: a throw inside a tool's `execute` becomes a
  `tool-error` content part and the loop continues, enabling an automated LLM roundtrip
  (`node_modules/ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx:1143`). Explicit typed error
  results are therefore about giving the model a *better* message for expected failures, not about
  preventing a crash.
- `HarnessAgent` (`docs/03-ai-sdk-harnesses/`) is the wrong abstraction here — it requires a
  sandbox provider such as `@ai-sdk/sandbox-vercel` and external credentials. `ToolLoopAgent` is
  the right one.

## What We're NOT Doing

- **Not configuring the eval environment.** No promptfoo install, no config file, no eval cases,
  no provider adapter. This change only makes the package *shaped* for that later.
- Not adding a test runner, test script, or any tests (decision: typecheck + lint only).
- Not adding git tools (`getDiff`, `getChangedFiles`) or any CI/PR wiring.
- Not adding write, edit, or shell tools — the agent is strictly read-only.
- Not extending the CLI with new flags (`--root`, `--model`, `--json`). It moves to its own file
  and keeps its current behavior.
- Not touching `src/config.ts`.
- Not adding lifecycle callbacks, telemetry, or token/cost accounting.
- Not adding a node_modules / dotfile denylist to the tools — containment is the root check alone.
- Not adding the package to root npm workspaces, root vitest, or CI.

## Implementation Approach

Three phases, each independently green, ordered so nothing is deleted until its replacement exists.

Phase 1 is a pure extraction: schemas, prompts, model wiring, and errors move into modules while
`review.ts` is rewired to import them. Behavior is byte-identical and the CLI keeps working, which
makes the diff trivially reviewable.

Phase 2 adds `tools/` — the path guard plus three read-only tools — built and typechecked but
wired into nothing. Isolating it means the containment rule can be read and reasoned about on its
own, which matters because it ships without tests.

Phase 3 introduces `agent/`, flips the public API to the new `rootDir + paths + context` input
shape, reduces `index.ts` to a barrel, splits out `cli.ts`, and deletes `review.ts`.

## Critical Implementation Details

**Step budget.** `stopWhen: isStepCount(10)` is the factory default. Because the structured-output
generation is itself a step, that is roughly eight tool calls plus the final output — not ten tool
calls. The value must be overridable both at construction and per `generate()` call.

**Path containment.** The guard resolves the candidate path and compares against the *resolved
real* root, so a symlink pointing outside cannot slip through. A prefix comparison on the raw
string is not sufficient: `/repo-evil` has `/repo` as a string prefix. Compare on path segment
boundaries, and resolve the root once at tool-construction time rather than per call.

**Import-time purity.** `index.ts` must not read `process.env`, call `loadConfig()`, or construct
an agent at module scope. `loadConfig()` calls `process.loadEnvFile(".env")` (`config.ts:10-12`),
which is exactly the side effect that would break a promptfoo run in an unrelated directory. The
CLI is the only place that calls `loadConfig()`.

## Phase 1: Extract Schemas, Prompts, Model, and Errors

### Overview

Pure module extraction out of `src/review.ts`. No behavior changes, no new dependencies. At the
end of this phase `review.ts` still exports the same public names and the CLI is untouched.

### Changes Required:

#### 1. Finding and review schemas

**File**: `packages/code-reviewer/src/schemas/finding.ts`

**Intent**: Own the per-finding shape so it can be imported by prompts, the agent, and future eval
assertions without dragging in the OpenRouter provider.

**Contract**: Exports `severities` (the `as const` tuple), `findingSchema`, and the inferred
`Finding` type, moved verbatim from `review.ts:7-16` including every `.describe()` string.

**File**: `packages/code-reviewer/src/schemas/review.ts`

**Intent**: Own the top-level review envelope — the schema handed to `Output.object`.

**Contract**: Exports `reviewSchema` and the inferred `Review` type, moved verbatim from
`review.ts:18-24`. Imports `findingSchema` from `./finding.ts`.

**File**: `packages/code-reviewer/src/schemas/index.ts`

**Intent**: Single import point for the schema concern.

**Contract**: Re-exports the values and, separately, the types (`export type { ... }`) —
`verbatimModuleSyntax` requires the type/value split in barrels.

#### 2. Prompts

**File**: `packages/code-reviewer/src/prompts/instructions.ts`

**Intent**: Own the agent's system instructions as a named, importable constant so eval runs can
diff prompt variants without touching agent code.

**Contract**: Exports `REVIEW_INSTRUCTIONS`, seeded from the existing `SYSTEM_PROMPT`
(`review.ts:41-46`) verbatim. Tool-usage guidance is added in Phase 3, not here.

**File**: `packages/code-reviewer/src/prompts/review-request.ts`

**Intent**: Own construction of the user-facing prompt, separated from the agent so the prompt
shape is a testable pure function.

**Contract**: Exports `buildReviewPrompt(input)` returning a string. In this phase it reproduces
the existing `[context, code].filter(Boolean).join("\n\n")` composition from `review.ts:66`
exactly; Phase 3 changes its input to paths.

**File**: `packages/code-reviewer/src/prompts/index.ts`

**Intent**: Single import point for the prompt concern.

**Contract**: Barrel re-export of the two modules above.

#### 3. Model wiring

**File**: `packages/code-reviewer/src/model.ts`

**Intent**: Isolate the OpenRouter provider adapter so the agent module depends only on the AI SDK
`LanguageModel` interface — the seam an eval harness substitutes at.

**Contract**: Exports `createModel(config: Config): LanguageModel`, moved verbatim from
`review.ts:31-39`. Keep the conditional-spread of `appUrl` — `exactOptionalPropertyTypes` rejects
assigning `undefined` to the optional property directly.

#### 4. Typed run-level errors

**File**: `packages/code-reviewer/src/errors.ts`

**Intent**: Give callers a stable error type to catch for the failure modes that should abort a
run, rather than surfacing raw provider errors.

**Contract**: Exports a `ReviewError` class extending `Error` with a discriminating `code` field
covering at minimum "no output generated" and "step budget exhausted", plus the originating cause.
Because `erasableSyntaxOnly` is on, the class cannot use parameter properties or a TS `enum` — use
a plain constructor body and a string-literal union for `code`. Unused in Phase 1; consumed in
Phase 3.

#### 5. Rewire the existing review module

**File**: `packages/code-reviewer/src/review.ts`

**Intent**: Reduce to the `generateText` call, importing everything it previously declared, so the
extraction is provably behavior-preserving before the agent lands.

**Contract**: Keeps its current exported names so `index.ts` needs no edit this phase. It
re-exports the schema and model symbols from the new modules and retains `reviewCode` /
`ReviewOptions` unchanged.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Root lint passes: `npx eslint packages/code-reviewer/src` exits 0
- Build emits declarations: `cd packages/code-reviewer && npm run build`
- Public export names are unchanged from before the phase

#### Manual Verification:

- `npm start -- src/config.ts` still prints a summary and findings exactly as before
- No new dependency appears in `package.json`

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 2: Read-Only Filesystem Tools

### Overview

Add `tools/` — a root-containment guard and three read-only tools. Nothing imports them yet, so
this phase changes no runtime behavior.

### Changes Required:

#### 1. Path containment guard

**File**: `packages/code-reviewer/src/tools/paths.ts`

**Intent**: Provide the single containment rule every tool routes through, so the security
property is stated in exactly one place. This is the highest-risk code in the change and it ships
without tests — it must be small enough to verify by reading.

**Contract**: Exports a factory that takes a `rootDir`, resolves it to a real path once, and
returns a `resolveWithinRoot(candidate)` function. That function resolves the candidate against
the root, follows symlinks for paths that exist, and returns a discriminated result — the absolute
path on success, or a refusal carrying a reason — rather than throwing.

Two correctness requirements, both easy to get subtly wrong:

- Containment must be tested on **path segment boundaries**, not string prefixes. `/repo-evil`
  starts with `/repo` as a string but is not inside it.
- The check must run against the **real** (symlink-resolved) path. For a path that does not exist
  yet, resolve the nearest existing ancestor and check that.

#### 2. Read file

**File**: `packages/code-reviewer/src/tools/read-file.ts`

**Intent**: Let the agent pull the contents of a specific file it has decided it needs.

**Contract**: An `ai` `tool()` with a zod `inputSchema` taking a root-relative path and an optional
line range, and a `description` written for the model. `execute` routes through
`resolveWithinRoot` and returns either the contents or a typed refusal for the expected failures
(outside root, not found, is a directory, too large). Genuinely unexpected errors are allowed to
throw — the SDK converts those into `tool-error` parts and the loop continues.

#### 3. List files

**File**: `packages/code-reviewer/src/tools/list-files.ts`

**Intent**: Let the agent orient itself in an unfamiliar tree before deciding what to read.

**Contract**: An `ai` `tool()` taking a root-relative directory and returning its entries with a
file/directory marker. Same containment routing and same expected-failure handling. Bound the
result count so one call on a huge directory cannot flood the context window.

#### 4. Search code

**File**: `packages/code-reviewer/src/tools/search-code.ts`

**Intent**: Let the agent find callers and definitions by content, which is what makes reviewing a
change in context possible at all.

**Contract**: An `ai` `tool()` taking a search string and an optional root-relative subtree, and
returning matches as path + line number + line text. Implemented in Node without shelling out to
`rg` or `grep`, so it behaves identically on Windows and in CI. Bound both the number of matches
and the number of files walked; skip `node_modules`, `.git`, and `dist` **while walking** — that
is a traversal-cost measure, distinct from the containment rule, which stays the root check alone.

#### 5. Tool set factory

**File**: `packages/code-reviewer/src/tools/index.ts`

**Intent**: Hand the agent one object of ready-bound tools, since every tool needs the same
`rootDir` closure.

**Contract**: Exports `createReviewTools({ rootDir })` returning the tool set keyed by tool name,
plus the inferred type of that set for the agent's generics. Resolving the root and constructing
the guard happens once here, not per tool.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Root lint passes: `npx eslint packages/code-reviewer/src` exits 0
- Build succeeds: `cd packages/code-reviewer && npm run build`

#### Manual Verification:

- Read `tools/paths.ts` end to end and confirm both stated requirements hold: segment-boundary
  comparison, and symlink resolution before comparison
- Confirm by inspection that all three tools route through `resolveWithinRoot` with no direct
  `fs` call on a caller-supplied path
- Each tool's `description` reads as guidance to a model, not as a code comment

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Agent Module, New Entry Points, Cleanup

### Overview

Introduce the `ToolLoopAgent`, flip the public API to the `rootDir + paths + context` input shape,
reduce `index.ts` to a pure barrel, split the CLI into `cli.ts`, and delete `review.ts`.

### Changes Required:

#### 1. Agent factory

**File**: `packages/code-reviewer/src/agent/create-agent.ts`

**Intent**: The reusable core of the package — the single place agent configuration lives, and the
symbol a future promptfoo provider constructs per eval case.

**Contract**: Exports `createReviewAgent(options)` returning a configured `ToolLoopAgent`.

Required options: a `LanguageModel` and a `rootDir`. Optional: a `stopWhen` override, extra
instructions, and any further `ToolLoopAgent` settings worth surfacing. Defaults:
`instructions: REVIEW_INSTRUCTIONS`, `tools: createReviewTools({ rootDir })`,
`output: Output.object({ schema: reviewSchema })`, `stopWhen: isStepCount(10)`.

Three constraints that will otherwise bite:

- The model is a **required parameter**, never derived from `loadConfig()` inside this module.
  That is the whole reason the package can be evaluated without OpenRouter credentials.
- Instructions go in `instructions`. `allowSystemInMessages` defaults to `false`, so a system
  message routed through `prompt` is rejected.
- `stopWhen: isStepCount(10)` leaves roughly eight tool calls, because the structured-output
  generation consumes a step of its own.

**File**: `packages/code-reviewer/src/agent/index.ts`

**Contract**: Barrel re-exporting the factory, the convenience function, and their option types.

#### 2. Review entry point

**File**: `packages/code-reviewer/src/agent/review-code.ts`

**Intent**: The one-shot convenience wrapper most callers use: construct, run, return a validated
`Review`.

**Contract**: Exports `reviewCode(options)` and `ReviewOptions`. The input shape changes from the
current `{ model, code, context }` to `{ model, rootDir, paths, context? }` — `paths` being the
root-relative files under review, which the agent now reads through its own tools rather than
receiving as text.

Builds the prompt via `buildReviewPrompt`, calls `agent.generate({ prompt })`, and returns
`output`. Wraps the run-level failures in `ReviewError`: a `NoObjectGeneratedError` from the SDK,
and a run that hits the step cap without producing output. Tool-level failures are deliberately
not wrapped — they are already `tool-error` parts the model reacted to during the loop.

#### 3. Prompt and instruction updates for the tool loop

**File**: `packages/code-reviewer/src/prompts/review-request.ts`

**Intent**: The prompt now names files rather than carrying their contents, so the agent knows what
to fetch.

**Contract**: `buildReviewPrompt` takes `{ paths, context? }` and produces a prompt listing the
root-relative paths under review plus optional context. It no longer embeds file contents.

**File**: `packages/code-reviewer/src/prompts/instructions.ts`

**Intent**: A tool-loop agent needs to be told how to use its tools, or it will either not call
them or wander until the step cap.

**Contract**: `REVIEW_INSTRUCTIONS` gains a tool-usage section: read the named files first, use
search to find callers and related definitions only when a finding depends on them, stay inside
the review scope, and produce the structured verdict once evidence is sufficient rather than
exhausting the budget. The existing standard — report only defects you can point at, skip style
and speculation, return an empty array when the code is sound — is preserved verbatim.

#### 4. Public barrel

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Become a pure, side-effect-free export surface. This is the promptfoo-readiness
invariant, and it is the reason the CLI must leave this file.

**Contract**: Re-exports only: `createReviewAgent`, `reviewCode`, `createModel`, `loadConfig`,
`findingSchema`, `reviewSchema`, `severities`, `createReviewTools`, `REVIEW_INSTRUCTIONS`,
`ReviewError`, and the corresponding types via `export type`. No `argv` import, no `main()`, no
file-level `eslint-disable no-console`, no top-level statements of any kind.

#### 5. CLI

**File**: `packages/code-reviewer/src/cli.ts`

**Intent**: Give the smoke test its own home so its console output and env loading stay out of the
library.

**Contract**: Carries the `main()` body, the `import.meta.url === pathToFileURL(argv[1])` guard,
the `eslint-disable no-console`, and the `loadConfig()` call — all moved from `index.ts:12-43`.
Adapted to the new API: derive `rootDir` and the root-relative path from the argument and call
`reviewCode({ model, rootDir, paths })`. Behavior stays as it is today: review one file, print the
summary and findings, print "No findings." when the array is empty, exit 1 on error.

#### 6. Delete the old module

**File**: `packages/code-reviewer/src/review.ts`

**Intent**: Remove the module whose every responsibility now lives elsewhere.

**Contract**: Deleted. Confirm no remaining `./review.ts` import anywhere in `src/`.

#### 7. Package scripts

**File**: `packages/code-reviewer/package.json`

**Intent**: Point the runnable scripts at the CLI's new location.

**Contract**: `start` becomes `tsx src/cli.ts` and `dev` becomes `tsx watch src/cli.ts`. `main`,
`types`, and `exports` continue to point at `dist/index.js` — the barrel is still the package
entry point. No dependency changes.

#### 8. README

**File**: `packages/code-reviewer/README.md`

**Intent**: The documented usage example is currently wrong for the new API and would mislead the
next reader.

**Contract**: Update the "Use it from code" example to `createReviewAgent` / `reviewCode` with
`rootDir` and `paths`. Add a short section on the agent: what tools it has, that they are
read-only and confined to `rootDir`, and the default step budget. Note that `index.ts` is
side-effect free and that any `LanguageModel` — including `MockLanguageModelV4` from `ai/test` —
can be injected. Keep the existing Setup, Scripts, and Notes sections, correcting the script
table's file reference.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Root lint passes: `npx eslint packages/code-reviewer/src` exits 0
- Build succeeds and emits declarations: `cd packages/code-reviewer && npm run build`
- Importing the barrel with no environment set does not throw and does not read `.env` — run a
  Node one-liner that imports `dist/index.js` from a directory containing a `.env`, with
  `OPENROUTER_API_KEY` unset, and confirm a clean exit
- `createReviewAgent` accepts `MockLanguageModelV4` from `ai/test` and constructs without any
  OpenRouter credential
- No file under `src/` still imports `./review.ts`

#### Manual Verification:

- `npm start -- <file>` produces a review whose findings cite real lines of that file
- The run visibly makes tool calls (the agent reads the file itself) rather than one round trip
- A `paths` entry escaping the root (`../../secret.txt`) is refused by the tool, and the refusal
  reaches the model as a tool result rather than crashing the run
- Findings still respect the standard: no style nitpicks, empty array on sound code

**Implementation Note**: This is the final phase. Confirm all manual checks before considering the
change complete.

---

## Testing Strategy

Per the agreed scope, this change ships with **no automated tests** — the package has no test
runner, and adding one was explicitly excluded. Verification rests on `npm run typecheck`, root
ESLint, `npm run build`, and the manual checks in each phase.

This puts real weight on two manual gates, both called out above:

1. **Reading `tools/paths.ts`** in Phase 2. It is the only security-relevant logic in the change
   and it ships unverified by machine. It is written to be small enough to audit by eye — if it
   grows past that, that is the signal to revisit the no-tests decision.
2. **The import-purity check** in Phase 3, which is mechanically checkable via the Node one-liner
   even without a test runner, and which the future promptfoo work depends on.

### Manual Testing Steps:

1. `cd packages/code-reviewer && npm start -- src/agent/review-code.ts` — expect a summary plus
   findings citing real line numbers, and observably more than one model round trip.
2. Review a file with a deliberate bug (an off-by-one in a slice, say) and confirm it is caught at
   `major` or `critical`.
3. Review a trivially correct file and confirm an empty findings array, not invented nitpicks.
4. Call `reviewCode` with `paths: ["../../../etc/passwd"]` and confirm the tool refuses and the run
   completes rather than crashing or reading the file.
5. From a scratch directory containing an unrelated `.env`, with `OPENROUTER_API_KEY` unset, import
   the built barrel and confirm no throw and no env read.

## Performance Considerations

Cost per review moves from one model call to up to ten steps. `isStepCount(10)` is the ceiling and
is overridable per call. The tool-side bounds matter as much as the step cap: `read-file` caps file
size, `list-files` caps entry count, and `search-code` caps both matches and files walked, so a
single tool call cannot flood the context window and inflate the token bill for every subsequent
step in the loop.

`search-code` is implemented in Node rather than shelling out to `rg`, trading raw speed for
identical behavior on Windows and in CI. Skipping `node_modules`, `.git`, and `dist` during the
walk keeps that tradeoff affordable.

## Migration Notes

`packages/` is untracked with no committed consumers, so there is no compatibility burden. The
breaking change is `reviewCode`'s input: `{ model, code, context }` becomes
`{ model, rootDir, paths, context? }`. The only in-repo caller is the CLI, updated in the same
phase. The README example is the other place that shape appears, also updated in Phase 3.

## References

- Change identity: `context/changes/tool-loop-agent/change.md`
- AI SDK agent guide: `packages/code-reviewer/node_modules/ai/docs/03-agents/02-building-agents.mdx`
- Structured output with tools, and the step-cost caveat:
  `packages/code-reviewer/node_modules/ai/docs/03-ai-sdk-core/10-generating-structured-data.mdx:312`
- Tool error semantics: `packages/code-reviewer/node_modules/ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx:1143`
- Mock models for future evals: `packages/code-reviewer/node_modules/ai/docs/03-ai-sdk-core/55-testing.mdx`
- Code being replaced: `packages/code-reviewer/src/review.ts`, `packages/code-reviewer/src/index.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract Schemas, Prompts, Model, and Errors

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — fd3506f
- [x] 1.2 Root lint passes: `npx eslint packages/code-reviewer/src` exits 0 — fd3506f
- [x] 1.3 Build emits declarations: `npm run build` — fd3506f
- [x] 1.4 Public export names are unchanged from before the phase — fd3506f

#### Manual

- [x] 1.5 `npm start -- src/config.ts` prints summary and findings exactly as before — fd3506f
- [x] 1.6 No new dependency appears in `package.json` — fd3506f

### Phase 2: Read-Only Filesystem Tools

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — 5e8ca86
- [x] 2.2 Root lint passes: `npx eslint packages/code-reviewer/src` exits 0 — 5e8ca86
- [x] 2.3 Build succeeds: `npm run build` — 5e8ca86

#### Manual

- [x] 2.4 `tools/paths.ts` read end to end: segment-boundary comparison and symlink resolution both confirmed — 5e8ca86
- [x] 2.5 All three tools route through `resolveWithinRoot`, no direct `fs` call on a caller-supplied path — 5e8ca86
- [x] 2.6 Each tool's `description` reads as guidance to a model — 5e8ca86

### Phase 3: Agent Module, New Entry Points, Cleanup

#### Automated

- [x] 3.1 Typecheck passes: `npm run typecheck` — 7a76d3c
- [x] 3.2 Root lint passes: `npx eslint packages/code-reviewer/src` exits 0 — 7a76d3c
- [x] 3.3 Build succeeds and emits declarations: `npm run build` — 7a76d3c
- [x] 3.4 Importing the barrel with no env set does not throw and does not read `.env` — 7a76d3c
- [x] 3.5 `createReviewAgent` accepts `MockLanguageModelV4` with no OpenRouter credential — 7a76d3c
- [x] 3.6 No file under `src/` still imports `./review.ts` — 7a76d3c

#### Manual

- [x] 3.7 `npm start -- <file>` produces findings citing real lines of that file — 7a76d3c
- [x] 3.8 The run visibly makes tool calls rather than one round trip — 7a76d3c
- [x] 3.9 A `paths` entry escaping the root is refused as a tool result, not a crash — 7a76d3c
- [x] 3.10 Findings respect the standard: no style nitpicks, empty array on sound code — 7a76d3c
