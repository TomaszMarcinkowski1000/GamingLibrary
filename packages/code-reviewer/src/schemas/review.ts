import { z } from "zod";
import { criterionScoreSchema } from "./criterion.ts";
import { findingSchema } from "./finding.ts";

export const reviewSchema = z.object({
  summary: z.string().describe("Two or three sentences on the overall state of the change."),
  criteria: z
    .array(criterionScoreSchema)
    .describe("One entry per criterion the review instructions ask for, in the order they name them."),
  findings: z.array(findingSchema),
});

/**
 * The shape a review returns. It carries scored criteria but no verdict: what
 * counts as passing is a threshold the caller owns, and deriving it in code
 * rather than asking the model for it keeps it out of reach of prompt
 * injection.
 */
export type Review = z.infer<typeof reviewSchema>;
