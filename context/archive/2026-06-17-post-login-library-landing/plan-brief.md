# Post-Login Library Landing — Plan Brief

> Full plan: `context/changes/post-login-library-landing/plan.md`

## What & Why

After signing in, the user currently traverses `/` (a generic "10x Astro Starter" marketing page) → `/dashboard` → `/library` before reaching the app. This plan lands them on `/library` in one step, gives every signed-in page a persistent header (back-to-library + sign-out), retires the redundant `/dashboard` hop, and replaces the starter homepage with a Gaming Library–branded landing page. Roadmap slice **S-08** (PRD US-04: browsing the library is the primary post-login action).

## Starting Point

Login redirects to `/` (`signin.ts:19`), which renders the starter `Welcome.astro`. The shared `Topbar` (email + "Dashboard" link + sign-out) is rendered **only** on the homepage; `/library` and `/play-next` have no header and no sign-out at all. Middleware protects `/dashboard`, `/library`, `/play-next` but does nothing for authenticated visitors hitting `/`.

## Desired End State

Signing in lands directly on `/library`; a logged-in visit to `/` redirects there too. `/library` and `/play-next` carry a persistent header with email, a "Library" link, and sign-out. `/dashboard` is gone (404). Logged-out visitors to `/` see a Gaming Library–branded landing: product name + tagline, Sign In / Sign Up CTAs, 2-3 feature highlights, and a minimal footer, in a fresh gaming aesthetic.

## Key Decisions Made

| Decision                         | Choice                                          | Why (1 sentence)                                                              | Source |
| -------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| How login reaches the library    | Redirect login → `/library`                     | Zero hops; the library is the post-login home (US-04).                        | Plan   |
| Persistent nav / sign-out        | Shared `Topbar` on all authed pages             | One reused component; the "persistent way back" the roadmap requires.         | Plan   |
| Fate of `/dashboard`             | Delete the route entirely                       | Cleanest — no orphaned surface once login no longer lands there.              | Plan   |
| Logged-in user hitting `/`       | Middleware redirects `/` → `/library`           | Guarantees no logged-in user ever sees the marketing/landing page.            | Plan   |
| Landing page purpose             | Branded product hero for Gaming Library         | Replaces generic starter copy with real product identity.                     | Plan   |
| Landing visual style             | Fresh gaming-themed redesign                    | User wants a project-specific look, distinct from the starter cosmic theme.   | Plan   |
| Landing content                  | Name+tagline, Sign In/Up CTAs, 2-3 highlights, footer | Orients first-time visitors and gives the functional entry point.       | Plan   |

## Scope

**In scope:** login redirect; logged-in `/` redirect; shared header on `/library` + `/play-next`; delete `/dashboard` + clean references; rewrite the homepage as a Gaming Library landing.

**Out of scope:** auth logic / signin-signup pages; the signed-in cosmic theme and page bodies; a dashboard/stats home; multi-section marketing; updating the archived deployment smoke-test doc.

## Architecture / Approach

Pure front-end navigation + presentation change on the Astro 6 SSR app — no data model, API contract, or migration. Phase 1 edits `signin.ts` (redirect), `middleware.ts` (logged-in `/` branch + drop `/dashboard` from `PROTECTED_ROUTES`), `Topbar.astro` (retitle link), and slots `Topbar` into the two authed pages, then deletes `dashboard.astro` and updates `CLAUDE.md` / `README.md`. Phase 2 rewrites the homepage landing component. Logged-in users never see the landing (redirected away), so the landing's fresh theme can diverge from the cosmic app theme without inconsistency.

## Phases at a Glance

| Phase                                          | What it delivers                                            | Key risk                                                              |
| ---------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Direct-to-library navigation & retire dashboard | One-step login to library; persistent header; `/dashboard` removed | Missing a `/dashboard` reference; header placement on existing page layouts |
| 2. Gaming Library landing page                 | Branded landing for unauthenticated visitors                | Visual quality / responsiveness of a from-scratch gaming theme       |

**Prerequisites:** S-01 (done) — a working `/library`. No new dependencies or access needed.
**Estimated effort:** ~1 session across 2 phases; Phase 1 is small/mechanical, Phase 2 is design-led.

## Open Risks & Assumptions

- Deleting `/dashboard` turns its old `302→signin` into a `404`; the archived deployment smoke-test doc still probes it (out of scope to update — noted in Migration Notes).
- The fresh gaming-themed landing intentionally diverges from the signed-in cosmic theme; acceptable because logged-in users are redirected away from `/`.
- Sign-out continues to redirect to `/`, which (post-Phase-2) shows the new landing.

## Success Criteria (Summary)

- Login lands on `/library` in one step; logged-in `/` redirects there; `/dashboard` is gone.
- `/library` and `/play-next` always offer sign-out and a way back to the library.
- Logged-out `/` shows a Gaming Library–branded landing with working Sign In / Sign Up.
