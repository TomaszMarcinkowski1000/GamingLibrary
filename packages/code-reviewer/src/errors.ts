/**
 * Failure modes that should abort a review run rather than being handed back to
 * the model. Tool-level failures are deliberately absent: the SDK turns those
 * into `tool-error` parts the loop can recover from.
 */
export const reviewErrorCodes = ["no-output-generated", "step-budget-exhausted"] as const;

export type ReviewErrorCode = (typeof reviewErrorCodes)[number];

/**
 * Stable error type for run-level review failures, so callers can branch on
 * `code` instead of pattern-matching raw provider errors.
 */
export class ReviewError extends Error {
  readonly code: ReviewErrorCode;

  constructor(code: ReviewErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReviewError";
    this.code = code;
  }
}
