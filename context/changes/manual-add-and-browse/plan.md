# Manual Add & Browse (S-01) Implementation Plan

## Overview

Build the first end-to-end **create → enrich → browse** loop for Gaming Library. A signed-in user opens an **Add game** dialog from the library page, enters a title and picks/types a platform, and on save the entry is enriched with IGDB metadata (server-side, at save time) and persisted. The user browses their library in a server-rendered, paginated list with newest entries first. This slice turns the already-built data store (F-01) and IGDB enrichment service (F-02) into a real user capability and is the safe feeder beneath the photo path (S-03) and the recommender (S-07).

## Current State Analysis

**Done and reusable (no rework):**

- **Data layer (F-01)** — `library_entries` table exists with all columns this slice needs: `title`, `platform` (free text), `play_status` (default `'not_played'`, CHECK-constrained), `date_bought` (nullable date), the IGDB metadata columns (`genre text[]`, `developer text[]`, `series text[]`, `length_hours numeric`, `release_year integer`, `release_date date`, `igdb_id bigint`), `metadata_status` (CHECK `matched|no_match`), `created_at` (default `now()`). RLS is enabled with 4 per-operation policies scoped to `auth.uid() = user_id`, and `user_id` defaults to `auth.uid()` so inserts can omit it. **No migration is needed.** (`supabase/migrations/20260606150950_create_library_entries.sql`, `…20260608183408_enrich_library_entries_metadata.sql`)
- **Types (F-01)** — `src/types.ts` exports `LibraryEntry`, `LibraryEntryInsert`, `PlayStatus`, `PLAY_STATUSES`, `MetadataStatus`, and the `IgdbLookupResult` discriminated union.
- **Enrichment (F-02)** — `lookupGameMetadata(title, platform, kv): Promise<IgdbLookupResult>` in `src/lib/services/igdb.ts`. Returns `{status:'matched', igdbId, genre[], developer[], series[], releaseYear, releaseDate, lengthHours}` or `{status:'no_match'}`. `no_match` is a returned value; **empty input (ZodError) and IGDB/Twitch transport/auth failures throw** — callers must handle. Platform names resolve through `PLATFORM_IDS_BY_NAME` (`igdb.ts:58-83`); unknown platforms degrade to an unfiltered title search (still enriches by title).
- **Supabase client** — `createClient(headers, cookies)` in `src/lib/supabase.ts`, typed against `Database`. Returns `null` if env is unconfigured.
- **Auth + middleware** — `src/middleware.ts` resolves `locals.user` and guards `PROTECTED_ROUTES` (currently only `/dashboard`).

**Missing (this slice owns it):** no library service layer, no library API routes, no feature UI. Only `button` exists in `src/components/ui/`; `dialog`, `popover`, `command`, `input`, `label` are not installed. No `react-hook-form`, no toast library — forms hand-roll `useState` + a custom `FormField` (`src/components/auth/`). `zod` v4 and `lucide-react` are available.

### Key Discoveries:

- **KV binding access** — per `context/foundation/lessons.md`, do **not** use `Astro.locals.runtime.env` (removed in Astro 6 / @astrojs/cloudflare v13). Get the `IGDB_TOKENS` KV namespace via `import { env } from "cloudflare:workers"` and pass `env.IGDB_TOKENS` into `lookupGameMetadata`.
- **`IgdbLookupResult` maps 1:1 onto the metadata columns** — `igdbId→igdb_id`, `genre→genre`, `developer→developer`, `series→series`, `releaseYear→release_year`, `releaseDate→release_date`, `lengthHours→length_hours`. No transformation beyond field renaming.
- **Platform map is a precision aid, not a wall** — the `platform` column is free text; an unrecognized platform (e.g. Evercade) still saves and still enriches by unfiltered title search. The curated map only sharpens platform filtering.
- **API route precedent** (`src/pages/api/auth/signin.ts`) uses form-POST + redirect. This slice instead uses a **fetch/JSON** contract because the Add dialog needs client-controlled flow (Save vs Save-&-add-another) — a deliberate, justified divergence.

## Desired End State

