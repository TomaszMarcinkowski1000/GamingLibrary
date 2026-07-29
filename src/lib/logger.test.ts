import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SDK rather than a transport: the contract worth locking is what *this* module asks
// Sentry for, not whether Sentry can deliver it. Matches the isolation style of
// `src/lib/services/library.test.ts`.
vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

import * as Sentry from "@sentry/cloudflare";
import { logError, logWarning } from "./logger";

const captureException = vi.mocked(Sentry.captureException);

/** `expect.any(String)` is typed `any`; widen once here rather than at every use. */
const ANY_STACK = expect.any(String) as unknown;

// Captured rather than read back off `spy.mock.calls`, so the asserted lines stay typed as strings.
const errorLines: string[] = [];
const warnLines: string[] = [];

/** The single JSON line the call under test wrote, parsed back. */
function onlyLine(lines: string[]): Record<string, unknown> {
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as Record<string, unknown>;
}

beforeEach(() => {
  captureException.mockReset();
  errorLines.length = 0;
  warnLines.length = 0;
  vi.spyOn(console, "error").mockImplementation((line: string) => {
    errorLines.push(line);
  });
  vi.spyOn(console, "warn").mockImplementation((line: string) => {
    warnLines.push(line);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logError → Sentry", () => {
  it("captures the thrown value once, tagged with the event name and carrying the fields", () => {
    const error = new Error("igdb down");

    logError("library.lookup.igdb_unavailable", error, { title: "Some Game", platform: "PC" });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { event: "library.lookup.igdb_unavailable" },
      extra: { title: "Some Game", platform: "PC" },
    });
  });

  it("promotes a string `fields.userId` to Sentry's user field", () => {
    logError("library.create.failed", new Error("boom"), { userId: "user-123", entryId: 7 });

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { event: "library.create.failed" },
      extra: { userId: "user-123", entryId: 7 },
      user: { id: "user-123" },
    });
  });

  it("omits `user` entirely when userId is absent", () => {
    logError("library.create.failed", new Error("boom"));

    expect(captureException.mock.calls[0][1]).not.toHaveProperty("user");
  });

  it("omits `user` when userId is present but not a string", () => {
    logError("library.create.failed", new Error("boom"), { userId: 42 });

    expect(captureException.mock.calls[0][1]).not.toHaveProperty("user");
  });

  it("does not let a throw from the SDK escape into the caller's catch", () => {
    captureException.mockImplementation(() => {
      throw new Error("sentry transport exploded");
    });

    expect(() => {
      logError("library.create.failed", new Error("boom"));
    }).not.toThrow();
    // The obligation the caller actually relies on — the log line — still landed.
    expect(errorLines).toHaveLength(1);
  });
});

describe("logWarning", () => {
  it("never reaches Sentry — warnings are deliberately console-only", () => {
    logWarning("auth.signin.malformed_request", { reason: "missing_password" });

    expect(captureException).not.toHaveBeenCalled();
    expect(warnLines).toHaveLength(1);
  });
});

describe("console output shape", () => {
  it("writes one JSON error line with the level, event, serialized error and spread fields", () => {
    logError("library.lookup.igdb_unavailable", new Error("igdb down"), { userId: "user-123" });

    expect(onlyLine(errorLines)).toEqual({
      level: "error",
      event: "library.lookup.igdb_unavailable",
      error: { name: "Error", message: "igdb down", stack: ANY_STACK },
      userId: "user-123",
    });
  });

  it("walks an Error's `cause` chain instead of flattening it to `{}`", () => {
    const root = new TypeError("fetch failed");
    logError("library.lookup.igdb_unavailable", new Error("lookup failed", { cause: root }));

    expect(onlyLine(errorLines)).toMatchObject({
      error: {
        message: "lookup failed",
        cause: { name: "TypeError", message: "fetch failed", stack: ANY_STACK },
      },
    });
  });

  it("keeps a non-Error throw as-is", () => {
    logError("library.create.failed", { code: "PGRST116", details: null });

    expect(onlyLine(errorLines)).toMatchObject({ error: { code: "PGRST116", details: null } });
  });

  it("writes one JSON warn line with no `error` key", () => {
    logWarning("auth.signin.malformed_request", { reason: "missing_password" });

    expect(onlyLine(warnLines)).toEqual({
      level: "warn",
      event: "auth.signin.malformed_request",
      reason: "missing_password",
    });
  });
});
