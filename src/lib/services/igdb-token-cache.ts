// Token-cache fetch wrapper for the IGDB wrapper's Twitch OAuth flow.
//
// The wrapper (`@api-wrappers/igdb-wrapper`) exposes no token-store hook — its only
// interception point is the `fetch` config option. To persist the ~60-day Twitch app
// token across ephemeral Workers isolates (and stay clear of the 25-active-token cap),
// we wrap `fetch` and short-circuit the `id.twitch.tv/oauth2/token` POST against KV.
//
// KV is request-scoped, so this factory is built per request by `createIgdbClient`,
// not as a module-level singleton.

/** Host+path fragment that identifies the Twitch app-token endpoint. */
const TWITCH_TOKEN_URL = "id.twitch.tv/oauth2/token";

/** KV key under which the cached token + its absolute expiry live. */
const KV_KEY = "twitch-app-token";

/**
 * Seconds shaved off Twitch's reported `expires_in` so the KV entry expires (and we
 * re-mint) slightly ahead of the real token, avoiding edge-of-expiry 401s.
 */
const EXPIRY_SAFETY_MARGIN_SECONDS = 300;

/** Cloudflare KV's minimum accepted `expirationTtl`. */
const KV_MIN_TTL_SECONDS = 60;

/** What Twitch's token endpoint returns (the fields the wrapper consumes). */
interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/** Shape we persist in KV: the token plus an absolute epoch-seconds expiry. */
interface CachedToken {
  access_token: string;
  expires_at: number;
}

function resolveUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Build a `fetch` that caches the Twitch app token in `kv`.
 *
 * For requests to the Twitch token endpoint: a valid cached token is returned as a
 * synthetic `Response` (no Twitch round-trip); on miss/expiry the real fetch runs and
 * the resulting token is written back with a TTL just under its lifetime. All other
 * requests pass straight through to the platform `fetch`.
 */
export function createTokenCachingFetch(kv: KVNamespace): typeof fetch {
  const cachingFetch: typeof fetch = async (input, init) => {
    const url = resolveUrl(input);

    if (!url.includes(TWITCH_TOKEN_URL)) {
      return globalThis.fetch(input, init);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    // KV is a cache: a read failure must degrade to a fresh mint, not break auth.
    let cached: CachedToken | null = null;
    try {
      cached = await kv.get<CachedToken>(KV_KEY, "json");
    } catch {
      // KV unavailable or value unparseable — fall through to a fresh token mint.
    }

    if (cached && cached.expires_at > nowSeconds) {
      const body: TwitchTokenResponse = {
        access_token: cached.access_token,
        expires_in: cached.expires_at - nowSeconds,
        token_type: "bearer",
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const response = await globalThis.fetch(input, init);
    if (!response.ok) {
      return response;
    }

    // Read from a clone so the original body stays intact for the wrapper. A malformed
    // body must not fail the call — hand the untouched response back and skip caching.
    let data: TwitchTokenResponse;
    try {
      data = await response.clone().json<TwitchTokenResponse>();
    } catch {
      // Unexpected/empty body — hand the untouched response back and skip caching.
      return response;
    }

    const expiresAt = nowSeconds + data.expires_in;
    const ttl = Math.max(KV_MIN_TTL_SECONDS, data.expires_in - EXPIRY_SAFETY_MARGIN_SECONDS);
    const toCache: CachedToken = { access_token: data.access_token, expires_at: expiresAt };
    // A cache-write failure must not fail the request — the real token is already in hand.
    try {
      await kv.put(KV_KEY, JSON.stringify(toCache), { expirationTtl: ttl });
    } catch {
      // Write failed — the real token is already in hand, so don't fail the request.
    }

    return response;
  };

  return cachingFetch;
}
