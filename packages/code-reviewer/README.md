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

| Script                | What it does                             |
| --------------------- | ---------------------------------------- |
| `npm start -- <file>` | Review one file and print findings (tsx) |
| `npm run dev`         | Same, re-running on change               |
| `npm run typecheck`   | `tsc --noEmit`                           |
| `npm run build`       | Emit ESM + declarations to `dist/`       |

## Use it from code

`reviewCode` is the integration point; the CLI in `src/index.ts` is only a smoke test.

```ts
import { createModel, loadConfig, reviewCode } from "@gaminglibrary/code-reviewer";

const review = await reviewCode({
  model: createModel(loadConfig()),
  code: "// src/foo.ts\n…",
  context: "Optional: intent of the change, conventions to enforce.",
});
```

The result is validated against `reviewSchema` (`{ summary, findings[] }`), so
`review.findings` is typed and safe to consume without further parsing. Pass any AI SDK
`LanguageModel` — `MockLanguageModelV4` from `ai/test` works for unit tests.

## Notes

- TypeScript sources import each other with `.ts` specifiers
  (`rewriteRelativeImportExtensions`), so the same files run under `tsx`, under
  `node --experimental-strip-types`, and as compiled ESM in `dist/`.
- `erasableSyntaxOnly` is on, which keeps the sources compatible with Node's native
  type stripping — no enums or parameter properties.
- `.env` is read via Node's built-in `process.loadEnvFile`; real environment variables
  take precedence, so CI needs no file.
