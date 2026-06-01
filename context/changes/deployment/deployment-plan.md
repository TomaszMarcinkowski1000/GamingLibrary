# Cloudflare Workers — Integration & First Deploy Plan

## Context

`context/foundation/infrastructure.md` selected **Cloudflare Workers** as the MVP deploy
platform for Gaming Library (Astro 6 SSR + React islands + Supabase auth/DB). The project
already ships the `@astrojs/cloudflare` adapter, so this is a zero-migration deploy — the
work is *hardening config, validating on the real runtime, and wiring deploy automation*,
not changing the stack.

Exploration of the current repo found the scaffold is mostly deploy-ready but has gaps and
some stale guidance in `infrastructure.md` that this plan corrects:

- ✅ `wrangler.jsonc` is correct: `main: "@astrojs/cloudflare/entrypoints/server"` (the
  **modern Astro 6 path** — `infrastructure.md` line 107's `./dist/_worker.js/index.js` is
  legacy pre-Astro-6 guidance and must NOT be followed). `nodejs_compat` flag present,
  `compatibility_date: 2026-05-08`, `assets.directory: ./dist` all correct.
- 🔴 `astro.config.mjs` does **not** set `imageService` → defaults to billable
  `cloudflare-binding` (infrastructure.md risk #4). Must set `'compile'`.
- ⚠️ No `.dev.vars` / `.dev.vars.example` → can't run `wrangler dev` (the real-runtime
  validation infrastructure.md insists on).
- ⚠️ Worker name is generic `10x-astro-starter` → rename to `gaming-library`.
- ⚠️ `.github/workflows/ci.yml` triggers on **`master`** but the branch is **`main`** → CI
  never runs today. Fix the trigger.
- ℹ️ OpenRouter AI-vision feature has no code/env yet → **deferred** (per your choice).

**Decisions locked in:** rename Worker to `gaming-library`; authenticate via interactive
`wrangler login`; deploys are **manual `wrangler deploy` + Cloudflare Workers Builds
auto-deploy on push** (git integration handled in the Cloudflare dashboard); defer
OpenRouter plumbing until the feature exists.

**Intended outcome:** Gaming Library running live at
`https://gaming-library.<subdomain>.workers.dev`, validated on workerd, with auth working,
no surprise Image billing, one-command rollback ready, and pushes to `main` auto-deploying.

---

## Prerequisites — accounts, CLI & Supabase setup  ☐

> Do this **before Phase 0**. These are mostly one-time, account-level steps; the ones
> marked 🧑 are human-only (account creation, billing, secret values) — an agent can't and
> shouldn't do them. Both CLIs (`wrangler`, `supabase`) are run via `npx` — neither needs a
> global install (`wrangler ^4.90.0` is already a devDependency; `supabase` resolves via
> `npx`).

### A. Cloudflare CLI (`wrangler`)

- [ ] 🧑 **Create a Cloudflare account** at <https://dash.cloudflare.com/sign-up> (free).
- [ ] 🧑 **Enable the Workers Paid plan (~$5/mo).** infrastructure.md's research finding:
      the free tier's 10 ms/invocation CPU cap makes SSR + the AI proxy unusable, so this
      is the real baseline, not optional. Dashboard → Workers & Pages → Plans. (Billing =
      human-only per the ops boundary.)
- [ ] **Authenticate wrangler** (interactive, one-time): run `! npx wrangler login` in this
      session → OAuth browser flow. *(CI alternative: a Workers-scoped
      `CLOUDFLARE_API_TOKEN` — no DNS/billing — but for this MVP `login` is the chosen path.)*
- [ ] **Verify**: `npx wrangler whoami` → prints your account name, ID, and login email.
- [ ] **Note your `workers.dev` subdomain** (Dashboard → Workers & Pages → your subdomain,
      or set on first deploy). It forms the live URL:
      `https://gaming-library.<subdomain>.workers.dev`.

### B. Supabase — hosted project (production)

- [ ] 🧑 **Create a Supabase account + project** at <https://supabase.com/dashboard>. Pick a
      region close to users; set a strong **DB password** (human-only secret — store in your
      password manager, never in the repo).
