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
  cases/react-19-migration/
    before/       the pre-migration tree: React 16, hand-mounted via ReactDOM.render
    after/        the migrated tree — this is the agent's sandboxed rootDir
    tsconfig.json (in both trees, identical) — pins jsx: react-jsx and the @/ alias
    case.diff     generated from before/ + after/, committed
    case.json     the answer key: flaws[] and decoys[]
```

Later phases of `context/changes/cr-evals/plan.md` add `promptfooconfig.yaml`, `cases.ts` and
`providers/code-reviewer.ts` beside these.

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

## Commands

```bash
npm run evals:diff    # regenerate case.diff from before/ + after/
npm run evals:check   # validate every case.json against its fixture
```

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

## What this does not measure

- **One case.** Three flaws on one diff is a narrow instrument; a model can get lucky.
- **One rubric.** `REVIEW_RUBRIC` is weighted toward *test* quality: three of its five criteria are
  about tests, `stack-conventions` is a closed list carrying only two React-relevant entries (no
  Next.js directives, and the `@/` alias), and `security-isolation` is anchored on RLS and secrets
  rather than DOM injection. The flaw signal therefore rests mainly on `findings[]` and the judge
  rather than on the criterion scores — though the notes-as-markup flaw should move
  `security-isolation` too.
- **No CI wiring.** This is an on-demand harness. No workflow, no repository secret, no PR gate.

## See also

- Plan: `context/changes/cr-evals/plan.md`
- Research: `context/changes/cr-evals/research.md`
- The policy under test: `scripts/pr-review/rubric.mjs`, `scripts/pr-review/verdict.mjs`
- Prior calibration, by hand: `context/archive/2026-09-07-ci-cd-code-review/calibration.md`
