---
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
---

## Why this stack

A solo collector shipping a 3-week, after-hours, web/SaaS MVP with email+password auth, a personal Postgres-backed library, photo capture from a mobile browser, and a deterministic recommender needs a battle-tested, agent-friendly starter that bundles auth + database + storage + edge deploy out of the box. The 10x Astro Starter is the recommended default for `(web, js)`, clears all four agent-friendly gates (TypeScript + Zod for types, strong conventions, popular in JS training data, well documented), and ships Supabase for auth/Postgres/photo storage plus Cloudflare for low-cost edge deploy — three pre-wired concerns the budget can't afford to assemble by hand. `has_ai` is true because the photo-identification feature (FR-005) calls an external vision provider; that call lives in an Astro server route. If edge request-time limits ever bite the vision call, the path is to a non-edge worker rather than a stack change. Bootstrapper confidence is first-class — expect mostly-smooth scaffolding with occasional manual steps.
