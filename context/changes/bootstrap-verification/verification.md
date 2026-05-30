---
bootstrapped_at: 2026-05-28T19:43:13Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: gaming-library
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`.

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: gaming-library
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

A solo collector shipping a 3-week, after-hours, web/SaaS MVP with email+password auth, a personal Postgres-backed library, photo capture from a mobile browser, and a deterministic recommender needs a battle-tested, agent-friendly starter that bundles auth + database + storage + edge deploy out of the box. The 10x Astro Starter is the recommended default for `(web, js)`, clears all four agent-friendly gates (TypeScript + Zod for types, strong conventions, popular in JS training data, well documented), and ships Supabase for auth/Postgres/photo storage plus Cloudflare for low-cost edge deploy — three pre-wired concerns the budget can't afford to assemble by hand. `has_ai` is true because the photo-identification feature (FR-005) calls an external vision provider; that call lives in an Astro server route. If edge request-time limits ever bite the vision call, the path is to a non-edge worker rather than a stack change. Bootstrapper confidence is first-class — expect mostly-smooth scaffolding with occasional manual steps.

## Pre-scaffold verification

| Signal      | Value                                                              | Severity | Notes                                                      |
| ----------- | ----------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| npm package | not run                                                           | n/a      | cmd_template starts with `git clone` — no npm CLI to probe |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17T10:33:39Z | fresh    | from card.docs_url; within 3 months of 2026-05-28          |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 18 top-level items moved up (`.github/`, `.husky/`, `.vscode/`, `node_modules/`, `public/`, `src/`, `supabase/`, `.env.example`, `.nvmrc`, `.prettierrc.json`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `package-lock.json`, `package.json`, `README.md`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: CLAUDE.md (existing 10xDevs lesson rules kept; starter's copy moved to `CLAUDE.md.scaffold`)
**.gitignore handling**: append-merged (cwd line `.claude/settings.local.json` kept; 10x-astro-starter lines de-duped and appended under a `# from 10x-astro-starter` separator)
**context/ handling**: no `context/` in scaffold — nothing dropped; cwd `context/` preserved verbatim
**.git handling**: cloned `.bootstrap-scaffold/.git/` deleted before move-up (upstream history not leaked); cwd `.git/` untouched
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW (10 total)
**Direct vs transitive**: 0 CRITICAL / 0 HIGH / 2 MODERATE / 0 LOW direct of total 0 / 1 / 9 / 0. The single HIGH is transitive. Direct findings: `@astrojs/check`, `wrangler` (both moderate).
**Dependencies audited**: 895 total (449 prod, 316 dev, 131 optional)
**Audit exit code**: 1 (informational — npm exits non-zero when advisories exist; not a halt condition)

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (range 5.6.3 – 5.8.0, transitive) — GHSA-77vg-94rm-hx3p "Svelte devalue: DoS via sparse array deserialization", CWE-770, CVSS 7.5. Fix available.

#### MODERATE findings

- **@astrojs/check** (>=0.9.3, **direct**) — via `@astrojs/language-server`. Fix available: downgrade to `@astrojs/check@0.9.2` (semver-major).
- **@astrojs/language-server** (>=2.14.0, transitive) — via `volar-service-yaml`. Fix via `@astrojs/check@0.9.2`.
- **@cloudflare/vite-plugin** (transitive) — via `miniflare`, `wrangler`, `ws`. Fix available.
- **miniflare** (transitive) — via `ws`. Fix available.
- **volar-service-yaml** (<=0.0.70, transitive) — via `yaml-language-server`. Fix via `@astrojs/check@0.9.2`.
- **wrangler** (**direct**) — via `miniflare`. Fix available.
- **ws** (8.0.0 – 8.20.0, transitive) — GHSA-58qx-3vcg-4xpx "ws: Uninitialized memory disclosure", CWE-908, CVSS 4.4. Fix available.
- **yaml** (2.0.0 – 2.8.2, transitive) — GHSA-48c2-rrv3-qjmp "Stack Overflow via deeply nested YAML collections", CWE-674, CVSS 4.3. Fix via `@astrojs/check@0.9.2`.
- **yaml-language-server** (transitive) — via `yaml`. Fix via `@astrojs/check@0.9.2`.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                  |
| ----------------------- | ---------------------- |
| bootstrapper_confidence | first-class            |
| quality_override        | false                  |
| path_taken              | standard               |
| self_check_answers      | null                   |
| team_size               | solo                   |
| deployment_target       | cloudflare-pages       |
| ci_provider             | github-actions         |
| ci_default_flow         | auto-deploy-on-merge   |
| has_auth                | true                   |
| has_payments            | false                  |
| has_realtime            | false                  |
| has_ai                  | true                   |
| has_background_jobs     | false                  |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` is not needed — this directory is already a git repo; the cloned starter history was deliberately discarded.
- Review `CLAUDE.md.scaffold` (the starter's project guidance) against your existing `CLAUDE.md` (10xDevs lesson rules) and decide how to combine them.
- Copy `.env.example` to `.env` (Node) or `.dev.vars` (Cloudflare local dev) and fill in `SUPABASE_URL` / `SUPABASE_KEY`.
- Address audit findings per your project's risk tolerance — the full breakdown is above. The 1 HIGH (`devalue`) is transitive with a fix available.