A signed-in user visits `/library` and sees their games newest-first, 20 per page, with working pagination and an empty-state CTA when the library is empty. Clicking **Add game** opens a dialog; they type a title and select or type a platform (curated list ∪ platforms already in their library); on **Save** the entry is enriched and persisted, the dialog closes, and the new entry appears at the top of the list. **Save & add another** keeps the dialog open with cleared fields for fast bulk cataloguing. Entries IGDB can't match (or that error during enrichment) save with a `no_match` flag and the user-supplied fields intact. Verify by adding a known title (enriched), an Evercade title (saves, unfiltered enrich or `no_match`), bulk-adding several, paging through, and confirming another user's entries never appear.

## What We're NOT Doing

- **No edit or delete** — owned by S-02. The post-save "open edit modal" behavior is a seam left for S-02; S-01 just closes/clears.
- **No manual re-fetch of metadata** — re-enrichment is deferred to S-02 (re-run on title/platform edit). No retry button this slice.
- **No play-status UI** — `play_status` defaults to `not_played`; setting/changing it is S-04.
- **No search, filter, or sort controls** — S-05/S-06. Sort is fixed to newest-first.
- **No `date_bought` field in the form** — it defaults to today server-side; editing it waits for S-02.
- **No photo path** — S-03.
- **No new migration** — the schema from F-01/F-02 is sufficient.

## Implementation Approach

Three phases, bottom-up: (1) a platform-map expansion plus a pure server-side library service that owns enrichment-at-save and pagination queries; (2) a single `POST /api/library` JSON route over that service; (3) the SSR browse page and the Add-dialog React island. The library list and the combobox's platform options are fetched **server-side in the Astro page** (RLS applies directly, no extra GET endpoint), so the only API surface is the create route. Enrichment runs synchronously at save time (FR-008 eager enrichment); any throw is caught and folded into a `no_match` save so a flaky external API never costs the user their input.

## Critical Implementation Details

- **Enrichment is synchronous and must not lose user input.** `createLibraryEntry` wraps `lookupGameMetadata` in try/catch. `{status:'matched'}` → populate metadata columns + `metadata_status='matched'`. `{status:'no_match'}` **or any thrown error** → metadata columns null + `metadata_status='no_match'`. The insert always happens.
- **KV must be resolved per-request**, not at module scope: `import { env } from "cloudflare:workers"` inside the API route, pass `env.IGDB_TOKENS` down. If the binding/secrets are absent in local dev, enrichment throws → the entry still saves as `no_match` (acceptable, and the graceful local-dev behavior).
- **Switch 2 platform id (508) is from a gist comment** — confirm against a live IGDB platforms query during Phase 1; if wrong, drop the entry rather than ship a bad id (Switch 2 titles then degrade to unfiltered search).

## Phase 1: Platform map + library service layer

### Overview

Expand the IGDB platform map to cover the collector's real shelf, publish a curated platform list for the UI, and build the pure server-side service that creates (with enrichment) and lists library entries. No UI, no routes.

### Changes Required:

#### 1. Expand the IGDB platform map

**File**: `src/lib/services/igdb.ts`

**Intent**: Add the collector's platforms that IGDB knows but the curated map omits, so enrichment is platform-filtered for them.

**Contract**: Add entries to `PLATFORM_IDS_BY_NAME` (normalized lowercase keys): `playstation 2`→`[8]`, `ps2`→`[8]`; `playstation portable`→`[38]`, `psp`→`[38]`; `nintendo ds`→`[20]`; `nintendo switch 2`→`[508]`, `switch 2`→`[508]`. Verify `508` against a live IGDB platforms query before committing; omit if unconfirmed. Evercade is intentionally absent (no IGDB id → unfiltered search). No signature changes.

#### 2. Curated platform list for the UI

**File**: `src/lib/platforms.ts` (new)

**Intent**: A single source of the display-label platform list the combobox seeds from, matching the user's real catalogue. Kept separate from the IGDB map (which is keyed by normalized lookup names).

