---
project: Gaming Library
researched_at: 2026-06-01
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (SSR)
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The project already ships `@astrojs/cloudflare`, so Workers is the zero-migration path — no adapter swap, no Dockerfile, no container ops. It scores a clean sweep across all five agent-friendly criteria (full `wrangler` CLI, fully managed serverless, `llms.txt` + per-page markdown docs, deterministic deploy/rollback API, and 13+ GA MCP servers), which matters for a solo, after-hours, agent-driven build. The single real caveat — that workerd is a *different runtime* than the Node dev server — is cheaply mitigated (`wrangler dev` for runtime fidelity) and was preferred by the developer over swapping to a Node-serverless alternative. External services (Supabase for DB/auth/storage, OpenRouter for AI vision) are plain outbound HTTP from a Worker, so co-location was never a factor.

## Platform Comparison

Hard filters first: no persistent connections are required (interview Q1 = No), so no serverless platform was dropped; every candidate supports Astro 6 SSR (Cloudflare natively, the rest via `@astrojs/node`/`@astrojs/vercel`/`@astrojs/netlify`). Nothing was eliminated by filter — the decision is on score and fit.

Interview weights applied: cost vs DX equal (no cost penalty), no platform familiarity (no tie-break), single-region (edge advantage neutralized — neither helps nor hurts), external services only (co-located DB on Railway/Render/Fly is dead weight, not a plus).

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP/Integration |
|---|---|---|---|---|---|
| **Cloudflare** | Pass | Pass | Pass | Pass | Pass |
| **Vercel** | Pass | Pass | Pass | Pass | Partial |
| **Netlify** | Pass | Pass | Partial | Pass | Pass |
| **Render** | Pass | Pass | Partial | Pass | Pass |
| **Fly.io** | Pass | Partial | Pass | Pass | Pass |
| **Railway** | Partial | Pass | Pass | Partial | Partial |

**Cloudflare** — `wrangler deploy`/`rollback`/`tail` cover the full ops loop; fully serverless with no Dockerfile; docs published as `llms.txt` and per-page `.md`; 13+ GA remote MCP servers (Workers Bindings, Logs/Observability, full API). Only soft spots are runtime-gap and config traps (see cross-check), not criterion failures.

**Vercel** — Node serverless via `@astrojs/vercel` (GA); excellent `vercel` CLI and `llms.txt`+`llms-full` docs; 60s function timeout (300s with Fluid compute), comfortable for the ~10s vision call. Dinged to Partial on MCP (beta, read-only as of 2026-06-01). Note: Hobby tier is non-commercial only — a revenue app needs Pro (~$20/mo).

**Netlify** — Node Functions via `@astrojs/netlify` (GA); fixed 60s sync-function timeout (covers the vision call); official full-management MCP server. Dinged to Partial on docs (HTML only, no published `llms.txt`). New credit-based pricing (since 2025-09-05): Free = 300 credits/mo hard-capped.

**Render** — Native Node Web Service via `@astrojs/node` (GA); CLI now GA plus deploy hooks + REST rollback API; official MCP server (GA) — but it *cannot* trigger deploys (read/inspect only). Docs Partial (HTML). Free tier spins down (30–60s cold start) → unusable for a user-facing MVP; cheapest always-on is Starter $7/mo.

**Fly.io** — Runs any container; Astro SSR via `@astrojs/node` in a Dockerfile *you own and maintain* → Managed = Partial. Strong `flyctl` (rollback = redeploy prior image), markdown docs on GitHub, official `fly mcp server`. Free tier removed; ~$2–3/mo always-on. Persistent-process strength is irrelevant here.

**Railway** — Railpack auto-build (no Dockerfile needed) but a 0.0.0.0-bind 502 trap; rollback is dashboard-only (CLI = Partial, deploy API = Partial); MCP is "a work in progress" (Partial). `.md`+`llms.txt` docs are good. Free tier removed; ~$5–8/mo always-on.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on zero migration cost (already the installed adapter), a clean five-of-five criteria sweep, the strongest agent ecosystem (wrangler + 13 GA MCP servers + machine-readable docs), and $0–5/mo at this scale. For a solo agent-driven MVP, "the agent can run the entire ops loop unattended" is the load-bearing property, and Cloudflare maximizes it.

#### 2. Vercel

The cleanest fallback if Workers' CPU/timeout model ever bites the vision proxy: Node serverless has *no* dev-prod runtime gap, 60s (→300s Fluid) function budget, and top-tier agent docs. Costs only a one-line adapter swap (`@astrojs/cloudflare` → `@astrojs/vercel`). Gaps vs. the leader: MCP is beta/read-only, and the Hobby tier forbids commercial use (Pro $20/mo if this ever earns money).

