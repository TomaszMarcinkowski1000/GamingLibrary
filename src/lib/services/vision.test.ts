import { beforeEach, describe, expect, it, vi } from "vitest";

// Guard suite for the e2e determinism seam (`stubbedVisionRead`).
//
// The seam replaces the OpenRouter hop inside `POST /api/identify` when a request proves knowledge of
// a server-side key. Its production-safety property — "unreachable unless the server was deliberately
// configured for e2e" — is provable in milliseconds here, so it is proved here rather than trusted to
// a browser test that could only ever observe the armed case anyway.
//
// The oracle is the guard's three independent locks (server key set / request echoes it / a title to
// return), not any value copied out of `vision.ts`. The success case additionally asserts that the
// seam did NOT become a way around normalization: `stubbedVisionRead` runs the same
// `normalizeTitleCasing` + `normalizePlatformLabel` choke point the real read passes through, which is
// load-bearing for grounding downstream (see `identify.test.ts` / `igdb.integration.test.ts`).

// `astro:env/server` is aliased to `test/stubs/astro-env-server.ts` for the suite at large, which
// leaves the key `undefined`. This file needs it to vary per test, so it mocks the module through a
// hoisted holder and reads it via a getter — the import is compiled to a namespace property access,
// so each call site re-reads the current value (same holder pattern as `identify.test.ts:29`).
const holder = vi.hoisted((): { stubKey: string | undefined } => ({ stubKey: undefined }));
vi.mock("astro:env/server", () => ({
  get E2E_VISION_STUB_KEY() {
    return holder.stubKey;
  },
  OPENROUTER_API_KEY: "test-openrouter-key",
}));

import { stubbedVisionRead } from "./vision";

const KEY_HEADER = "x-e2e-vision-key";
const TITLE_HEADER = "x-e2e-vision-title";
const PLATFORM_HEADER = "x-e2e-vision-platform";

const SECRET = "stub-key-abc123";

beforeEach(() => {
  holder.stubKey = undefined;
});

describe("stubbedVisionRead — the seam cannot fire without both locks", () => {
  it("returns null when the server key is unset, even for a fully-formed stub request", () => {
    // THE production-safety assertion: production sets no key, so a caller who somehow guessed the
    // header names still falls through to the real provider. Everything else in this suite is detail.
    holder.stubKey = undefined;

    const result = stubbedVisionRead(
      new Headers({ [KEY_HEADER]: SECRET, [TITLE_HEADER]: "Alan Wake II", [PLATFORM_HEADER]: "PS5" }),
    );

    expect(result).toBeNull();
  });

  it("treats an empty-string key as unset", () => {
    // The boundary `astro:env`'s optional secrets make easy to conflate: "declared and blank" is not
    // "configured". A blank key must not turn header-presence into the only remaining lock.
    holder.stubKey = "";

    const result = stubbedVisionRead(new Headers({ [KEY_HEADER]: "", [TITLE_HEADER]: "Alan Wake II" }));

    expect(result).toBeNull();
  });

  it("treats a whitespace-only key as unset", () => {
    // Same boundary as above, one step subtler: `"   "` is truthy, so an untrimmed lock 1 would read
    // it as "configured" and hand the whole guard to lock 2 — which no caller can then satisfy,
    // because RFC 7230 strips the whitespace off the header value. Fails closed either way; the
    // point is that it fails closed at lock 1, where the operator can be told the key is unset.
    holder.stubKey = "   ";

    expect(stubbedVisionRead(new Headers({ [KEY_HEADER]: "   ", [TITLE_HEADER]: "Alan Wake II" }))).toBeNull();
    expect(stubbedVisionRead(new Headers({ [KEY_HEADER]: "", [TITLE_HEADER]: "Alan Wake II" }))).toBeNull();
  });

  it("matches a server key that was configured with stray whitespace", () => {
    // The operator-error case the trim exists for: a key copied out of `.dev.vars` with a trailing
    // space. The header cannot carry that space (RFC 7230 strips it), so an untrimmed comparison
    // would make a correctly-configured e2e environment permanently unarmable.
    holder.stubKey = `  ${SECRET}\t`;

    const result = stubbedVisionRead(new Headers({ [KEY_HEADER]: SECRET, [TITLE_HEADER]: "Alan Wake II" }));

    expect(result).toMatchObject({ status: "identified", title: "Alan Wake II" });
  });

  it("returns null when the key is set but the request carries no key header", () => {
    // The ordinary production request on an e2e-configured server: no header, real provider path.
    holder.stubKey = SECRET;

    const result = stubbedVisionRead(new Headers({ [TITLE_HEADER]: "Alan Wake II" }));

    expect(result).toBeNull();
  });

  it("returns null when the key header does not match the server key", () => {
    holder.stubKey = SECRET;

    const result = stubbedVisionRead(new Headers({ [KEY_HEADER]: "wrong-key", [TITLE_HEADER]: "Alan Wake II" }));

    expect(result).toBeNull();
  });

  it("rejects keys that differ only in length or only in the last character", () => {
    // Exercises both arms of the constant-time comparison: the length fold (a correct prefix, and a
    // correct key plus a suffix) and the per-character XOR (same length, one byte off). A `startsWith`
    // or a truncating compare would let one of these through.
    holder.stubKey = SECRET;

    for (const presented of [SECRET.slice(0, -1), `${SECRET}x`, `${SECRET.slice(0, -1)}X`]) {
      expect(stubbedVisionRead(new Headers({ [KEY_HEADER]: presented, [TITLE_HEADER]: "Alan Wake II" }))).toBeNull();
    }
  });

  it("returns null when the key matches but no title header is supplied", () => {
    // A malformed test request degrades to the production path rather than to a 4xx or a throw.
    holder.stubKey = SECRET;

    expect(stubbedVisionRead(new Headers({ [KEY_HEADER]: SECRET }))).toBeNull();
    expect(stubbedVisionRead(new Headers({ [KEY_HEADER]: SECRET, [TITLE_HEADER]: "   " }))).toBeNull();
  });
});

describe("stubbedVisionRead — an armed request yields a normalized identified read", () => {
  it("normalizes the title and platform exactly as the real vision read does", () => {
    // A shouty box-art title and a platform alias go in; the canonical forms must come out. If the
    // seam ever skipped the normalizers, grounding downstream would see a shape the real provider
    // path never produces — and the e2e would be exercising a journey the app doesn't have.
    // (A lowercase title would be a weak probe: `normalizeTitleCasing` leaves any token containing a
    // lowercase letter alone by design — `platforms.ts:158-159`'s stylization guard.)
    holder.stubKey = SECRET;

    const result = stubbedVisionRead(
      new Headers({ [KEY_HEADER]: SECRET, [TITLE_HEADER]: "ALAN WAKE II", [PLATFORM_HEADER]: "ps5" }),
    );

    expect(result).toEqual({
      status: "identified",
      title: "Alan Wake II",
      platform: "PlayStation 5",
      confidence: 1,
    });
  });

  it("defaults the platform when only a title is supplied", () => {
    holder.stubKey = SECRET;

    const result = stubbedVisionRead(new Headers({ [KEY_HEADER]: SECRET, [TITLE_HEADER]: "  HOLLOW KNIGHT  " }));

    expect(result).toMatchObject({ status: "identified", title: "Hollow Knight", platform: "PlayStation 5" });
  });
});
