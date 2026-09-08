/*
 * The two things the prompt needs, derived from a checkout plus the PR's two SHAs: the unified
 * diff, and the code subset of the changed paths.
 *
 * Both SHAs come from `github.event.pull_request.{base,head}.sha` rather than from `HEAD` or a
 * merge commit, so the review still describes a coherent range if the branch is force-pushed
 * mid-run. Both commits have to be present in the checkout — the calling workflow uses
 * `fetch-depth: 0` for exactly that reason.
 *
 * Two filters, and they are not the same filter:
 *
 *   - `paths` is the *scored* set — what the agent is told to review. Prose, lockfiles, build
 *     output and agent config are excluded (`plan.md` § "What We're NOT Doing"), and deleted files
 *     are dropped because the agent's `read_file` cannot open them.
 *   - `diff` is scoped by pathspec to the same code subset *plus* deletions. The plan's contract
 *     names a bare `git diff <base> <head>`; scoping it is the one adaptation here, and it is a
 *     cost decision. The average PR in this repo changes 19.4 files and most of them are under
 *     `context/` — PR #33 was 5 of ~8. Feeding the model tens of kilobytes of plan prose and then
 *     instructing it to ignore that prose burns the step budget and the price cap for nothing.
 *     Deletions stay in the diff text because "this file went away" is reviewable even though the
 *     file cannot be read.
 */

import { execFileSync } from "node:child_process";

/**
 * Hard ceiling on the diff text handed to the model. A single generated or vendored file can run
 * to megabytes; past this point the diff is not informative, it just crowds out the instructions
 * and the rest of the change. Truncation is announced in-band so neither the model nor a reader of
 * the comment mistakes a cut-off diff for the whole change.
 */
const MAX_DIFF_CHARS = 400_000;

/** Ample headroom over MAX_DIFF_CHARS so the cap below is what truncates, not the pipe buffer. */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Paths excluded from the scored set and from the diff.
 *
 * `context/**` and `**\/*.md` are prose — plans, research, foundation docs. `package-lock.json` is
 * generated. `dist/**` is build output (gitignored at the root, but `packages/*` carry their own).
 * `.claude/**` is agent configuration, not application code.
 */
function isExcluded(path) {
  const segments = path.split("/");
  return (
    path.startsWith("context/") ||
    path.startsWith(".claude/") ||
    path.endsWith(".md") ||
    segments.at(-1) === "package-lock.json" ||
    segments.slice(0, -1).includes("dist")
  );
}

/** Runs git in `cwd` and returns stdout as a string. */
function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
  });
}

/**
 * Parses `git diff --name-status -z` output.
 *
 * NUL separation rather than newlines because git quotes and escapes paths containing non-ASCII or
 * whitespace in its default output, and a quoted path is not a usable pathspec. Records are
 * `<status> NUL <path> NUL`, except renames and copies, which carry both the old and the new path:
 * `R100 NUL <old> NUL <new> NUL`.
 *
 * @returns {{ status: string, path: string, oldPath?: string }[]}
 */
function parseNameStatus(output) {
  const fields = output.split("\0").filter((field) => field !== "");
  const entries = [];

  for (let i = 0; i < fields.length; ) {
    const status = fields[i];
    const isRenameOrCopy = status.startsWith("R") || status.startsWith("C");

    if (isRenameOrCopy) {
      entries.push({ status, oldPath: fields[i + 1], path: fields[i + 2] });
      i += 3;
    } else {
      entries.push({ status, path: fields[i + 1] });
      i += 2;
    }
  }

  return entries;
}

/**
 * Collects the review inputs for one PR.
 *
 * @param {{ baseSha: string, headSha: string, cwd?: string }} options
 * @returns {{
 *   paths: string[],
 *   deleted: string[],
 *   diff: string,
 *   excluded: string[],
 *   changedCount: number,
 *   truncated: boolean,
 * }}
 *   `paths` is the scored set; `diff` is the pathspec-scoped unified diff (empty when `paths` and
 *   the code deletions are both empty). `excluded` and `changedCount` exist so the caller can say
 *   *why* a PR was treated as prose-only rather than just asserting it was.
 */
export function collectInputs({ baseSha, headSha, cwd = process.cwd() }) {
  const entries = parseNameStatus(git(["diff", "--name-status", "-z", baseSha, headSha], cwd));

  const kept = entries.filter((entry) => !isExcluded(entry.path));
  const excluded = entries.filter((entry) => isExcluded(entry.path)).map((entry) => entry.path);

  // The agent reads the checkout's current state, so a path it cannot open is noise in the list it
  // is handed. The deletion still reaches it through the diff text.
  const paths = kept.filter((entry) => entry.status !== "D").map((entry) => entry.path);

  // Returned separately because `paths.length === 0` is NOT the same question as "this PR changed no
  // code". A change that only deletes code — a test file, an RLS migration, a route handler — leaves
  // `kept` non-empty and `paths` empty, and a caller that conflates the two skips the review and
  // calls it prose-only. That was live: a deletion-only PR auto-passed with no model call and a
  // comment claiming every changed path was documentation. Ask `kept.length`, via this, for
  // "was there code here"; ask `paths.length` only for "what can the agent open".
  const deleted = kept.filter((entry) => entry.status === "D").map((entry) => entry.path);

  // Renames only render as renames when both sides are in the pathspec; without the old path git
  // shows the new file as a wholesale addition.
  const diffPathspec = [
    ...new Set(kept.flatMap((entry) => (entry.oldPath ? [entry.oldPath, entry.path] : [entry.path]))),
  ];

  if (diffPathspec.length === 0) {
    return { paths, deleted, diff: "", excluded, changedCount: entries.length, truncated: false };
  }

  const raw = git(["diff", "--no-color", baseSha, headSha, "--", ...diffPathspec], cwd);
  const truncated = raw.length > MAX_DIFF_CHARS;
  const diff = truncated
    ? `${raw.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${String(MAX_DIFF_CHARS)} characters — the change is larger than shown]`
    : raw;

  return { paths, deleted, diff, excluded, changedCount: entries.length, truncated };
}
