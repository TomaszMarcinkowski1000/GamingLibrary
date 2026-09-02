/**
 * Reads the `code` off a Node system error (`ENOENT`, `EISDIR`, `EACCES`, …)
 * without an `any` cast, so tools can turn the failures they expect into typed
 * refusals and let everything else throw.
 */
export function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}
