/*
 * The posted comment.
 *
 * One new comment per run — no sticky marker, no edit-in-place, no dedup. The PR's comment history
 * *is* the audit trail: which push was reviewed, what it scored, and how the scores moved. Every
 * comment therefore leads with the head SHA it describes, so a reader scrolling a long PR can tell
 * which push they are looking at.
 *
 * The verdict is printed together with the exact rule that produced it, so nobody has to take the
 * label on trust — the table is right there and the arithmetic is one line.
 */

import { CRITERION_IDS, CRITERION_TITLES } from "./rubric.mjs";
import { VERDICT_RULE } from "./verdict.mjs";

const VERDICT_HEADINGS = {
  passed: "✅ AI code review — **passed**",
  failed: "❌ AI code review — **failed**",
};

/** Most severe first, so the reader hits the blocking findings before the nits. */
const SEVERITY_ORDER = ["critical", "major", "minor", "info"];

const SEVERITY_LABELS = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  info: "Info",
};

/**
 * Makes model-authored text safe to drop into a single table cell: newlines would end the row and
 * a bare pipe would open a phantom column.
 */
function cell(text) {
  return String(text ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function scoreTable(criteria) {
  const byId = new Map(criteria.map((entry) => [entry.id, entry]));
  const rows = CRITERION_IDS.map((id) => {
    const entry = byId.get(id);
    const title = CRITERION_TITLES[id] ?? id;
    if (!entry) return `| ${title} | — | _not returned_ |`;
    return `| ${title} | **${String(entry.score)}**/10 | ${cell(entry.rationale)} |`;
  });

  return ["| Criterion | Score | Rationale |", "| --- | --- | --- |", ...rows].join("\n");
}

function findingsSection(findings) {
  if (findings.length === 0) {
    return "### Findings\n\nNone.";
  }

  const blocks = [];
  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;

    blocks.push(`#### ${SEVERITY_LABELS[severity]} (${String(group.length)})`);
    for (const finding of group) {
      const anchor = `\`${finding.file}:${String(finding.line)}\``;
      const lines = [`- **${finding.title}** — ${anchor}`, `  ${finding.detail}`];
      if (finding.suggestion) lines.push(`  _Suggested fix:_ ${finding.suggestion}`);
      blocks.push(lines.join("\n"));
    }
  }

  return [`### Findings (${String(findings.length)})`, ...blocks].join("\n\n");
}

function reviewedFooter(paths, excludedCount) {
  const shown = paths.slice(0, 20).map((path) => `\`${path}\``);
  const rest = paths.length > shown.length ? ` …and ${String(paths.length - shown.length)} more` : "";
  const excluded =
    excludedCount > 0 ? ` ${String(excludedCount)} prose/generated path(s) were excluded from scoring.` : "";

  return `<sub>Reviewed ${String(paths.length)} path(s): ${shown.join(", ")}${rest}.${excluded}</sub>`;
}

/**
 * The normal case: a completed review with five scores.
 *
 * @param {{
 *   headSha: string,
 *   verdict: "passed" | "failed",
 *   reasons: string[],
 *   review: { summary: string, criteria: object[], findings: object[] },
 *   paths: string[],
 *   excludedCount?: number,
 *   truncated?: boolean,
 * }} input
 */
export function renderComment({ headSha, verdict, reasons, review, paths, excludedCount = 0, truncated = false }) {
  const why =
    verdict === "failed"
      ? ["**Why it failed:**", ...reasons.map((reason) => `- ${reason}`)].join("\n")
      : "No criterion fell to or below its failing threshold.";

  return [
    `## ${VERDICT_HEADINGS[verdict]}`,
    `Reviewed \`${headSha}\`.`,
    review.summary,
    "### Scores",
    scoreTable(review.criteria),
    why,
    `<sub>Rule: ${VERDICT_RULE} The verdict is computed from the scores above, not returned by the model.</sub>`,
    findingsSection(review.findings),
    truncated ? "> ⚠️ The diff was truncated before review — the change is larger than what was scored." : undefined,
    reviewedFooter(paths, excludedCount),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The review never produced a verdict — the step budget ran out, or the model returned nothing
 * matching the schema, or the criteria set came back incomplete.
 *
 * This renders as a failure on purpose. An incomplete review must never read as a pass: "we did not
 * find out" and "we looked and it was fine" are different states, and only one of them should let a
 * merge through.
 */
/*
 * Deliberately carries no `detail`. The underlying error on this path comes from the model provider
 * or from text the model authored, and this comment is posted publicly on the PR — an upstream error
 * body can carry account, quota, or routing internals that have no business there. The caller writes
 * the full error to stderr instead, which lands in the workflow run's log, where GitHub's automatic
 * masking of repository secrets applies and a PR comment's does not. `reason` is one of a fixed set
 * of strings this repository writes; nothing model-derived reaches here.
 */
export function renderIncompleteComment({ headSha, reason }) {
  return [
    `## ${VERDICT_HEADINGS.failed}`,
    `Reviewed \`${headSha}\`.`,
    `**The review did not complete**, so it is reported as failed. An incomplete review is not a passing one.`,
    `**Reason:** ${reason}`,
    "The underlying error is in this workflow run's own log, not reproduced here.",
    "Add the `ai-cr:retry` label to run it again.",
  ].join("\n\n");
}

/**
 * Nothing in the diff was scoreable — the PR changes only prose, lockfiles, or build output. No
 * model is called, and the run passes: there is no code to have got wrong.
 */
export function renderProseOnlyComment({ headSha, changedCount }) {
  return [
    `## ${VERDICT_HEADINGS.passed}`,
    `Reviewed \`${headSha}\`.`,
    `All ${String(changedCount)} changed path(s) are documentation, lockfiles, build output, or agent config. ` +
      `There is no code to review, so no model was called.`,
  ].join("\n\n");
}
