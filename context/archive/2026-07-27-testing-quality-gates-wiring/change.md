---
change_id: testing-quality-gates-wiring
title: Wire the test, e2e, and db-policy suites into CI as enforced gates
status: archived
created: 2026-07-27
updated: 2026-07-28
archived_at: 2026-07-28T17:55:56Z
---

## Notes

Open a change folder for rollout Phase 5 of context/foundation/test-plan.md: "Quality-gates wiring".
Risks covered: cross-cutting (the gate layer that keeps Phases 1-4's suites enforced rather than merely present).
Test types planned: gates (CI wiring; no new test authoring).

Risk response intent (from test-plan.md §5, settled by earlier phases so this one inherits rather than rediscovers):
- `npm test` gate — highest priority, first step. `.github/workflows/ci.yml` today runs lint + build only (triggers on main, push + PR). Until this gate lands, a PR can disarm or invert the e2e determinism seam guard (`src/lib/services/vision.ts` + `src/lib/services/vision.test.ts`, the only enforcement anywhere that the production bypass path stays fail-closed) with green CI. The husky `vitest related --run` hook mitigates locally but is skippable.
- e2e gate — required after Phase 4, now due. Contract already settled: the suite needs no outbound network and no OPENROUTER_API_KEY. It does need (1) a Supabase service container with a confirmed E2E_EMAIL/E2E_PASSWORD user seeded, (2) `npx playwright install --with-deps chromium`, (3) CI writing `.dev.vars` from repository secrets before the dev server starts, carrying SUPABASE_URL, SUPABASE_KEY, E2E_VISION_STUB_KEY — plain env vars are not enough (wrangler reads `.dev.vars` first and consults process.env only when that file is absent; Astro binds secrets once at worker init). The same E2E_VISION_STUB_KEY value must also reach the runner's `.env`/process.env, where the specs read it to send the header. One mechanism for local and CI both.
- db-policy (pgTAP) gate — enforced locally today via `npm run test:db`; its CI wiring is also Phase 5's, but it needs a Supabase service container. Do not let it absorb the phase ahead of `npm test`.