**Contract**: Export `KNOWN_PLATFORMS: readonly string[]` with these display labels in this order: `Xbox Series X`, `Xbox 360`, `PlayStation 5`, `PlayStation 4`, `PlayStation 3`, `PlayStation 2`, `PlayStation Portable`, `PlayStation Vita`, `PC`, `Nintendo Switch 2`, `Nintendo Switch`, `Nintendo 3DS`, `Nintendo DS`, `Evercade`. Each (except Evercade) must normalize (lowercase) to a `PLATFORM_IDS_BY_NAME` key.

#### 3. Library service

**File**: `src/lib/services/library.ts` (new)

**Intent**: Own the create-with-enrichment, paginated-list, and used-platforms queries so routes and pages stay thin. All queries run through the passed authenticated Supabase client (RLS does isolation).

**Contract**: Three exports, taking a typed Supabase client (the non-null return of `createClient`) as first arg:
- `createLibraryEntry(supabase, kv: KVNamespace, input: { title: string; platform: string }): Promise<LibraryEntry>` — calls `lookupGameMetadata(title, platform, kv)` in try/catch; maps `matched` → metadata columns + `metadata_status:'matched'`, and `no_match`/throw → nulls + `metadata_status:'no_match'`; sets `date_bought` to today (`YYYY-MM-DD`, server-computed) and lets `play_status`/`user_id` fall to their DB defaults; inserts and returns the created row (`.select().single()`).
- `listLibraryEntries(supabase, { page: number; pageSize: number }): Promise<{ entries: LibraryEntry[]; total: number }>` — `.select('*', { count: 'exact' })`, `.order('created_at', { ascending: false })`, `.range(from, to)` where `from=(page-1)*pageSize`. Clamp `page>=1`.
- `listUsedPlatforms(supabase): Promise<string[]>` — distinct non-null `platform` values for the current user (select `platform`, dedupe in JS, case-insensitive).

Insert payload is typed as `LibraryEntryInsert`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass for `createLibraryEntry` mapping: matched→columns populated; `no_match`→nulls+flag; **thrown enrichment error→nulls+`no_match` flag (not propagated)**; `date_bought` set to today.
- Unit test: `KNOWN_PLATFORMS` minus `Evercade` all resolve to a non-empty `PLATFORM_IDS_BY_NAME` entry.

#### Manual Verification:

- Confirmed IGDB platform id for Nintendo Switch 2 (or the entry was dropped) via a live query.

**Implementation Note**: After automated verification passes, pause for human confirmation of the Switch 2 id check before proceeding.

---

## Phase 2: Create API route

### Overview

Expose `createLibraryEntry` through a single JSON endpoint the Add dialog calls. List/options are read server-side in the page, so no GET endpoint is built here.

### Changes Required:

#### 1. Create endpoint

**File**: `src/pages/api/library/index.ts` (new)

**Intent**: Validate the add request, resolve the authenticated client and KV binding, enrich-and-save, and return the created entry as JSON.

**Contract**: `export const prerender = false;` and `export const POST: APIRoute`. Parse JSON body; validate with zod (`title` and `platform` both required, trimmed, non-empty). Get `supabase = createClient(request.headers, cookies)` → 500 JSON if null; reject with 401 JSON if `locals.user` is absent. Resolve KV via `import { env } from "cloudflare:workers"` → `env.IGDB_TOKENS`. Call `createLibraryEntry(supabase, kv, parsed)`. Return `201` `{ entry }` on success; `400` `{ error }` on validation failure; `500` `{ error }` on unexpected DB failure. (Enrichment failures do **not** error the request — they save as `no_match` inside the service.)

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- `POST /api/library` with a known title+platform returns `201` with an enriched `entry` (genre/developer populated, `metadata_status:'matched'`).
- `POST` with a junk title returns `201` with `metadata_status:'no_match'` and the entry still saved.
- `POST` with missing title or platform returns `400`.
- `POST` while signed out returns `401`.

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual API checks before proceeding.

---

## Phase 3: Browse page + Add dialog island

### Overview

Build the server-rendered paginated library page and the interactive Add-game dialog, install the shadcn primitives they need, and protect the route.

### Changes Required:

#### 1. Install shadcn primitives

**File**: `src/components/ui/` (generated)

**Intent**: Provide the dialog, combobox, and form primitives the Add dialog needs, in the project's "new-york" style.

