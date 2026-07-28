# Rules for AI

This file provides guidance to AI Agent when working with code in this repository.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run preview` — preview production build
- `npm run test:e2e` — Playwright browser tests (starts the dev server itself)
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (includes prettier-plugin-astro + prettier-plugin-tailwindcss)

Pre-commit hooks: husky runs `lint-staged` then `astro check` (typecheck). lint-staged runs `eslint --fix` + `vitest related --run --passWithNoTests` on `*.{ts,tsx,astro}` (scoped tests on the staged files) and `prettier --write` on `*.{json,css,md}`.

## Worktrees

Create worktrees with `scripts/new-worktree.ps1 -Name <slug> [-Branch <branch>] [-Base main]`, **not** bare `git worktree add`. The wrapper also copies the gitignored files a fresh checkout needs but git won't carry over: `.dev.vars`, `.env` (server secrets), and `.claude/settings.local.json` (permission allowlist). Branch defaults to `plan/<slug>`; worktree dir is `../GamingLibrary-<slug>`. If a new local-only gitignored file appears, add it to the `$PropagateFiles` array in the script.

## Architecture

**Astro 6 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components. Deployed to Cloudflare Workers.

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All pages are server-rendered by default. API routes must export `const prerender = false`.

### Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Protected page example: `src/pages/library/index.astro`

### Key conventions

- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Astro components** for static content/layout; **React components** only when interactivity is needed.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names. Do not concatenate class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`. Always enable RLS on new tables with granular per-operation, per-role policies.
- **React**: no Next.js directives ("use client" etc.). Extract hooks to `src/components/hooks/`.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.

### Environment

- Node.js v22.14.0 (see `.nvmrc`)
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` (copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev)
- Local Supabase: `npx supabase start` (requires Docker)
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npm run deploy` (requires Cloudflare account + `wrangler` auth). This wraps
  `scripts/deploy-worker.mjs` — build → `sentry-cli sourcemaps inject dist/server` → `wrangler deploy`
  → upload those maps. Do **not** deploy with a bare `npx wrangler deploy`: it ships fine, but the
  debug-ID injection is skipped and production stack traces stay minified. Sentry credentials are
  optional (see `.env.example`); without them the script deploys and just skips the upload.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs **two blocking jobs in parallel** on every push and
PR to `main`:

- **`ci`** — `npm test` (first, and the fastest gate), `npm run lint`, `npm run typecheck`,
  `npm run build`. Only the build step needs the `SUPABASE_URL` / `SUPABASE_KEY` repository secrets.
- **`e2e`** — boots a local Supabase stack, seeds the e2e user (`node scripts/seed-e2e-user.mjs`;
  `npm run seed:e2e-user` is the same script for local use), writes
  `.dev.vars` from **that container's own keys**, then runs `npm run test:db` (pgTAP/RLS) and
  `npm run test:e2e` (Playwright). It consumes **no** repository secrets: the stub key and the e2e
  password are generated per run, and the account dies with the container. On failure it uploads
  `playwright-report/` + `test-results/` as an artifact.

Do not hand the server-side values to a step as `env:` — wrangler consults `process.env` only when
`.dev.vars` is absent, so that fails silently in the app's favour. See the header comment in
`ci.yml` and `context/foundation/test-plan.md` §5.

A separate workflow (`.github/workflows/migrate.yml`) applies `supabase/migrations/**` to production
on push to `main`.

## E2E tests

Playwright specs live in `e2e/`. **Read `e2e/RULES.md` before writing or generating one** —
it carries the locator/isolation/waiting rules, the real-vs-mocked split, and the bar a risk
must clear to earn a spec at this layer. Model new specs on `e2e/seed.spec.ts`; a generator
reproduces whatever the seed shows.

Running them locally needs `npx supabase start` (the specs hit real Supabase) and
`E2E_EMAIL` / `E2E_PASSWORD` in `.env` — a dedicated confirmed user in the local instance,
never a production account. `e2e/auth.setup.ts` signs in once through the real
`/api/auth/signin` route and parks the session in `e2e/.auth/user.json`; no spec logs in
through the UI. Note the Astro CSRF guard: an API-side POST needs an explicit `Origin`
header or it 403s.

E2E is the most expensive layer here — budget roughly one test per risk from
`context/foundation/test-plan.md`, never a test per page or per button.

## Mutation testing

Repo uses Stryker for selective mutation testing on risk-critical modules.
Run it only for code covered by the current change or a risk from test-plan.md,
prefer narrowed scope with --mutate "path/to/file.ts:start-end", and do not chase
100% mutation score. Survived mutants should be reviewed one by one: add an
assertion only when the mutant represents a user-visible or business-relevant bug.