#### 3. Netlify

Also Node serverless with a comfortable fixed 60s timeout and a *full-management* MCP server (can create/deploy/configure, unlike Render's read-only one). Trails Vercel only on agent-readable docs (HTML, no `llms.txt`) and is otherwise an equivalent serverless fallback. Same one-line adapter swap.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The 10ms free-tier CPU cap forces the paid plan from day one.** SSR rendering and JSON parsing burn CPU; the free 10ms/invocation ceiling makes the "free MVP" story false — you're on Workers Paid ($5/mo) immediately. Cost is trivial; the surprise is the failure mode if you assume free.
2. **Workers bills CPU, not wall-clock — but render-time CPU is real.** The awaited OpenRouter fetch is I/O wait (not CPU, safe), but rendering an SSR page, parsing a large vision response, and scoring 50+ titles in the deterministic recommender *are* CPU, capped at 30s default (raisable to 5min).
3. **`nodejs_compat` is mandatory and leaky.** Supabase's SSR client and any Node-targeting dependency need the compat flag, and not every Node API is polyfilled. Code that works in `astro dev` (Node) can throw on workerd — a bug class that only appears after deploy.
4. **Image handling defaults to a Cloudflare binding.** The adapter's default `imageService: 'cloudflare-binding'` silently couples you to billable Cloudflare Images. For a photo-heavy app this is a trap — set `'compile'`/`'passthrough'` explicitly.
5. **`@astrojs/cloudflare` dropped Pages support.** The `tech-stack.md` hint says `cloudflare-pages`; that path is gone in the current adapter. Workers is the only path, with different `wrangler.jsonc` config (`main`, `assets.directory`, `compatibility_flags`).

### Pre-Mortem — How This Could Fail

The team picked Cloudflare because it was "already the adapter." They deployed on the free plan, and `astro dev` (full Node) hid everything. The first real bug surfaced only in production: the Supabase SSR auth helper hit an unpolyfilled Node API under `nodejs_compat`, and cookie-based sessions silently failed for some users — invisible locally, impossible to reproduce without deploying. Then the photo feature shipped, and the default `cloudflare-binding` image service started billing Cloudflare Images transforms nobody budgeted. Meanwhile the vision-proxy route — fine in testing — began hitting the 30s CPU ceiling when OpenRouter returned large payloads and JSON parse plus SSR render stacked up under load. Debugging meant `wrangler tail` against a runtime that behaves differently from the dev server, eroding the "agent operates it unattended" premise because every fix needed a deploy-to-test loop. The deeper mistake: treating "the adapter is installed" as "the runtime is validated." Workers is a *different runtime*, not just a deploy target — and that distinction was the whole iceberg.

### Unknown Unknowns

- **The dev server lies about the runtime.** `astro dev` runs on Node; production runs on workerd. `wrangler dev` gives runtime fidelity but isn't the default loop — the "works locally / breaks deployed" gap is wider on Cloudflare than on any Node platform here.
- **`compatibility_date` is load-bearing.** Workers behavior is pinned to a date string in config; bumping it can change behavior, leaving it stale can miss fixes. An invisible config axis Node platforms don't have.
- **Cloudflare's free MCP servers are *remote* (OAuth-connected), not local `npx` servers.** Great for live log/state reads, but they're hosted and scoped by OAuth — a token surface to manage.
- **Per-request subrequest cap (~50 on paid) and 6-simultaneous-outbound-connection limit.** Irrelevant at MVP, but if metadata enrichment ever fans out to multiple IGDB/OpenRouter calls per request, the ceiling exists and isn't obvious.
- **Supabase + Workers is well-trodden but not frictionless.** `@supabase/ssr` works, but cookie handling under `nodejs_compat` is the integration most likely to surprise — and it's the auth layer (FR-001/002/003, all must-have).

## Operational Story

- **Preview deploys**: `wrangler versions upload` publishes a non-production *preview* version with its own URL (no traffic) for review; `wrangler deploy` promotes to production. Branch/PR preview URLs come from connecting the repo via the Cloudflare dashboard's Workers Builds (CI-driven) — for this MVP, manual `wrangler versions upload` from a branch is the simpler agent-runnable path. Preview URLs are public unless protected by Cloudflare Access.
- **Secrets**: `SUPABASE_URL`, `SUPABASE_KEY`, and the OpenRouter key live as Workers Secrets — set with `wrangler secret put <NAME>` (encrypted, write-only after set; not readable back). Locally they live in `.dev.vars` (gitignored). For CI builds, store them as GitHub repository secrets and inject at deploy. Rotation = `wrangler secret put` again, then redeploy.
- **Rollback**: `wrangler rollback [version-id]` reverts to a prior version (defaults to the immediately previous one); time-to-revert is seconds. Caveat: rollback reverts *code only* — any Supabase schema migration applied forward does not roll back automatically; reverse migrations are a manual Supabase operation.
- **Approval**: an agent may run `wrangler deploy`, `wrangler versions upload`, `wrangler tail`, and `wrangler rollback` unattended. Human-only (panel-by-hand): rotating the Supabase service key or OpenRouter key, dropping/altering production Postgres in Supabase, and any Cloudflare billing/plan change. Destructive-by-hand is cheaper than cleanup-after-automated-mistake.
- **Logs**: `wrangler tail` streams live runtime logs (read-only); `wrangler deployments list` shows deploy history. For structured/queryable access, the Cloudflare Workers Logs/Observability MCP server (GA, remote/OAuth) lets the agent read logs and analytics as typed tool calls instead of parsing CLI output.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Code works in `astro dev` (Node) but breaks on workerd in prod | Pre-mortem / Unknown unknowns | M | H | Use `wrangler dev` for any route touching Supabase auth or the vision proxy *before* deploying; treat the Node dev server as untrustworthy for runtime behavior |
| Supabase `@supabase/ssr` cookie/session bug under `nodejs_compat` | Devil's advocate / Pre-mortem | M | H | Keep `compatibility_flags = ["nodejs_compat"]` set; smoke-test sign-in/out against a `wrangler dev` or deployed preview, not just local |
| Default `imageService: 'cloudflare-binding'` silently bills Cloudflare Images | Devil's advocate | M | M | Set `imageService: 'compile'` (or `'passthrough'`) in the adapter config explicitly; photos are user-supplied so transforms aren't needed |
| Vision/recommender route exceeds 30s CPU under load | Devil's advocate | L | M | Stay on Workers Paid (30s CPU default, raisable to 5min); keep heavy parsing minimal; I/O wait on OpenRouter doesn't count toward CPU |
| Assuming "free tier" — 10ms CPU cap makes free plan unusable for SSR + AI proxy | Devil's advocate / Research finding | H | L | Budget for Workers Paid ($5/mo) from day one; it's the real baseline |
| Following stale `cloudflare-pages` guidance from `tech-stack.md` hint | Devil's advocate / Research finding | M | M | Use the Workers path only; `wrangler.jsonc` needs `main: ./dist/_worker.js/index.js`, `assets.directory: ./dist`, `nodejs_compat`, and a `compatibility_date` |
| Stale or mis-bumped `compatibility_date` changes runtime behavior | Unknown unknowns | L | M | Pin a known-good `compatibility_date`; change it deliberately and re-test, never incidentally |
| Per-request subrequest / 6-outbound-connection limits if enrichment fans out | Unknown unknowns | L | L | Keep metadata enrichment to a small number of sequential calls per request at MVP; revisit if batching IGDB/OpenRouter |

## Getting Started

Validated against the current `@astrojs/cloudflare` Workers path (checked 2026-06-01) — **not** the legacy Pages flow referenced in the stack hint.

1. **Confirm config.** Ensure `wrangler.jsonc` has `main: "./dist/_worker.js/index.js"`, `assets: { directory: "./dist" }`, `compatibility_flags: ["nodejs_compat"]`, and a recent `compatibility_date`. In `astro.config.mjs`, set the adapter's `imageService` to `'compile'` to avoid the billable Cloudflare Images default.
2. **Authenticate wrangler.** `npx wrangler login` (one-time, interactive — run via the `! npx wrangler login` prompt in this session) or set a scoped `CLOUDFLARE_API_TOKEN` (Workers-only, single project, no DNS/billing).
3. **Set secrets.** `npx wrangler secret put SUPABASE_URL`, `... SUPABASE_KEY`, and your OpenRouter key. Keep local copies in `.dev.vars` (gitignored). Verify with `npx wrangler secret list`.
4. **Validate on the real runtime, then deploy.** Build and run `npx wrangler dev` to exercise sign-in and the vision route on workerd; once green, `npx astro build && npx wrangler deploy`.
5. **Verify live.** `npx wrangler tail` to watch runtime logs, `npx wrangler deployments list` to confirm the version. Keep `npx wrangler rollback` ready as the one-command revert.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (the existing GitHub Actions lint+build workflow aside; deploy automation is not designed here)
- Production-scale architecture (multi-region, HA, DR)
