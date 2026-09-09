/*
 * The package's public surface.
 *
 * Two consumers load this barrel at runtime by file URL out of `dist/` rather than by static
 * import: `scripts/pr-review.mjs` (which is `.mjs` and restates nothing) and `evals/reviewer.ts`
 * in the repo root, which cannot import these types at all — `packages/*` are standalone npm
 * projects whose `dist/` the root `astro check` never builds. So `evals/reviewer.ts:26-148`
 * hand-mirrors `Review`, `CriterionScore`, `Finding` and the signatures below, and nothing links
 * the two at compile time. Change an exported shape without updating it and the eval harness keeps
 * compiling while grading against the old one; the mismatch surfaces only at runtime, on the first
 * cell of a paid sweep. If you change anything exported here, change `evals/reviewer.ts` with it.
 */
export { createReviewAgent, reviewCode } from "./agent/index.ts";
export type { CreateReviewAgentOptions, ReviewAgent, ReviewOptions, ReviewStopCondition } from "./agent/index.ts";
export { loadConfig } from "./config.ts";
export type { Config } from "./config.ts";
export { ReviewError } from "./errors.ts";
export type { ReviewErrorCode } from "./errors.ts";
export { createModel } from "./model.ts";
export type { CreateModelOptions } from "./model.ts";
export { REVIEW_INSTRUCTIONS } from "./prompts/index.ts";
export { criterionScoreSchema, findingSchema, reviewSchema, severities } from "./schemas/index.ts";
export type { CriterionScore, Finding, Review } from "./schemas/index.ts";
export { createReviewTools } from "./tools/index.ts";
export type { CreateReviewToolsOptions, ReviewTools } from "./tools/index.ts";
