import { afterEach, beforeEach } from "vitest";

/**
 * Suite-wide deny-all `globalThis.fetch`.
 *
 * Hermeticity must be a property of the suite, not of each test remembering to install a router.
 * Several route tests (401, upload-rejection) deliberately install no fetch mock because the
 * handler returns before reaching a provider — but nothing *enforced* that, so a change to the
 * validation ordering would have sent a live request to OpenRouter/IGDB instead of failing.
 *
 * This installs a fetch that throws on every call before each test, so an unexpected network
 * attempt fails loudly. `installFetchRouter()` (test/helpers/fetch-mock.ts) overwrites it per test
 * and restores this deny-all in its own `restore()`, since that is the fetch it captured.
 */

const pristineFetch = globalThis.fetch;

function denyAll(): typeof globalThis.fetch {
  return (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    return Promise.reject(
      new Error(`Blocked network call to ${url} — tests are hermetic. Install a stub with installFetchRouter().`),
    );
  };
}

beforeEach(() => {
  globalThis.fetch = denyAll();
});

afterEach(() => {
  globalThis.fetch = pristineFetch;
});
