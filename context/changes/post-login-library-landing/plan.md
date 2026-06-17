# Post-Login Library Landing Implementation Plan

## Overview

After signing in, the user should land on their library directly instead of the current `/` (marketing page) → `/dashboard` → `/library` three-surface hop. This plan redirects login (and any logged-in visit to `/`) straight to `/library`, gives every authenticated page a persistent header with a way back to the library and a sign-out control, retires the now-redundant `/dashboard` route, and replaces the generic "10x Astro Starter" homepage with a Gaming Library–branded landing page for unauthenticated visitors.

This is roadmap slice **S-08** (◇ optional UX polish, PRD US-04 — browsing the library is the primary post-login action). The homepage redesign was added to scope during planning at the user's request.

## Current State Analysis

- **Post-login redirect** lands on `/`: `src/pages/api/auth/signin.ts:19` returns `context.redirect("/")`.
- **`/` renders the starter marketing page**: `src/pages/index.astro` renders `Welcome.astro`, the "10x Astro Starter" hero with Sign In / Sign Up CTAs and three generic feature cards. `Welcome.astro` is the **only** page that renders `Topbar` (`Welcome.astro:28`).
- **`Topbar.astro`** shows, for a logged-in user, their email + a **"Dashboard"** link (`Topbar.astro:13`, hardcoded `href="/dashboard"`) + a Sign out form. For an unauthenticated user it shows Sign in / Sign up links.
- **`/dashboard`** (`src/pages/dashboard.astro`) is a thin welcome card: greeting + a "Go to My Library" button (`href="/library"`) + Sign out.
- **`/library`** (`src/pages/library/index.astro`) is the real app surface. Its header (`:137-160`) holds only "What should I play next?" and the Add-game dialog — **no sign-out, no persistent nav, no Topbar**.
- **`/play-next`** (`src/pages/play-next/index.astro`) is the recommender page — likewise no shared header.
- **Middleware** (`src/middleware.ts`) resolves `context.locals.user`, guards `PROTECTED_ROUTES = ["/dashboard", "/library", "/play-next"]` by redirecting unauthenticated users to `/auth/signin`. It does **nothing** for authenticated users hitting `/` or `/dashboard`.
- **Sign-out** (`src/pages/api/auth/signout.ts:9`) redirects to `/` — correct and unchanged by this plan.
- **Doc references** to `/dashboard`: `CLAUDE.md:34`, `README.md:147`.

### Key Discoveries:

- The post-login destination is a one-line change at `src/pages/api/auth/signin.ts:19`.
- The library and play-next pages have **no sign-out path at all** today — "land on library directly" strands the user unless a persistent header is added. This is why the Topbar work is in scope, not optional.
- `Topbar` is a ready-made, reusable component; it just needs the "Dashboard" link retitled to "Library" (→ `/library`) and to be slotted into the authenticated page headers.
- Middleware already computes `context.locals.user`, so redirecting logged-in visitors away from `/` is a small conditional, not new plumbing.
- The landing page uses the global dark theme via `Layout.astro` (which also injects the config `Banner`). The signed-in app uses the "cosmic" theme (`bg-cosmic`); the user chose a **fresh gaming-themed** landing, so a deliberate visual seam between landing and the signed-in app is expected and acceptable (logged-in users never see the landing — they are redirected).

## Desired End State

- Signing in lands the user on `/library` in one step.
- A logged-in user navigating to `/` is redirected to `/library` — they never see the marketing/landing page.
- `/library` and `/play-next` each show a persistent header with the user's email, a "Library" link (back to `/library`), and a Sign out control.
- `/dashboard` no longer exists; nothing links to it, and it is no longer a protected route.
- An unauthenticated visitor to `/` sees a Gaming Library–branded landing page (product name + tagline, Sign In / Sign Up CTAs, 2-3 feature highlights, minimal footer) with a fresh gaming aesthetic — no "10x Astro Starter" copy remains.

Verification: log in → arrive at `/library` with a header carrying sign-out; visit `/` while logged in → redirected to `/library`; sign out → arrive at the new branded landing at `/`; visit `/dashboard` → 404 (route removed); `npm run lint` and `npm run build` pass.

## What We're NOT Doing

- Not changing the sign-out redirect target (stays `/`, which now shows the new landing).
- Not changing auth logic, Supabase config, or the signin/signup pages themselves (`auth/signin.astro`, `auth/signup.astro`).
- Not redesigning the signed-in app's "cosmic" theme or the `/library` / `/play-next` page bodies (only adding the shared header).
- Not building a dashboard/home stats surface — `/dashboard` is removed, not reimagined.
- Not adding new marketing sections beyond the hero + 2-3 feature highlights + footer (no screenshots, no multi-section marketing site).
- Not updating the archived deployment smoke-test doc (`context/changes/deployment/deployment-plan.md`) that probes `/dashboard`; see Migration Notes for the behavior change.

