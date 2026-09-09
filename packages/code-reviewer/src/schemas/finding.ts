/*
 * Hand-mirrored in `evals/reviewer.ts` (see the header of `../index.ts`): nothing links the two at
 * compile time, so a shape change here needs the same change there in the same commit.
 */
import { z } from "zod";

export const severities = ["info", "minor", "major", "critical"] as const;

export const findingSchema = z.object({
  file: z.string().describe("Path of the file the finding is in."),
  line: z.number().int().positive().describe("1-indexed line the finding anchors to."),
  severity: z.enum(severities),
  title: z.string().describe("One-line statement of the defect."),
  detail: z.string().describe("Why it is wrong and what breaks as a result."),
  suggestion: z.string().optional().describe("Concrete fix, when one is obvious."),
});

export type Finding = z.infer<typeof findingSchema>;
