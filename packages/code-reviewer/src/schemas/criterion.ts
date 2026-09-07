import { z } from "zod";

export const criterionScoreSchema = z.object({
  id: z.string().describe("Identifier of the criterion being scored, exactly as the review instructions name it."),
  score: z.number().int().min(1).max(10).describe("1 is the worst outcome for this criterion, 10 the best."),
  rationale: z.string().describe("Why the change earned this score, citing what was actually read."),
});

/**
 * One criterion's score. `id` is a free string rather than an enum on purpose:
 * which criteria a review has is the caller's rubric, not the package's
 * business, so the schema only knows that a review *has* scored criteria.
 */
export type CriterionScore = z.infer<typeof criterionScoreSchema>;
