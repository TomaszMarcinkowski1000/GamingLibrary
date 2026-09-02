# @gaminglibrary/code-reviewer

Entry point for AI-assisted code review, built on the [Vercel AI SDK](https://ai-sdk.dev/docs)
with [OpenRouter](https://openrouter.ai/) as the model provider and zod for structured output.

Standalone package — the repo root has no npm workspaces, so install and run from this
directory.

## Setup

```bash
npm install
cp .env.example .env   # then paste a key from https://openrouter.ai/keys
```

`OPENROUTER_MODEL` accepts any id from https://openrouter.ai/models and defaults to
`anthropic/claude-sonnet-5`.

## Scripts

| Script                | What it does                                       |
| --------------------- | -------------------------------------------------- |
| `npm start -- <file>` | Review one file and print findings (`src/cli.ts`)  |
| `npm run dev`         | Same, re-running on change                         |
| `npm run typecheck`   | `tsc --noEmit`                                     |
| `npm run build`       | Emit ESM + declarations to `dist/`                 |

## Use it from code

`reviewCode` is the integration point; the CLI in `src/cli.ts` is only a smoke test.

```ts
import { createModel, loadConfig, reviewCode } from "@gaminglibrary/code-reviewer";

const review = await reviewCode({
  model: createModel(loadConfig()),
  rootDir: process.cwd(),
  paths: ["src/foo.ts", "src/foo.test.ts"],
  context: "Optional: intent of the change, conventions to enforce.",
});
```

You pass paths, not contents — the agent reads the files itself. The result is validated
against `reviewSchema` (`{ summary, findings[] }`), so `review.findings` is typed and safe
to consume without further parsing.

For repeated runs, streaming, or lifecycle callbacks, build the agent once instead:

```ts
import { createReviewAgent } from "@gaminglibrary/code-reviewer";

const agent = createReviewAgent({ model, rootDir, stopWhen: isStepCount(20) });
const { output } = await agent.generate({ prompt });
```

## The agent

`createReviewAgent` returns an AI SDK `ToolLoopAgent` with three tools, all **read-only**
and all confined to `rootDir`:

| Tool          | What it does                                                     |
| ------------- | ---------------------------------------------------------------- |
| `read_file`   | Reads a file, optionally a line range, with 1-indexed line numbers |
| `list_files`  | Lists a directory's entries                                       |
| `search_code` | Finds a literal string across the tree, returning path + line     |

Every caller-supplied path routes through the containment guard in `src/tools/paths.ts`,
which compares on path segment boundaries against the symlink-resolved root. A path that
escapes the root is refused as a tool result the model sees, not an exception that kills
the run. There are no write, edit, or shell tools.

The default step budget is `isStepCount(20)`, overridable via `stopWhen` on either
`createReviewAgent` or `reviewCode`. Generating the structured output is itself a step, so
twenty steps is roughly nineteen tool calls plus the final verdict. A run that hits the cap
without a verdict throws `ReviewError` with `code: "step-budget-exhausted"`.

Budget it generously: reviewing a single small file has been observed to take nine tool
calls, since the agent follows imports to check the contracts it is judging.

On the last affordable step the agent runs with `toolChoice: "none"`, so a model that would
otherwise keep reading has to answer from the evidence it already has. Override `stopWhen`
and that net goes with it unless you also pass `stepBudget` to say where the loop ends.

**Model choice matters.** The agent has to decide for itself when the evidence is enough.
`anthropic/claude-sonnet-5` (the default) converged on every run tried; `claude-haiku-4.5`
often kept calling tools until the budget ran out, or returned an empty object. If reviews
come back as `ReviewError`, check the model before raising the budget.

Run-level failures — no verdict, budget exhausted — surface as `ReviewError`. Tool-level
failures deliberately do not: the SDK turns them into `tool-error` parts the model reacts
to mid-loop.

## Notes

- `src/index.ts` is a pure barrel: importing the package reads no environment, touches no
  `.env`, and constructs nothing. Only `src/cli.ts` calls `loadConfig()`. That is what lets
  an eval harness import this package from an unrelated directory.
- `model` is always injected, never derived from config inside the agent. Any AI SDK
  `LanguageModel` works, including `MockLanguageModelV4` from `ai/test` — no OpenRouter
  credential needed to construct or exercise the agent.
- TypeScript sources import each other with `.ts` specifiers
  (`rewriteRelativeImportExtensions`), so the same files run under `tsx`, under
  `node --experimental-strip-types`, and as compiled ESM in `dist/`.
- `erasableSyntaxOnly` is on, which keeps the sources compatible with Node's native
  type stripping — no enums or parameter properties.
- `.env` is read via Node's built-in `process.loadEnvFile`; real environment variables
  take precedence, so CI needs no file.