## Implementation Approach

Two phases, each independently verifiable. Phase 1 delivers the roadmap slice's actual outcome (reach the library directly + persistent way back) and retires the dashboard. Phase 2 is the user-requested homepage redesign, which only matters for unauthenticated visitors and depends on nothing in Phase 1 — but is sequenced second because Phase 1 is the committed slice value.

## Phase 1: Direct-to-library navigation & retire dashboard

### Overview

Make login and logged-in `/` visits land on `/library`, give authenticated pages a persistent header via the shared `Topbar`, and remove the `/dashboard` route and all references to it.

### Changes Required:

#### 1. Post-login redirect

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Send a successfully authenticated user straight to their library instead of the homepage.

**Contract**: The success-path `context.redirect("/")` (line 19) becomes `context.redirect("/library")`. Error paths unchanged.

#### 2. Redirect logged-in visitors away from the homepage

**File**: `src/middleware.ts`

**Intent**: A logged-in user who lands on `/` (e.g. via bookmark, sign-out-then-back, or external link) should go to `/library`, guaranteeing the "single, obvious step" outcome. Also drop `/dashboard` from the protected-routes list since the page is being removed.

**Contract**: After `context.locals.user` is resolved, add a branch: if the user is authenticated and `context.url.pathname === "/"`, return `context.redirect("/library")`. Remove `"/dashboard"` from `PROTECTED_ROUTES` so the array is `["/library", "/play-next"]`. Keep the existing unauthenticated-on-protected-route redirect intact and ordered after the new branch.

#### 3. Shared persistent header on authenticated pages

**File**: `src/components/Topbar.astro`

**Intent**: Repurpose the existing Topbar as the persistent authenticated-app header. The logged-in link should point back to the library, not the deleted dashboard.

**Contract**: Change the authenticated nav link (line 13) from `href="/dashboard"` label "Dashboard" to `href="/library"` label "Library". Sign-out form and unauthenticated branch unchanged.

**File**: `src/pages/library/index.astro`

**Intent**: Render the shared header at the top of the library page so sign-out and the email are always reachable.

**Contract**: Import `Topbar` and render it inside the `Layout`, above the existing `<main>`/header block (around `:134-137`). No change to the existing page-specific header (the `My Library` heading + action buttons).

**File**: `src/pages/play-next/index.astro`

**Intent**: Same persistent header on the recommender page.

**Contract**: Import and render `Topbar` at the top of the page's `Layout`, consistent with the library page's placement.

#### 4. Delete the dashboard route

**File**: `src/pages/dashboard.astro`

**Intent**: Remove the now-orphaned hop. Login no longer lands here, the Topbar no longer links here, and it is no longer protected.

