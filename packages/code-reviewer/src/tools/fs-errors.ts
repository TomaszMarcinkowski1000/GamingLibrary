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

/**
 * Restates an unexpected filesystem failure so it is safe to hand to the model.
 * A raw Node error message carries the absolute path it touched, and a throw
 * inside a tool does reach the model: the SDK turns it into an `error-text` part
 * that becomes a tool result in the conversation, and travels to the provider
 * with every later step. `paths.ts` states that a refusal never leaks the
 * absolute path; this holds the throwing branches to the same rule. The original
 * error is attached as `cause`, so local logs keep the detail.
 */
export function opaqueFsError(error: unknown, requested: string): Error {
  const code = nodeErrorCode(error) ?? "unknown error";
  return new Error(`Accessing "${requested}" failed (${code}).`, { cause: error });
}
