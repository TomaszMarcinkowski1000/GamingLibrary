# Tool-Loop Code Review Agent — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

Convert `packages/code-reviewer` from a single-shot `generateText` wrapper into a modular code
review agent built on the AI SDK's `ToolLoopAgent`. Schemas and prompts move into their own
modules, and the agent gains sandboxed read-only filesystem tools so it can pull in the code it
needs — callers, neighbouring definitions, conventions — rather than judging a blob it was handed.
The package exports a side-effect-free factory so promptfoo evals can drive it with an injected
model later.

## Starting Point

Three files, ~160 lines, entirely untracked (`?? packages/`). `src/review.ts` mixes schemas,
prompt, provider wiring, and the one `generateText` call into a single module; `src/index.ts` is
both the public barrel and the CLI smoke test, complete with a file-wide `eslint-disable
no-console` bleeding into the library surface. `src/config.ts` is already clean and is not touched.
There is no test runner, and root vitest's `src/**` include does not reach `packages/**`.

## Desired End State

Given a root directory and a list of target paths, the reviewer reads those files itself through
its own tools, follows imports where a finding depends on them, and returns a schema-validated
`Review`. Importing the package with no environment variables set succeeds and reads no `.env` —
the invariant a promptfoo provider depends on — and `createReviewAgent({ model, rootDir })` accepts
`MockLanguageModelV4` with no OpenRouter credential anywhere in the picture.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Agent tools | Read-only filesystem: `readFile`, `listFiles`, `searchCode` | Gives the loop something to actually do; no git dependency, and deterministic for evals pointed at a fixture dir |
| Module layout | Directory per concern: `schemas/`, `prompts/`, `tools/`, `agent/` | Makes the seams explicit; each concern gets its own public surface |
| Export shape | `createReviewAgent(opts)` factory + `reviewCode(opts)`; barrel has no side effects | Evals inject a model per case, and importing never touches `process.env` |
| Step budget | `isStepCount(10)`, overridable | ~8 tool calls plus the output step; caps runaway cost on every CI push |
| Sandboxing | Resolve + reject outside `rootDir`, symlinks included | One guard, applied uniformly; `rootDir` becomes an explicit argument |
| Error handling | Tools return typed results for expected failures; run-level failures throw `ReviewError` | Loop stays resilient where recovery is possible, loud where it is not |
| Testing | Typecheck + lint only | Keeps the change structural — see Open Risks |
| Input shape | `{ model, rootDir, paths, context? }` | The caller stops doing the reading; the agent chooses what to load |
| CLI | Moves to `cli.ts`, behavior unchanged | `index.ts` must be import-side-effect-free |

## Scope

**In scope:** module extraction (schemas, prompts, model, errors); three read-only filesystem tools
plus the containment guard; the `ToolLoopAgent` factory and `reviewCode` wrapper; barrel/CLI split;
`review.ts` deletion; package scripts and README.

**Out of scope:** the eval environment entirely (no promptfoo install, config, cases, or provider
adapter); tests and a test runner; git/diff tools and CI wiring; write, edit, or shell tools; new
CLI flags; telemetry and cost accounting; `src/config.ts`.

## Architecture / Approach

```
cli.ts ──> loadConfig ──> createModel ──┐
                                        ├──> reviewCode ──> createReviewAgent ──> ToolLoopAgent
promptfoo (later) ──> injected model ───┘                          │
                                                    ┌──────────────┼──────────────┐
                                              prompts/         schemas/        tools/
                                         (instructions,     (Output.object)  (readFile, listFiles,
                                          buildPrompt)                        searchCode → paths.ts guard)
```

`index.ts` is a pure barrel over all of it. The model is always a parameter, never derived inside
the agent module — that single rule is what makes the package evaluable without credentials.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract schemas, prompts, model, errors | Concern-directories in place; `review.ts` rewired to import them; behavior identical | Low — a pure move, but `verbatimModuleSyntax` requires type/value splits in every barrel |
| 2. Read-only filesystem tools | `tools/` with the containment guard and three tools, wired into nothing yet | The path guard is the only security logic in the change and ships without tests |
| 3. Agent, entry points, cleanup | `ToolLoopAgent` factory, new input shape, barrel/CLI split, `review.ts` deleted | Instructions must actively steer tool use or the agent wanders to the step cap |

**Prerequisites:** `npm install` in `packages/code-reviewer` (`ai@7.0.90` already present and
current), and `OPENROUTER_API_KEY` in `.env` for the manual end-to-end checks only.

**Estimated effort:** ~1–2 sessions across the three phases; Phase 1 is mechanical, Phase 2 carries
most of the careful thinking.

## Open Risks & Assumptions

- **The path guard ships unverified by machine.** Testing was scoped out, so the containment rule
  rests on a manual read in Phase 2. It is deliberately written small enough to audit by eye; if it
  grows past that, that is the signal to revisit the no-tests decision.
- **Prompt quality now determines cost.** With tools available, weak instructions mean the agent
  either ignores them or burns the whole step budget exploring. There is no eval harness yet to
  catch that regression — which is exactly what the promptfoo-ready export shape is for.
- Assumes reviews run against an on-disk checkout. A caller holding a diff in memory (a PR from an
  API) would need to write it out or get a second entry point later.
- The structured-output step cost is documented behavior; if a future SDK version changes it, the
  effective tool budget shifts without the number in the code changing.

## Success Criteria (Summary)

- A review of a real file produces findings citing real line numbers, and visibly makes tool calls
  rather than one round trip.
- Importing the package with no environment set neither throws nor reads `.env`.
- A path escaping `rootDir` is refused as a tool result and the run completes.
