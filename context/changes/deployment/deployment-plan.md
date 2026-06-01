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

## ✅ Execution log — 2026-06-01

**Live at <https://gaming-library.lordtomar.workers.dev>** (account `lordtomar@gmail.com`,
ID `559686cd6f01b5f84e5620503b6259be`). First deploy version
`5ee2cb54-e5fa-415e-b38c-572d2ac6b34b`.

Done by the agent:

- **Phase 0** — Node v22.19.0, deps at expected versions, build clean.
- **Phase 1** — config edits (`imageService:'compile'`, `name:'gaming-library'`,
  `ci.yml`→`main`) were already present; **created `.dev.vars.example`** committed template.
  Build confirms compile-time image optimization is active.
- **Phase 2** — `wrangler dev` booted on workerd; `/`→200, `/auth/signin`→200,
  `/dashboard`→302→`/auth/signin`. No `nodejs_compat` polyfill gaps (risk #1 cleared).
- **Phase 3** — already logged in (`lordtomar@gmail.com`); set `SUPABASE_URL` + `SUPABASE_KEY`
  Worker secrets (hosted `*.supabase.co` project + `sb_publishable_…` key, piped from
  `.dev.vars`). `wrangler secret list` confirms both.
- **Phase 4** — `wrangler deploy` succeeded. Prod smoke test: `/`→200, signin/signup→200,
  `/dashboard`→302→signin (clean 302, not 500 ⇒ Supabase SSR client initializes on workerd
  with real secrets). The `SESSION` KV namespace (`gaming-library-session`) was
  **auto-provisioned by wrangler** during deploy — the latent KV-binding gap resolved itself.
- **Phase 6** — `deployments list` shows multiple versions ⇒ `wrangler rollback` has a prior
  version to revert to.
- **Phase 5 (auto-deploy) — VERIFIED 2026-06-02.** Pushed commit `e5fd067` to `main`; CI
  passed (success, 1m17s) and Cloudflare Workers Builds independently auto-deployed version
  `879a5008-8ba3-4236-b6cc-ec017d870075` ~1 min after the push (replacing the manual
  `5ee2cb54`). Post-deploy prod smoke test green (`/`→200, signin→200, `/dashboard`→302).
  Workers Builds is connected; every push to `main` now auto-deploys.
- **Full interactive auth cycle — VERIFIED 2026-06-02 by the user** against
  <https://gaming-library.lordtomar.workers.dev>: account creation → email confirmation →
  sign-in all working in production. This also confirms the Supabase Site URL / redirect
  config is correctly set (confirmation links resolve back to the Worker URL).

Remaining — **human-only (optional, non-blocking)**:

- **Workers Paid plan (~$5/mo)** — deploy + auto-deploy succeeded on the current plan;
  free-tier 10ms CPU cap can throttle SSR under load (billing = human decision).

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
- [x] **Authenticate wrangler** — already logged in via OAuth token.
- [x] **Verify**: `npx wrangler whoami` → `lordtomar@gmail.com`, account ID
      `559686cd6f01b5f84e5620503b6259be`.
- [x] **`workers.dev` subdomain** = `lordtomar` → live URL
      `https://gaming-library.lordtomar.workers.dev`.

### B. Supabase — hosted project (production)

- [x] 🧑 **Create a Supabase account + project** — done; hosted project provisioned
      (`unsjdxapoytirggkpyvn.supabase.co`).
- [x] 🧑 **Copy the two values the app needs** from Project → **Settings → API Keys**:
      - **Project URL** → `SUPABASE_URL` (e.g. `https://<ref>.supabase.co`)
      - **Publishable key** (`sb_publishable_…`) → `SUPABASE_KEY`. This replaces the legacy
        `anon` key; the legacy anon JWT still works through end of 2026 if you see that
        instead. **Use the publishable/anon key, NOT the `secret`/`service_role` key** —
        `src/lib/supabase.ts` uses `@supabase/ssr` with the client-safe key; the secret key
        must never reach the browser/SSR client.
- [x] These two values became the **production Worker secrets** (Phase 3).
- [x] 🧑 **Confirm-email flow** — VERIFIED 2026-06-02: "Confirm email" enabled and Site URL /
      redirect URLs set to the Worker URL; full signup → email-confirm → signin works in
      production.

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

## Phase 0 — Pre-flight (read-only)  ✅

- [x] Confirm `node -v` matches `.nvmrc` (v22.14.0) and `npm ci` is clean. *(Node v22.19.0 —
      same major; build clean.)*
- [x] Confirm versions (already verified): `astro ^6.3.1`, `@astrojs/cloudflare ^13.5.0`,
      `wrangler ^4.90.0`, `@supabase/ssr ^0.10.3`.
- [x] Confirm you have the real Supabase project URL + anon key to hand (or a local
      `npx supabase start` instance) for `.dev.vars`. *(Hosted `*.supabase.co` +
      `sb_publishable_…` key present in `.dev.vars`.)*

## Phase 1 — Config hardening (code edits)  ✅

- [x] **`astro.config.mjs`** — `imageService: 'compile'` set (build confirms compile-time
      image optimization active).
- [x] **`wrangler.jsonc`** — `"name": "gaming-library"` set.
- [ ] **`supabase/config.toml`** *(optional, local-only, skipped)* — `project_id` →
      `gaming-library`. Skipped to avoid restarting local containers.
- [x] **Create `.dev.vars.example`** (committed template):
      ```
      SUPABASE_URL=
      SUPABASE_KEY=
      ```
- [x] **`.dev.vars`** (gitignored) present with real values for local `wrangler dev`.
- [x] Sanity: `npm run lint` + `npm run build` green after edits.

## Phase 2 — Validate on the REAL runtime (workerd)  ✅

> infrastructure.md's #1 risk: code works in `astro dev` (Node) but breaks on workerd.
> Do NOT trust `astro dev` for auth/runtime behavior.

- [x] `npx astro build`
- [x] `npx wrangler dev` (served the built Worker on workerd locally, reading `.dev.vars`).
- [x] Smoke-test the **Supabase `@supabase/ssr` cookie/session path** (infrastructure.md
      risk #2): HTTP surface validated headlessly on workerd (`/`→200, `/auth/signin`→200,
      `/dashboard`→302→signin). **Full interactive cycle (signup → confirm-email → signin)
      VERIFIED by the user 2026-06-02 against production** — all working.
- [x] No `nodejs_compat` polyfill gap — clean boot on workerd, no runtime errors in dev log.

## Phase 3 — Authenticate & set production secrets  ✅

- [x] **Login** — already authenticated as `lordtomar@gmail.com` (OAuth token).
- [x] Set runtime secrets on the Worker (write-only, not readable back):
      - [x] `SUPABASE_URL` ✨ uploaded
      - [x] `SUPABASE_KEY` ✨ uploaded
- [x] Verify: `npx wrangler secret list` shows both.

## Phase 4 — First production deploy (manual)  ✅

- [x] `npx wrangler deploy` — created the `gaming-library` Worker. `SESSION` KV namespace
      (`gaming-library-session`) auto-provisioned during deploy.
- [x] Verify live: <https://gaming-library.lordtomar.workers.dev> — prod smoke test
      `/`→200, signin/signup→200, `/dashboard`→302→signin (clean 302, not 500).
- [~] `npx wrangler tail` — tail session didn't connect before requests fired; HTTP-level
      smoke test (clean 302 not 500) confirms no runtime crash around Supabase auth.
- [x] `npx wrangler deployments list` — version `5ee2cb54-e5fa-415e-b38c-572d2ac6b34b` + 2
      secret-change versions confirmed.

## Phase 5 — Auto-deploy via Cloudflare Workers Builds (git integration)  ✅

> Dashboard git connection is a **human gate** (account/repo auth) — agent can't do it.

- [x] In Cloudflare dashboard → **Workers & Pages → `gaming-library` → Settings → Builds**:
      GitHub repo connected (auto-deploy confirmed firing on push).
- [x] **Production branch = `main`** — confirmed (push to `main` triggered the deploy).
- [x] Build settings (`npm run build` / `npx wrangler deploy`) — working as evidenced by the
      successful auto-deploy.
- [x] Secrets from Phase 3 persisted on the Worker — auto-deployed version served auth
      correctly with no re-entry needed.
- [x] **Fix `.github/workflows/ci.yml`**: trigger already on `main` (push + pull_request).
      CI runs independently of Workers Builds.
- [x] **Test the loop — VERIFIED 2026-06-02**: pushed `e5fd067` to `main` → Workers Builds
      auto-deployed `879a5008-8ba3-4236-b6cc-ec017d870075` ~1 min later; live + smoke-tested.
      CI passed in parallel (success, 1m17s).

## Phase 6 — Rollback & ops readiness (document, don't execute)  ✅

- [x] Confirm one-command revert works conceptually: `npx wrangler rollback` — multiple prior
      versions exist in `deployments list`, so a revert target is available. **Caveat:** rolls
      back *code only* — any forward Supabase schema migration must be reversed manually.
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