- [ ] 🧑 **Copy the two values the app needs** from Project → **Settings → API Keys**:
      - **Project URL** → `SUPABASE_URL` (e.g. `https://<ref>.supabase.co`)
      - **Publishable key** (`sb_publishable_…`) → `SUPABASE_KEY`. This replaces the legacy
        `anon` key; the legacy anon JWT still works through end of 2026 if you see that
        instead. **Use the publishable/anon key, NOT the `secret`/`service_role` key** —
        `src/lib/supabase.ts` uses `@supabase/ssr` with the client-safe key; the secret key
        must never reach the browser/SSR client.
- [ ] These two values become the **production Worker secrets** set in Phase 3, and go in
      `.dev.vars` if you point local dev at the hosted project.
- [ ] 🧑 **Confirm-email flow**: the app has a `confirm-email` page, so keep "Confirm email"
      enabled (Authentication → Providers → Email) and set the **Site URL / redirect URLs**
      (Authentication → URL Configuration) to your Worker URL once known.

### C. Supabase — local stack (optional, recommended for `wrangler dev`)

- [ ] **Docker Desktop must be running** (the local stack runs in containers).
- [ ] `npx supabase start` — boots Postgres/Auth/Storage locally and prints the **API URL**
      (`http://127.0.0.1:54321`) plus local **anon/publishable** and **service_role** keys.
- [ ] Put the local **API URL + anon/publishable key** into `.dev.vars` (Phase 1) to exercise
      auth on workerd without touching production data.
- [ ] Local emails (signup confirmations) are caught by the bundled mail UI at
      `http://127.0.0.1:54324` — use it to complete the confirm-email step locally.
- [ ] Re-print creds anytime with `npx supabase status`; shut down with `npx supabase stop`.
- [ ] *(Later, when schema work starts)* link the CLI to the hosted project for migrations:
      `npx supabase login` then `npx supabase link --project-ref <ref>`. Out of scope for
      this deploy (no migrations yet), noted for continuity.

---

## Phase 0 — Pre-flight (read-only)  ☐

- [ ] Confirm `node -v` matches `.nvmrc` (v22.14.0) and `npm ci` is clean.
- [ ] Confirm versions (already verified): `astro ^6.3.1`, `@astrojs/cloudflare ^13.5.0`,
      `wrangler ^4.90.0`, `@supabase/ssr ^0.10.3`.
- [ ] Confirm you have the real Supabase project URL + anon key to hand (or a local
      `npx supabase start` instance) for `.dev.vars`.

## Phase 1 — Config hardening (code edits)  ☐

- [ ] **`astro.config.mjs`** — set `imageService: 'compile'` in the `cloudflare({...})`
      adapter options. Prevents the default `cloudflare-binding` (billable Cloudflare
      Images). Photos are user-supplied; no transforms needed.
- [ ] **`wrangler.jsonc`** — change `"name": "10x-astro-starter"` → `"name": "gaming-library"`.
      This sets the production URL. Do **not** touch `main`, `compatibility_date`,
      `compatibility_flags`, or `assets` — they're already correct.
- [ ] **`supabase/config.toml`** *(optional, local-only)* — `project_id` → `gaming-library`
      for naming consistency of the local Docker stack. Skip if you don't want to restart
      the local Supabase containers.
- [ ] **Create `.dev.vars.example`** (committed template):
      ```
      SUPABASE_URL=
      SUPABASE_KEY=
      ```
- [ ] **Create `.dev.vars`** (gitignored — already in `.gitignore` line 32) with the real
      values for local `wrangler dev`.
- [ ] Sanity: `npm run lint` + `npm run build` stay green after edits.

## Phase 2 — Validate on the REAL runtime (workerd)  ☐

> infrastructure.md's #1 risk: code works in `astro dev` (Node) but breaks on workerd.
> Do NOT trust `astro dev` for auth/runtime behavior.