**Contract**: Delete the file. Confirm no remaining code references resolve to it (the `Topbar` link and `PROTECTED_ROUTES` entry are removed in changes #2 and #3; `signin.ts` no longer targets `/`→dashboard flow).

#### 5. Update documentation references

**File**: `CLAUDE.md`

**Intent**: The "Protected page example: `src/pages/dashboard.astro`" line (`:34`) now points at a deleted file.

**Contract**: Replace the protected-page example with a current one (e.g. `src/pages/library/index.astro`).

**File**: `README.md`

**Intent**: The routes table lists `/dashboard` as an example protected page (`:147`).

**Contract**: Update the row to reflect `/library` (or `/play-next`) as the protected-page example; remove the `/dashboard` entry.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- No source references to `/dashboard` remain: `grep -rn "/dashboard" src/` returns nothing
- `src/pages/dashboard.astro` no longer exists

#### Manual Verification:

- Signing in lands directly on `/library`
- `/library` and `/play-next` show a header with the user's email, a "Library" link, and a working Sign out button
- Visiting `/` while logged in redirects to `/library`
- Visiting `/dashboard` (logged in or out) returns 404
- Signing out lands on `/` and shows the landing page (after Phase 2; pre-Phase-2 it shows the old Welcome page)
- The "Library" header link returns to `/library` from `/play-next`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Gaming Library landing page

### Overview

Replace the generic "10x Astro Starter" homepage with a Gaming Library–branded landing page for unauthenticated visitors, using a fresh gaming-themed visual design.

### Changes Required:

#### 1. New landing content

**File**: `src/components/Welcome.astro` (rewrite) — or a new `src/components/Landing.astro` rendered by `index.astro`

**Intent**: Present the product to a first-time, unauthenticated visitor: what Gaming Library is, why it exists, and how to get in. Replace all starter copy and the cosmic-starter visuals with a fresh gaming aesthetic.

**Contract**: The landing renders:
- **Product name + tagline** — "Gaming Library" headline with a one-line value statement drawn from the product vision (catalog your physical game collection; answer "do I already own this?" and "what should I play next?").
- **Primary Sign In CTA** (`/auth/signin`) and secondary Sign Up CTA (`/auth/signup`).
- **2-3 feature highlights** mapping to the PRD's core bets: photo/manual cataloguing of physical games, ownership check before buying, and the deterministic "what to play next" recommender.
- **Minimal footer** — a single line (e.g. single-collector note + year).

Visual direction is a fresh gaming theme distinct from the signed-in app's cosmic theme; build with Tailwind 4 utilities and the `cn()` helper per project conventions. No `Topbar` is required on the landing (logged-in users are redirected away by Phase 1; the Sign In / Sign Up CTAs are the entry points). The page continues to render inside `Layout.astro`, so the config `Banner` still appears when secrets are missing.

**File**: `src/pages/index.astro`

**Intent**: Wire the homepage to the new landing content.

**Contract**: If a new `Landing.astro` component is introduced, import and render it in place of `Welcome`. If `Welcome.astro` is rewritten in place, `index.astro` needs no change. Either way `/` renders the new landing.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- No "10x Astro Starter" string remains in the landing source: `grep -rn "10x Astro Starter" src/` returns nothing (or only unrelated occurrences)

#### Manual Verification:

- Visiting `/` while logged out shows the Gaming Library landing with product name, tagline, Sign In / Sign Up CTAs, 2-3 feature highlights, and a footer
- Sign In and Sign Up CTAs navigate to `/auth/signin` and `/auth/signup`
- The landing uses the fresh gaming theme (no starter cosmic hero, no generic feature cards)
- The page is responsive on mobile widths
- Logged-in users are still redirected from `/` to `/library` (Phase 1 behavior intact)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the landing looks and behaves as intended.

---

## Testing Strategy

### Manual Testing Steps:

1. Logged out, visit `/` → see the new Gaming Library landing.
2. Click Sign In, authenticate → land directly on `/library`.
3. Confirm the `/library` header shows email + "Library" link + Sign out.
4. Navigate to `/play-next` → same header present; click "Library" → back to `/library`.
5. While logged in, manually visit `/` → redirected to `/library`.
6. While logged in, manually visit `/dashboard` → 404.
7. Click Sign out → land on `/` showing the new landing.
8. Logged out, visit `/library` → redirected to `/auth/signin` (protection intact).

## Migration Notes

- `/dashboard` changes from a 302→signin (when unauthenticated) to a 404 for all users. The archived deployment smoke-test doc (`context/changes/deployment/deployment-plan.md`) probes `/dashboard`→302 as a health signal; that probe will now report 404. Updating that doc is out of scope, but anyone re-running the documented smoke test should switch the protected-route probe to `/library`.

## References

- Change identity: `context/changes/post-login-library-landing/change.md`
- Roadmap slice S-08 + open design decision: `context/foundation/roadmap.md:203-214`
- Current redirect: `src/pages/api/auth/signin.ts:19`
- Shared header component: `src/components/Topbar.astro`
- Middleware / protected routes: `src/middleware.ts:4-22`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Direct-to-library navigation & retire dashboard

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 675db09
- [x] 1.2 Production build succeeds: `npm run build` — 675db09
- [x] 1.3 No source references to `/dashboard` remain — 675db09
- [x] 1.4 `src/pages/dashboard.astro` no longer exists — 675db09

#### Manual

- [x] 1.5 Signing in lands directly on `/library` — 675db09
- [x] 1.6 `/library` and `/play-next` show a header with email, "Library" link, and working Sign out — 675db09
- [x] 1.7 Visiting `/` while logged in redirects to `/library` — 675db09
- [x] 1.8 Visiting `/dashboard` returns 404 — 675db09
- [x] 1.9 Signing out lands on `/` — 675db09
- [x] 1.10 The "Library" header link returns to `/library` from `/play-next` — 675db09

### Phase 2: Gaming Library landing page

#### Automated

- [x] 2.1 Linting passes: `npm run lint`
- [x] 2.2 Production build succeeds: `npm run build`
- [x] 2.3 No "10x Astro Starter" string remains in the landing source

#### Manual

- [ ] 2.4 `/` logged out shows the Gaming Library landing (name, tagline, CTAs, 2-3 highlights, footer)
- [ ] 2.5 Sign In / Sign Up CTAs navigate correctly
- [ ] 2.6 The landing uses the fresh gaming theme (no starter cosmic hero/cards)
- [ ] 2.7 The page is responsive on mobile widths
- [ ] 2.8 Logged-in users are still redirected from `/` to `/library`
