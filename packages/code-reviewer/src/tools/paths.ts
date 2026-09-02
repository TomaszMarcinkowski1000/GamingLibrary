import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** A candidate path that was proven to live inside the review root. */
export interface PathAllowed {
  readonly ok: true;
  /** Absolute, symlink-resolved path safe to hand to `fs`. */
  readonly absolutePath: string;
  /** Root-relative path with `/` separators, for echoing back to the model. */
  readonly relativePath: string;
}

/** A candidate path that resolved outside the review root. */
export interface PathRefused {
  readonly ok: false;
  readonly reason: "outside-root";
  /** Model-facing explanation. Never leaks the absolute path it resolved to. */
  readonly message: string;
}

export type PathResolution = PathAllowed | PathRefused;

/** Resolves one caller-supplied path against the review root, or refuses it. */
export type ResolveWithinRoot = (candidate: string) => PathResolution;

export interface PathGuard {
  /** The absolute, symlink-resolved review root. */
  readonly root: string;
  readonly resolveWithinRoot: ResolveWithinRoot;
}

/**
 * Resolves `target` through symlinks. A path that does not exist yet still gets
 * its existing ancestors resolved, so a symlinked parent directory cannot hide a
 * path that would otherwise be caught escaping the root.
 */
function realpathOfNearestExisting(target: string): string {
  let current = target;

  for (;;) {
    try {
      return join(realpathSync(current), relative(current, target));
    } catch {
      const parent = dirname(current);
      // At the filesystem root there is nothing left to resolve.
      if (parent === current) return target;
      current = parent;
    }
  }
}

/**
 * Containment tested on path *segment* boundaries, not string prefixes:
 * `/repo-evil` has `/repo` as a string prefix but is not inside it. `relative()`
 * gives a segment-wise answer and is case-insensitive on Windows, matching how
 * the filesystem itself compares paths.
 */
function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);

  // `relative` only returns an absolute path when the two sit on different
  // Windows drives, which is as far outside the root as it gets.
  if (isAbsolute(rel)) return false;

  // "" means the candidate *is* the root. A leading ".." segment means it escaped.
  // Comparing on `..` plus a separator keeps a legitimate name like "..config"
  // from reading as an escape.
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

/**
 * Builds the single containment rule every tool routes through. The root is
 * resolved once here rather than per call, so the security property is stated in
 * exactly one place and costs one `realpath` for the whole run.
 *
 * Throws if `rootDir` does not exist — that is a caller bug, not something the
 * model should be asked to recover from.
 */
export function createPathGuard(rootDir: string): PathGuard {
  let root: string;
  try {
    root = realpathSync(resolve(rootDir));
  } catch (error: unknown) {
    throw new Error(`Review root is not a readable directory: ${rootDir}`, { cause: error });
  }

  const resolveWithinRoot: ResolveWithinRoot = (candidate) => {
    // `resolve` neutralises "." and ".." segments and turns an absolute
    // candidate into itself — either way the containment check below decides.
    const absolutePath = realpathOfNearestExisting(resolve(root, candidate));

    if (!isInsideRoot(root, absolutePath)) {
      return {
        ok: false,
        reason: "outside-root",
        message: `Refused: "${candidate}" resolves outside the review root. Only paths inside the root can be read.`,
      };
    }

    return {
      ok: true,
      absolutePath,
      relativePath: relative(root, absolutePath).split(sep).join("/") || ".",
    };
  };

  return { root, resolveWithinRoot };
}