- [ ] `npx astro build`
- [ ] `npx wrangler dev` (serves the built Worker on workerd locally, reading `.dev.vars`).
- [ ] Smoke-test the **Supabase `@supabase/ssr` cookie/session path** end-to-end on workerd
      (infrastructure.md risk #2): sign-up → confirm-email flow, sign-in, hit a
      `PROTECTED_ROUTES` page (e.g. `/dashboard`), sign-out. Cookies must persist.
- [ ] If anything breaks here that worked in `astro dev`, it's a `nodejs_compat` polyfill
      gap — fix before deploying, not after.

## Phase 3 — Authenticate & set production secrets  ☐

- [ ] **Interactive login** (human-run, one-time): type `! npx wrangler login` in this
      session — opens the OAuth browser flow.
- [ ] Set runtime secrets on the Worker (write-only, not readable back):
      - [ ] `npx wrangler secret put SUPABASE_URL`
      - [ ] `npx wrangler secret put SUPABASE_KEY`
- [ ] Verify: `npx wrangler secret list` shows both. (These persist on the Worker and are
      reused by BOTH manual deploys and Workers Builds — set once.)

## Phase 4 — First production deploy (manual)  ☐

- [ ] `npx astro build && npx wrangler deploy` — creates the `gaming-library` Worker.
- [ ] Verify live: open `https://gaming-library.<subdomain>.workers.dev`, run the same
      auth smoke-test from Phase 2 against production.
- [ ] `npx wrangler tail` — watch live logs while exercising the app; confirm no runtime
      errors (esp. around Supabase auth).
- [ ] `npx wrangler deployments list` — confirm the deployed version.

## Phase 5 — Auto-deploy via Cloudflare Workers Builds (git integration)  ☐

> Dashboard git connection is a **human gate** (account/repo auth) — agent can't do it.

- [ ] In Cloudflare dashboard → **Workers & Pages → `gaming-library` → Settings → Builds**:
      connect the GitHub repo (authorize the Cloudflare GitHub app).
- [ ] Set **Production branch = `main`** (the actual branch — note your "master" wording;
      the repo branch is `main`).
- [ ] Build settings:
      - Build command: `npm run build`
      - Deploy command: `npx wrangler deploy` (default for production branch)
      - Non-production branches auto-use `npx wrangler versions upload` → preview URLs.
- [ ] Secrets already set in Phase 3 persist on the Worker — no re-entry needed for runtime.
      (If the build itself ever needs them, add as Build env vars in dashboard.)
- [ ] **Fix `.github/workflows/ci.yml`**: change the `push`/`pull_request` trigger from
      `master` → `main` so the lint+build CI actually runs (it's currently dead). This is
      independent of Workers Builds (CI = quality gate; Workers Builds = deploy).
- [ ] Test the loop: push a trivial commit to `main` → confirm Workers Builds triggers and
      the new version goes live.

## Phase 6 — Rollback & ops readiness (document, don't execute)  ☐

- [ ] Confirm one-command revert works conceptually: `npx wrangler rollback` (reverts to the
      immediately previous version in seconds). **Caveat:** rolls back *code only* — any
      forward Supabase schema migration must be reversed manually.
- [ ] Record the **human-only / by-hand** boundary (infrastructure.md operational story):
      rotating Supabase/OpenRouter keys, dropping/altering production Postgres, any
      Cloudflare billing/plan change. Agent may run `deploy`/`versions upload`/`tail`/
      `rollback` unattended.
- [ ] Note `compatibility_date` is load-bearing — change it deliberately + re-test, never
      incidentally (infrastructure.md unknown-unknowns).

---

## Deferred (out of scope for this deploy)

- **OpenRouter AI-vision secret plumbing** — add `OPENROUTER_API_KEY` to
  `astro.config.mjs` `env.schema`, `.env.example`, `.dev.vars(.example)`, and as a Worker
  secret **when the vision feature is actually built**, not now.
- Supabase migrations are empty (`schema_paths = []`) — version the schema when real tables
  land; out of scope for the deploy mechanics.

## Files to modify

| File | Change |
|---|---|
| `astro.config.mjs` | Add `imageService: 'compile'` to `cloudflare()` options |
| `wrangler.jsonc` | `name` → `gaming-library` |
| `.dev.vars.example` | **New** — committed template |
| `.dev.vars` | **New** — local, gitignored, real values |
| `.github/workflows/ci.yml` | Trigger `master` → `main` |
| `supabase/config.toml` | *(optional)* `project_id` → `gaming-library` |

## Verification (end-to-end)

1. `npm run lint && npm run build` green after Phase 1 edits.
2. `npx wrangler dev` → full auth cycle (signup/signin/protected/signout) works **on
   workerd**, cookies persist.
3. `npx wrangler deploy` → live URL serves the app; auth cycle passes in production;
   `wrangler tail` shows no errors.
4. Push to `main` → Cloudflare Workers Builds auto-deploys a new version; `wrangler
   deployments list` shows it.
5. `npx wrangler rollback` available as the one-command revert (verify it lists a prior
   version to revert to).
