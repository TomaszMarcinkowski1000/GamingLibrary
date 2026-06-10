// Test stub for the `astro:env/server` virtual module.
//
// That module only exists inside Astro's build/runtime. Vitest aliases `astro:env/server`
// here so modules importing server env vars (e.g. `services/igdb.ts`) load under test.
// Values are intentionally empty — unit tests either mock the consuming code or exercise
// pure helpers that never read these.
export const SUPABASE_URL: string | undefined = undefined;
export const SUPABASE_KEY: string | undefined = undefined;
export const TWITCH_CLIENT_ID: string | undefined = undefined;
export const TWITCH_CLIENT_SECRET: string | undefined = undefined;
