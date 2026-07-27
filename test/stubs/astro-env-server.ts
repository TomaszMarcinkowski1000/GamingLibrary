// Test stub for the `astro:env/server` virtual module.
//
// That module only exists inside Astro's build/runtime. Vitest aliases `astro:env/server`
// here so modules importing server env vars (e.g. `services/igdb.ts`, `services/vision.ts`)
// load under test.
//
// Provider credentials are non-empty *dummy* values, never live secrets. They exist so the
// real code paths run under test instead of throwing on a missing secret: `createIgdbClient`
// (igdb.ts) throws when `TWITCH_CLIENT_ID/SECRET` are falsy, and `identifyGameFromPhoto`
// (vision.ts) throws when `OPENROUTER_API_KEY` is falsy. No live request is ever made — the
// hermetic integration suites intercept `globalThis.fetch` (see `test/helpers/fetch-mock.ts`).
//
// `SUPABASE_*` stay `undefined`: the route tests inject their Supabase client by mocking
// `@/lib/supabase`'s `createClient`, so the real one is never constructed.
export const SUPABASE_URL: string | undefined = undefined;
export const SUPABASE_KEY: string | undefined = undefined;
export const TWITCH_CLIENT_ID: string | undefined = "test-twitch-client-id";
export const TWITCH_CLIENT_SECRET: string | undefined = "test-twitch-client-secret";
export const OPENROUTER_API_KEY: string | undefined = "test-openrouter-key";

// `E2E_VISION_STUB_KEY` stays `undefined` on purpose — the inverse of the dummy credentials above.
// It arms the e2e determinism seam (`stubbedVisionRead` in `services/vision.ts`), so leaving it unset
// makes the whole suite standing evidence that the seam is dead in its default state. Tests that need
// it armed mock `astro:env/server` themselves (see `src/lib/services/vision.test.ts`).
export const E2E_VISION_STUB_KEY: string | undefined = undefined;
