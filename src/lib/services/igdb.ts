import { IGDBClient } from "@api-wrappers/igdb-wrapper";
import { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } from "astro:env/server";
import { createTokenCachingFetch } from "./igdb-token-cache";

// Per-request IGDB client factory.
//
// The Twitch credentials resolve at module load via `astro:env/server`, but the KV
// binding used for token caching is only available per request. So the client cannot be
// a module-level singleton — the caller resolves the KV namespace (e.g. from the
// Cloudflare runtime env) and passes it in, and the token-caching `fetch` closes over it.

/**
 * Construct an `IGDBClient` wired with the request's KV namespace for Twitch token
 * caching. Reads the Twitch app credentials from `astro:env/server`.
 *
 * Not a singleton: build one per request so the wrapped `fetch` binds to that request's
 * KV namespace.
 */
export function createIgdbClient(kv: KVNamespace): IGDBClient {
  // The secrets are declared `optional` in the env schema (so build/scaffold proceed
  // without live creds), hence `string | undefined`. A client without them is unusable,
  // so fail loudly rather than constructing a client that 401s on first call.
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    throw new Error(
      "Missing TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET — set them in .dev.vars (local) or Worker secrets (prod).",
    );
  }

  return new IGDBClient({
    clientId: TWITCH_CLIENT_ID,
    clientSecret: TWITCH_CLIENT_SECRET,
    fetch: createTokenCachingFetch(kv),
  });
}
