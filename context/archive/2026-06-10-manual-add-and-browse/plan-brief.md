# Manual Add & Browse (S-01) — Plan Brief

> Full plan: `context/changes/manual-add-and-browse/plan.md`

## What & Why

The first end-to-end **create → enrich → browse** loop. A signed-in user adds a game by title + platform, the entry is auto-enriched with IGDB metadata at save time, and they browse their library in a paginated view. This is the safe, lowest-risk feeder beneath the photo path (S-03) and the recommender (S-07) — it proves F-01 (store) and F-02 (enrichment) through a real user capability without depending on the riskier vision path.

## Starting Point

The data store (F-01: `library_entries` table + RLS + types) and the IGDB enrichment service (F-02: `lookupGameMetadata`) are both done and archived. There is **no** library service layer, no library API routes, and no feature UI yet — only auth pages, a dashboard welcome, and a single `button` shadcn component. This slice writes all the application code on top of the existing schema; no migration.

## Desired End State

`/library` shows the user's games newest-first, 20/page, with pagination and an empty-state CTA. An **Add game** dialog (launched from that page) takes a title and a platform (creatable combobox), enriches and saves on submit, and surfaces the new entry on top — with **Save & add another** for bulk cataloguing. Titles IGDB can't match, or that error during enrichment, save with a `no_match` flag and the user's fields intact.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Platform input | Creatable combobox; options = curated list ∪ user's existing platforms | Fits a real retro+modern shelf and allows non-IGDB platforms (Evercade); new values self-register | Plan |
| Platform coverage | Expand IGDB map: PS2 (8), PSP (38), DS (20), Switch 2 (508, verify) | F-02 curated only ~13; user's actual catalogue needs these for platform-filtered enrichment | Plan |
| Add UI surface | Dialog/modal over the library list | List stays the hub; mirrors S-02's future auto-edit modal; bulk entry without navigation | Plan |
| Form scope | title + platform only; `date_bought`→today; `play_status`→`not_played` | Fastest capture for 50+ titles; avoids over-modeling (S-02/S-04 own the rest) | Plan |
| Enrichment failure | clean `no_match` saves flagged; thrown error caught → saved `no_match`; re-fetch deferred to S-02 | Never lose committed input to a flaky external API; FR-008 allows save-without-metadata | Plan |
| Pagination | SSR page, `?page=`, `.range()` + exact count | Matches the app's server-rendered default; RLS applies directly, no extra GET endpoint | Plan |
| Browse defaults | newest-first (`created_at` desc), 20/page | Just-added games appear on top, reinforcing the add→browse loop | Plan |

## Scope

**In scope:** library service layer (create+enrich, paginated list, used-platforms); `POST /api/library`; SSR `/library` page with pagination + empty state; Add-game dialog island with creatable platform combobox and Save / Save-&-add-another; platform-map expansion; route protection.

**Out of scope:** edit/delete (S-02), manual metadata re-fetch (S-02), play-status UI (S-04), search/filter/sort controls (S-05/S-06), `date_bought` form field, photo path (S-03), any DB migration.

## Architecture / Approach

Bottom-up. A pure server-side service (`src/lib/services/library.ts`) owns enrichment-at-save and pagination queries over the authenticated Supabase client (RLS handles isolation). A single JSON `POST /api/library` route sits over it; the list and combobox options are read **server-side in the Astro page** (no GET endpoint). The browse page is SSR; the Add dialog is a React island posting JSON. Enrichment is synchronous at save time, with any throw folded into a `no_match` save. KV for IGDB tokens is resolved per-request via `import { env } from "cloudflare:workers"` (not `locals.runtime.env` — removed in Astro 6).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Platform map + service layer | Expanded IGDB map, `KNOWN_PLATFORMS`, `library.ts` (create+enrich, list, used-platforms) | Unverified Switch 2 id (508); enrichment-throw handling must not propagate |
| 2. Create API route | `POST /api/library` JSON endpoint, zod-validated, KV-wired | Correct KV access pattern; auth/validation status codes |
| 3. Browse page + Add dialog | SSR `/library` + pagination + empty state; creatable-combobox dialog island | Creatable combobox UX; SSR-list refresh after save; route protection |

**Prerequisites:** F-01 and F-02 (both done). IGDB/Twitch credentials + `IGDB_TOKENS` KV binding for live enrichment (absent locally → entries save as `no_match`, which is acceptable).
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- Nintendo Switch 2 IGDB id `508` came from a gist comment — must be verified live in Phase 1 (drop if wrong).
- `date_bought`→today is correct for new purchases but imprecise if the user later back-catalogues an existing shelf (everything dates to today); editable via S-02.
- The Add dialog diverges from the auth pages' form-POST-redirect pattern (uses fetch/JSON) to support Save-&-add-another — a deliberate, contained choice.

## Success Criteria (Summary)

- A user can add a game by title + platform, see it enriched and at the top of their paginated library.
- Unmatched or enrichment-failed entries still save with the user's fields and a `no_match` flag.
- Bulk entry via Save-&-add-another, pagination, empty-state, and per-user RLS isolation all work.
