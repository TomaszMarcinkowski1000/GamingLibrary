import { z } from "zod";
import { findingSchema } from "./finding.ts";

export const reviewSchema = z.object({
  summary: z.string().describe("Two or three sentences on the overall state of the change."),
  findings: z.array(findingSchema),
});

export type Review = z.infer<typeof reviewSchema>;