**Contract**: `npx shadcn@latest add dialog popover command input label`. Adds `cmdk`/`@radix-ui` deps as needed. No custom code here beyond what the CLI generates.

#### 2. Creatable platform combobox

**File**: `src/components/library/PlatformCombobox.tsx` (new)

**Intent**: Let the user pick a known/used platform or type a new one (e.g. Evercade), satisfying "after one entry of a new platform value, it appears in the combobox."

**Contract**: Props `{ options: string[]; value: string; onChange: (v: string) => void }`. Built on `Popover` + `Command`. Renders `options` as items; when the typed query matches no option, shows a `Create "<query>"` action that selects the free-text value. On selecting a freshly-created value, append it to the in-memory option list so it's immediately reusable within the session. Case-insensitive match/dedupe.

#### 3. Reusable game-form body (mode-extensible)

**File**: `src/components/library/GameFormFields.tsx` (new)

**Intent**: The dialog's form *body*, factored out as a standalone component so S-02 can grow it from "add" (title + platform) into a full add/edit field set without rewriting the dialog. S-01 builds only the add fields; the seam is the component boundary, not pre-built edit fields. (See S-02 design note in `context/foundation/roadmap.md`.)

**Contract**: A controlled, presentational component — no fetch, no dialog, no submit logic. Props expose the field values + change handlers and the platform options, e.g. `{ values: { title: string; platform: string }; onChange: (patch: Partial<{title: string; platform: string}>) => void; errors?: Record<string, string>; platformOptions: string[] }`. Renders the title `input` and the `PlatformCombobox`. The value/onChange/errors shape is intentionally a record so S-02 can widen it to more fields without breaking the contract. Do **not** add edit-only fields now.

#### 4. Add-game dialog island

**File**: `src/components/library/AddGameDialog.tsx` (new)

**Intent**: The interactive add surface launched from the library page; owns the dialog shell, validation, the create call, and the Save vs Save-&-add-another flows. Wraps `GameFormFields` — so when S-02 expands that body and adds an UPDATE path, this shell becomes the unified add/edit dialog.

**Contract**: Props `{ platformOptions: string[] }`. Holds the `values` record (`title`, `platform`), submit-pending, and error state; renders `GameFormFields` inside the `Dialog`. Client-validates both required. On submit, `fetch('/api/library', { method:'POST', body: JSON.stringify(values) })`. **Save**: on success close the dialog and navigate to `/library` (page 1) so the new entry shows on top. **Save & add another**: on success clear fields, keep the dialog open, append any newly-created platform to the in-memory options, keep focus on title. Surface `400`/`500` errors inline. Trigger is an **Add game** button rendered by this island. Structure the submit/close path as a single post-save seam (so S-02 can swap "close + navigate" for "reopen in edit mode").

#### 5. Library browse page

**File**: `src/pages/library/index.astro` (new)

**Intent**: Server-render the user's paginated library and mount the Add dialog; the hub of the slice.

**Contract**: Reads `page` from `Astro.url.searchParams` (default 1). Gets `supabase = createClient(...)`; calls `listLibraryEntries(supabase, { page, pageSize: 20 })` and `listUsedPlatforms(supabase)`. Renders a table/card list of entries (title, platform, genre, release year, a "No metadata" indicator when `metadata_status==='no_match'`), newest first. Renders Prev/Next pagination as links (`?page=N`), disabled at bounds, derived from `total`. Mounts `<AddGameDialog platformOptions={merged} client:load />` where `merged` = `KNOWN_PLATFORMS` ∪ used platforms (case-insensitive dedupe). Empty-state (total 0): a prominent "Add your first game" message wrapping the same dialog trigger. Uses `Layout.astro`.

#### 6. Protect the route + entry point

**File**: `src/middleware.ts`, `src/pages/dashboard.astro`

**Intent**: Require auth for the library and give users a way to reach it.

