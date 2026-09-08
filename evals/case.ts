/*
 * The answer key, as a type.
 *
 * `case.json` is the artifact that matters here (`evals/README.md`): the runner is replaceable, a
 * hand-verified answer key is not. It is validated on the way in rather than trusted, because a
 * typo in a field name would otherwise degrade silently — a missing `whatIsBroken` becomes an
 * `undefined` interpolated into a judge rubric, and the judge grades the model against nothing.
 *
 * `scripts/evals-check-case.mjs` checks the claims this file cannot: that every `line` still sits
 * in range and still carries its `anchor`. Structure here, truth there.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { caseDir } from "./paths.ts";

/** Finding severities, mirroring `packages/code-reviewer/src/schemas/finding.ts`. */
export const severities = ["info", "minor", "major", "critical"] as const;

const flawSchema = z.object({
  /** Stable id — it becomes the promptfoo metric name for this flaw's recall. */
  id: z.string().min(1),
  /** Path relative to `rootDir`, i.e. what the agent's `read_file` tool sees. */
  file: z.string().min(1),
  /** 1-indexed line in the `after/` tree. */
  line: z.number().int().positive(),
  /** Substring that must still be on `line`; the guard against silent line drift. */
  anchor: z.string().min(1),
  severity: z.enum(severities),
  whatIsBroken: z.string().min(1),
  whyItMatters: z.string().min(1),
  supportingEvidence: z.string().min(1).optional(),
});

const decoySchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().positive(),
  anchor: z.string().min(1),
  whyItIsCorrect: z.string().min(1),
});

export const evalCaseSchema = z.object({
  id: z.string().min(1),
  /** PR title. Reaches the model. */
  title: z.string().min(1),
  /**
   * What this case is FOR — read by humans, never sent to a model.
   *
   * It names the planted flaws and the decoys, so sending it to the reviewer hands over the
   * answer key. That is not hypothetical: the first green run of this harness did exactly that,
   * and the model's own summary opened "Three defects are planted per the PR description; all
   * three are correctly identified." Every recall number from that run was worthless.
   */
  description: z.string().min(1),
  /**
   * The PR body as its author would have written it. This is the half the model sees.
   *
   * Kept as a separate field rather than derived from `description`, because the failure above is
   * silent: a leaked answer key produces a *better-looking* result, not an error.
   */
  prDescription: z.string().min(1),
  /** Directory, relative to the case folder, the agent is sandboxed to. */
  rootDir: z.string().min(1),
  /** Root-relative paths named in the review request. */
  paths: z.array(z.string().min(1)).min(1),
  /** The committed unified diff, relative to the case folder. */
  diffPath: z.string().min(1),
  flaws: z.array(flawSchema).min(1),
  decoys: z.array(decoySchema),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type Flaw = z.infer<typeof flawSchema>;
export type Decoy = z.infer<typeof decoySchema>;

/** A case with its file-system facts resolved: absolute `rootDir`, diff text inlined. */
export interface LoadedCase {
  readonly answerKey: EvalCase;
  /** Absolute path of the tree the agent may read. */
  readonly rootDir: string;
  /** The unified diff, verbatim. */
  readonly diff: string;
}

export function loadCase(caseId: string): LoadedCase {
  const dir = caseDir(caseId);
  const answerKeyPath = path.join(dir, "case.json");

  const parsed = evalCaseSchema.safeParse(JSON.parse(readFileSync(answerKeyPath, "utf8")));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`${answerKeyPath} is not a valid answer key:\n${issues.join("\n")}`);
  }

  return {
    answerKey: parsed.data,
    rootDir: path.join(dir, parsed.data.rootDir),
    diff: readFileSync(path.join(dir, parsed.data.diffPath), "utf8"),
  };
}