**Contract**: Add `"/library"` to `PROTECTED_ROUTES`. Add a link to `/library` from the dashboard welcome.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Adding a known game via the dialog enriches it and it appears at the top of `/library`.
- Adding an Evercade title saves it (unfiltered enrich or `no_match`) with the platform preserved; "Evercade" is then selectable in the combobox.
- **Save & add another** clears the form, keeps the dialog open, and adds multiple entries without navigation.
- Pagination Prev/Next works across 20+ entries; bounds disabled correctly.
- Empty library shows the "Add your first game" empty-state.
- Visiting `/library` while signed out redirects to `/auth/signin`.
- A second user does not see the first user's entries (RLS isolation).

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual UI/RLS checks. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- `createLibraryEntry` enrichment mapping: matched → all metadata columns; `no_match` → nulls + flag; **thrown error → nulls + `no_match`, no propagation**; `date_bought` defaults to today.
- `KNOWN_PLATFORMS` (minus Evercade) all resolve in `PLATFORM_IDS_BY_NAME`.
- `listLibraryEntries` range math: page→`from/to`, `page` clamped to ≥1.

### Integration / Manual Testing Steps:

1. Sign in; visit `/library` (empty) → see empty-state CTA.
2. Add a well-known title on a curated platform → enriched, appears on top.
3. Add an Evercade title → saved with platform preserved; combobox now offers Evercade.
4. Use **Save & add another** to add 5 titles in a row without leaving the dialog.
5. Add enough to exceed 20 → page 2 via Next; verify Prev/Next bounds.
6. Sign in as a second user → confirm none of user 1's entries are visible.
7. Sign out, hit `/library` → redirected to sign-in.

## Performance Considerations

Each add makes up to 2 IGDB calls (games + length); the Twitch token is KV-cached by F-02, so steady-state add cost is dominated by IGDB latency. Pagination uses `count: 'exact'` over a `user_id`-indexed table — fine at the 50–few-hundred-entry scale. No N+1: list is a single ranged query.

## Migration Notes

None — the F-01/F-02 schema is sufficient. No production migration deploy is part of this slice (it rides whenever the team next deploys; the table already exists in the target DB per F-01's deploy notes).

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-01)
- PRD: US-04, FR-007, FR-008, FR-009 (`context/foundation/prd.md`)
- Enrichment contract: `src/lib/services/igdb.ts:135` (`lookupGameMetadata`)
- Types: `src/types.ts`
- KV access rule: `context/foundation/lessons.md`
- API route precedent: `src/pages/api/auth/signin.ts`
- Supabase client: `src/lib/supabase.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Platform map + library service layer

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 40f06c2
- [x] 1.2 Linting passes: `npm run lint` — 40f06c2
- [x] 1.3 Unit tests pass for `createLibraryEntry` mapping (matched / no_match / thrown→no_match / date_bought today) — 40f06c2
- [x] 1.4 Unit test: `KNOWN_PLATFORMS` minus Evercade all resolve in `PLATFORM_IDS_BY_NAME` — 40f06c2

#### Manual

- [x] 1.5 Confirmed Nintendo Switch 2 IGDB id (or dropped) via a live query — 40f06c2

### Phase 2: Create API route

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 46d3b98
- [x] 2.2 Linting passes: `npm run lint` — 46d3b98
- [x] 2.3 Production build succeeds: `npm run build` — 46d3b98

#### Manual

- [x] 2.4 `POST /api/library` with a known title+platform returns 201 with enriched entry — 46d3b98
- [x] 2.5 `POST` with junk title returns 201 with `metadata_status:'no_match'`, entry saved — 46d3b98
- [x] 2.6 `POST` with missing title/platform returns 400 — 46d3b98
- [x] 2.7 `POST` while signed out returns 401 — 46d3b98

### Phase 3: Browse page + Add dialog island

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Production build succeeds: `npm run build`

#### Manual

- [x] 3.4 Adding a known game enriches it and it appears on top of `/library`
- [x] 3.5 Adding an Evercade title saves with platform preserved; Evercade then selectable in combobox
- [x] 3.6 Save & add another clears form, keeps dialog open, adds multiple without navigation
- [x] 3.7 Pagination Prev/Next works across 20+ entries with correct bounds
- [x] 3.8 Empty library shows "Add your first game" empty-state
- [x] 3.9 `/library` while signed out redirects to `/auth/signin`
- [x] 3.10 A second user does not see the first user's entries (RLS isolation)
