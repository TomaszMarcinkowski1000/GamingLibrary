# Edit & Delete a Library Entry (S-02) Implementation Plan

## Overview

Turn S-01's add-only flow into full library management. A signed-in user can **edit any field** of an existing entry — title, platform, play status, play time, date bought, and the IGDB metadata fields (genre/developer/series/length/year/release date) — through the **same dialog they add with**, now grown into a unified add/edit dialog. They can **delete** an entry behind a confirmation step. Edit and delete are reachable as **per-row actions** on the library list, and delete is also available from inside the edit dialog. This slice is the correction path the photo auto-save (S-03 / FR-006) depends on, so it must land before the north star.

## Current State Analysis

**Done and reusable (S-01 left explicit seams for this slice — no rework):**

- **Data layer (F-01)** — `library_entries` carries every field this slice edits. **RLS UPDATE and DELETE policies already exist**, both scoped to `auth.uid() = user_id` with `WITH CHECK` on update (`supabase/migrations/20260606150950_create_library_entries.sql:43-50`). **No migration is needed.** Metadata multi-value fields are arrays: `genre text[]`, `developer text[]`, `series text[]` (`…183408_enrich_library_entries_metadata.sql`). `play_status` is CHECK-constrained to the five enum values; `play_time_hours` is `integer >= 0` nullable; `date_bought` is `date` nullable.
- **Types (F-01)** — `src/types.ts` already exports `LibraryEntry`, `LibraryEntryUpdate`, `PlayStatus`, `PLAY_STATUSES`, `PLAY_STATUS_LABELS`, `MetadataStatus`, and `IgdbLookupResult`. No new entity types needed.
- **Enrichment (F-02)** — `lookupGameMetadata(title, platform, kv): Promise<IgdbLookupResult>` (`src/lib/services/igdb.ts`) returns `{status:'matched', …}` or `{status:'no_match'}`; empty input and IGDB/Twitch failures **throw**. The re-fetch button reuses this exact contract through a new lookup-only route.
- **Service (S-01)** — `src/lib/services/library.ts` owns `createLibraryEntry`, `listLibraryEntries`, `listUsedPlatforms`. This slice adds `updateLibraryEntry` + `deleteLibraryEntry` alongside them, following the same "take an authenticated client, let RLS isolate" shape.
- **Dialog seams (S-01)** — `AddGameDialog.tsx` funnels all post-save behavior through a single `save()` seam and takes a configurable trigger; its docblock explicitly says it is built "so when S-02 grows that body and adds an UPDATE path this shell becomes the unified add/edit dialog." `GameFormFields.tsx` is a controlled, presentational body with a **record-based** `values`/`onChange`/`errors` contract, designed "so S-02 can widen it to a full add/edit field set without breaking this contract." `PlatformCombobox.tsx` is reused unchanged.
- **Page (S-01)** — `src/pages/library/index.astro` server-renders a paginated (20/page, `?page=N` links) static table, newest-first, with a "No metadata" badge driven by `metadata_status`. The full entry row is available server-side (no GET endpoint exists, and none is added).
- **Test harness** — Vitest with a hand-rolled chainable Supabase mock (`src/lib/services/library.test.ts`); new service tests follow that pattern.

**Missing (this slice owns it):** no UPDATE/DELETE service functions or routes; no lookup-only enrichment route; no edit UI, no delete UI, no per-row actions on the table. `alert-dialog` and `select` shadcn primitives are not installed (only `button`, `command`, `dialog`, `input`, `label`, `popover` exist). No chip/tag input component.

### Key Discoveries:

- **RLS already covers update + delete** — `updateLibraryEntry`/`deleteLibraryEntry` just `.eq('id', id)`; RLS guarantees a user can only touch their own rows. A miss (wrong/foreign id) returns **zero affected rows**, which the service must translate into a 404 (Supabase does not error on a no-row update/delete).
- **`LibraryEntryUpdate` maps 1:1 onto editable columns** (`src/db/database.types.ts:74-91`) — all optional; `genre/developer/series` are `string[] | null`, `play_time_hours/length_hours/release_year` numeric-nullable, `date_bought/release_date` `string | null`.
- **The dialog/form seams make this an expansion, not a rebuild** — the headline is "grow the add dialog into add/edit," exactly as the roadmap S-02 design note directs. Add-mode behavior must stay byte-for-byte identical.
- **`metadata_status` means "did IGDB match," not "are metadata fields populated"** — it drives the "No metadata" badge. Keeping that meaning stable across manual edits is a deliberate decision (see Critical Implementation Details).
- **KV binding access** — per `context/foundation/lessons.md`, resolve `IGDB_TOKENS` via `import { env } from "cloudflare:workers"` inside the route, never `Astro.locals.runtime.env`.

## Desired End State

On `/library`, every row shows **Edit** and **Delete** actions. **Edit** opens the unified dialog pre-filled with the entry's current values across all editable fields; the user changes anything (including play status via a select and metadata via chip inputs), optionally clicks **Re-fetch metadata** to pull fresh IGDB data into the form for review, and **Save** persists via `PUT`. **Delete** — from the row or from inside the edit dialog — opens an AlertDialog confirm ("Delete *&lt;title&gt;*? This can't be undone."); confirming removes the entry. After any successful edit or delete the page reloads so the list reflects the change. Verify by: editing a title and seeing it update; manually correcting a `no_match` entry's genre; re-fetching metadata on a mistyped-then-fixed title; deleting an entry via both entry points and confirming it's gone; cancelling a delete; and confirming a second user can neither edit nor delete the first user's entries.

## What We're NOT Doing

- **No new migration** — F-01's schema and RLS (incl. update + delete policies) are sufficient.
- **No automatic re-enrichment** — title/platform edits never silently re-run IGDB; only the explicit **Re-fetch metadata** button does, and it populates the form for review rather than writing directly.
- **No GET endpoint / no fresh-fetch on edit-open** — the entry's current values come from the SSR page payload passed into the row island (consistent with S-01's "no GET endpoint" decision); acceptable staleness for a single-user app.
- **No optimistic in-place list updates** — mutations reload the page (the paginated SSR table owns the authoritative list). The whole-list-island / infinite-scroll architecture is explicitly out of scope; no roadmap slice needs it.
- **No inline-on-list play-status control** — `play_status` is editable **only in the dialog** this slice; the richer inline quick-set UX is S-04's headline (S-04 reuses this slice's select, it does not rebuild it).
- **No soft-delete / archive / undo** — FR-011 is a hard delete guarded by FR-020's confirm; both alternatives were rejected in the PRD.
- **No edits to `id`, `user_id`, or `created_at`** — system fields, never user-editable. `igdb_id` and `metadata_status` are enrichment-owned (set by re-fetch only), not free-form form fields.

## Implementation Approach

Three phases, bottom-up, mirroring S-01: (1) extend the service with update/delete and add three routes — `PUT`/`DELETE /api/library/[id]` plus a lookup-only `POST /api/library/lookup` that backs the re-fetch button without writing; (2) build the form/dialog layer — a chip `TagInput`, an `AlertDialog`-based `DeleteEntryDialog`, widen `GameFormFields` to a mode-gated full field set with the re-fetch button, and evolve `AddGameDialog` into the unified `GameDialog`; (3) wire it into the page with a per-row `EntryRowActions` island and an Actions column. The list and platform options keep being read server-side in the page; the only new API surface is the two `[id]` methods and the lookup route.

## Critical Implementation Details

- **`metadata_status` / `igdb_id` are enrichment-owned, not form fields.** Manual edits to genre/developer/series/length/year/release-date do **not** change `metadata_status` — so manually filling a `no_match` entry's fields does *not* clear its "No metadata" badge. Only **Re-fetch metadata** changes `igdb_id` + `metadata_status` (to `matched` on a hit). This keeps the badge meaning "IGDB matched this," not "these columns are non-empty." The form carries `igdb_id` and `metadata_status` as hidden state, mutated only by a successful re-fetch, and sent unchanged on a plain save.
- **Re-fetch on `no_match` must not destroy data.** A `matched` lookup fills the metadata fields in the form and stamps `igdb_id` + `metadata_status='matched'`. A `no_match` (or a thrown lookup error) shows an inline "No match found" message and **leaves every form field and the hidden status untouched** — the user keeps whatever they typed.
- **PUT is a full-row, last-write-wins update.** The form sends the complete editable field set; the service writes it as one `LibraryEntryUpdate`. Two concurrent edits → last save wins. Acceptable for a single-user library; noted as an accepted risk, not handled.
- **No-row update/delete is a 404, not a success.** Supabase returns no error when `.update()/.delete().eq('id', …)` matches zero rows (wrong id, or another user's row hidden by RLS). The service must request the affected rows back (`.select()`) and throw a typed not-found when empty so the route returns 404.
- **Add-mode must stay identical.** Widening `GameFormFields` and renaming the dialog must not change the add flow: in `mode='add'` only title + platform render and only `{title, platform}` POST to `/api/library`.

## Phase 1: Service + API layer (update, delete, lookup)

### Overview

Add the update/delete service functions and expose them — plus the lookup-only enrichment route the re-fetch button needs — over the existing RLS policies. No UI.

### Changes Required:

#### 1. Update + delete service functions

**File**: `src/lib/services/library.ts`

**Intent**: Own the UPDATE and DELETE queries so routes stay thin, matching the existing "authenticated client first arg, RLS isolates" shape. No enrichment here — re-fetch is a separate explicit flow.

**Contract**: Two new exports:
- `updateLibraryEntry(supabase, id: string, patch: LibraryEntryUpdate): Promise<LibraryEntry>` — `.update(patch).eq('id', id).select().single()`. Translate a no-row result (PostgREST `PGRST116` / empty data) into a thrown not-found rather than returning null, so the route can answer 404. Never writes `id`/`user_id`/`created_at`.
- `deleteLibraryEntry(supabase, id: string): Promise<void>` — `.delete().eq('id', id).select('id')`; if the returned set is empty, throw not-found (the route maps it to 404).

Use a small sentinel (e.g. an `EntryNotFoundError` class or a shared symbol) both functions throw, so routes can distinguish 404 from 500.

#### 2. Update + delete route

**File**: `src/pages/api/library/[id].ts` (new)

**Intent**: Expose update and delete for a single entry by id.

**Contract**: `export const prerender = false;` plus `PUT` and `DELETE` `APIRoute`s. Both: resolve `createClient(request.headers, cookies)` → 500 if null; 401 if `!locals.user`; read `params.id`. **PUT**: parse + zod-validate the body against the full editable field set (see schema below), call `updateLibraryEntry`, return `200 { entry }`; `400` on validation failure; `404` on not-found; `500` otherwise. **DELETE**: call `deleteLibraryEntry`, return `204` (no body); `404` on not-found; `500` otherwise.

#### 3. Update-request schema

**File**: `src/lib/validation/library.ts` (new) — or co-locate in the route; one shared schema reused by PUT.

**Intent**: Validate the full editable field set with correct nullability so the form and route agree on the contract.

**Contract**: A zod object: `title`/`platform` required trimmed non-empty; `play_status` ∈ `PLAY_STATUSES`; `play_time_hours` int `>= 0` nullable; `date_bought`/`release_date` nullable `YYYY-MM-DD` strings; `genre`/`developer`/`series` `string[]` (trim items, drop empties) nullable; `length_hours` number `>= 0` nullable; `release_year` int nullable; `igdb_id` number nullable; `metadata_status` ∈ `METADATA_STATUSES` nullable. Empty arrays normalize to `[]` (or `null`) consistently — pick one and document it. The inferred type must be assignable to `LibraryEntryUpdate`.

#### 4. Lookup-only enrichment route

**File**: `src/pages/api/library/lookup.ts` (new)

**Intent**: Run IGDB enrichment for a title+platform and return the result **without persisting** — backs the re-fetch button's "populate form for review" flow.

**Contract**: `export const prerender = false;` + `POST: APIRoute`. 401 if `!locals.user` (auth-gate the external call). Validate `{title, platform}` (both required, trimmed) → 400 on failure. Resolve KV via `import { env } from "cloudflare:workers"` → `env.IGDB_TOKENS`. Call `lookupGameMetadata(title, platform, env.IGDB_TOKENS)` in try/catch; return `200 { result: IgdbLookupResult }` on success, and on a thrown lookup error return `200 { result: { status: 'no_match' } }` (a flaky API degrades to "no match," never a 500 — same philosophy as S-01's create).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass for `updateLibraryEntry`: writes the patch, returns the row; **no-row result throws not-found** (not a silent success).
- Unit tests pass for `deleteLibraryEntry`: deletes by id; **no-row result throws not-found**.
- Unit test: the update schema accepts a full valid payload and rejects an empty title and an out-of-enum `play_status`.
- Production build succeeds: `npm run build`

#### Manual Verification:

- `PUT /api/library/[id]` with a valid full body returns `200` with the updated `entry`; changes persist on reload.
- `PUT` with an empty title returns `400`; `PUT` to a non-existent / another user's id returns `404`.
- `DELETE /api/library/[id]` returns `204` and the row is gone; a second `DELETE` of the same id returns `404`.
- `POST /api/library/lookup` with a known title+platform returns `200` `{ result: { status:'matched', … } }`; with junk returns `{ status:'no_match' }`; while signed out returns `401`.

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual API checks before proceeding.

---

## Phase 2: Form expansion + unified add/edit dialog

### Overview

Build the chip input and delete-confirm components, install the needed shadcn primitives, widen the form body to the full field set behind a mode flag, and grow `AddGameDialog` into the unified `GameDialog` that handles both add and edit (with re-fetch and an in-dialog delete). No page wiring yet.

### Changes Required:

#### 1. Install shadcn primitives

**File**: `src/components/ui/` (generated)

**Intent**: Provide the AlertDialog (delete confirm) and Select (play status) primitives.

**Contract**: `npx shadcn@latest add alert-dialog select`. No custom code beyond the CLI output. Date and numeric inputs reuse the existing `Input` via its `type` prop (`type="date"` / `type="number"`).

#### 2. Tag/chip input

**File**: `src/components/library/TagInput.tsx` (new)

**Intent**: Edit a `string[]` field (genre, developer, series) as add/remove pills.

**Contract**: Controlled, presentational. Props `{ value: string[]; onChange: (next: string[]) => void; placeholder?: string; id?: string }`. Enter or comma commits the typed token; Backspace on an empty input removes the last chip; each chip has a remove affordance. Case-insensitive dedupe on add; trims tokens; ignores empties. No fetch, no dialog.

#### 3. Delete-confirm dialog

**File**: `src/components/library/DeleteEntryDialog.tsx` (new)

**Intent**: The single FR-020 confirmation surface, reused by both the per-row Delete and the in-dialog Delete.

**Contract**: Built on shadcn `AlertDialog`. Props `{ entry: Pick<LibraryEntry, 'id' | 'title'>; trigger: ReactNode; onDeleted?: () => void }` (renders `trigger` inside `AlertDialogTrigger`). Body: "Delete *&lt;title&gt;*? This can't be undone." with Cancel + Delete actions. On Delete: `fetch('/api/library/${id}', { method:'DELETE' })`; on success call `onDeleted` (default: reload the current page, preserving `?page`); surface a failure inline and keep the dialog open. Disable the Delete action while pending.

#### 4. Widen the form body (mode-gated)

**File**: `src/components/library/GameFormFields.tsx`

**Intent**: Grow the presentational body from add (title + platform) to the full editable set, without breaking the record-based contract or add-mode rendering.

**Contract**: Widen `GameFormValues` to the full editable field set (`title`, `platform`, `play_status: PlayStatus`, `play_time_hours: number | null`, `date_bought: string | null`, `genre/developer/series: string[]`, `length_hours: number | null`, `release_year: number | null`, `release_date: string | null`, plus carried-but-not-rendered `igdb_id: number | null`, `metadata_status: MetadataStatus | null`). Add a `mode: 'add' | 'edit'` prop: `add` renders only Title + Platform (unchanged S-01 layout); `edit` additionally renders the play-status `Select` (labels from `PLAY_STATUS_LABELS`), play-time/length/year numeric `Input`s, date-bought/release-date `type="date"` `Input`s, three `TagInput`s, and a **Re-fetch metadata** button. The re-fetch button calls a passed `onRefetch` handler (the dialog owns the network call) and shows pending / "No match found" feedback via passed props. Keep all existing props (`onChange`, `errors`, `platformOptions`, `titleRef`, `platformContainer`).

#### 5. Unified add/edit dialog

**File**: `src/components/library/AddGameDialog.tsx` → rename to `src/components/library/GameDialog.tsx`

**Intent**: Become the single dialog for both add and edit, per the roadmap S-02 design note ("unified add/edit dialog, not a separate edit screen").

**Contract**: Add an optional `entry?: LibraryEntry` prop. **Absent → add mode** (current behavior preserved exactly: title+platform, POST `/api/library`, Save / Save-&-add-another, default "Add game" trigger). **Present → edit mode**: initialize `values` from `entry` (arrays default to `[]`, nulls preserved); render `GameFormFields mode='edit'`; the footer shows **Save** (PUT `/api/library/${entry.id}` with the full validated body) and a **Delete** button that mounts `DeleteEntryDialog`; **no "Save & add another"** in edit mode. Add a `mapEntryToValues`/`mapValuesToBody` pair so the row↔form↔request mapping lives in one place. Wire `onRefetch`: POST `/api/library/lookup` with the current title+platform, and on `{status:'matched'}` patch the metadata fields + `igdb_id` + `metadata_status` into `values`; on `no_match`/error set the inline "No match found" state and leave `values` untouched. On successful Save (edit) reload the current page (preserve `?page`). Keep the single post-save `save()` seam.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- In add mode the dialog is unchanged: only Title + Platform, Save / Save-&-add-another still work end-to-end.
- In edit mode all fields render pre-filled; the play-status select offers the five labels; chip inputs add/remove genre/developer/series values.
- **Re-fetch metadata** on a matched title fills the metadata fields for review; on a junk title shows "No match found" and leaves typed values intact.
- The in-dialog **Delete** opens the AlertDialog and (on confirm) removes the entry.

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual UI checks before proceeding.

---

## Phase 3: Page integration (per-row islands)

### Overview

Make each library row interactive with Edit/Delete actions via a per-row React island, and update the page to mount the renamed dialog. The table stays server-rendered; only the actions hydrate.

### Changes Required:

#### 1. Per-row actions island

**File**: `src/components/library/EntryRowActions.tsx` (new)

**Intent**: The per-row interactive surface — an Edit trigger (opens `GameDialog` in edit mode for this entry) and a Delete trigger (opens `DeleteEntryDialog`).

**Contract**: Props `{ entry: LibraryEntry; platformOptions: string[] }`. Renders an **Edit** button mounting `<GameDialog entry={entry} platformOptions={platformOptions} />` (its trigger is the Edit button) and a **Delete** button mounting `<DeleteEntryDialog entry={entry} trigger={…} />`. Both default their success handler to reloading the current page (preserving `?page`). Compact, icon+label buttons sized for a table cell.

#### 2. Mount actions per row + update imports

**File**: `src/pages/library/index.astro`

**Intent**: Add an Actions column and mount the island per row; switch the header/empty-state add buttons to the renamed component.

**Contract**: Update the import from `AddGameDialog` to `GameDialog` (default export); the header and empty-state usages stay add-mode (no `entry` prop) and keep their `triggerLabel`/`triggerSize`. Add a trailing **Actions** `<th>` and, per row, a `<td>` mounting `<EntryRowActions entry={entry} platformOptions={platformOptions} client:visible />`. Pass the full `entry` object (already available in the map). No GET endpoint; no change to `listLibraryEntries`/`listUsedPlatforms` calls or pagination.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Each row shows Edit + Delete; Edit opens the pre-filled dialog and a saved change appears after the reload, on the correct page.
- Editing a `no_match` entry's metadata by hand persists the values but leaves the "No metadata" badge as-is (badge only clears after a successful Re-fetch).
- Row **Delete** → confirm removes the entry; **Cancel** leaves it; deleting the last entry on a page lands on a valid page (no empty broken page beyond bounds — verify the reload target).
- A second user cannot edit or delete the first user's entries (PUT/DELETE return 404 under RLS).
- Add flow (header button and empty-state) still works unchanged.

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual UI/RLS checks. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- `updateLibraryEntry`: patch is written and the updated row returned; **zero-row result throws the not-found sentinel** (not a silent resolve).
- `deleteLibraryEntry`: deletes by id; **zero-row result throws not-found**.
- Update schema: accepts a full valid payload; rejects empty title, out-of-enum `play_status`, negative `play_time_hours`; normalizes/ trims array items and drops empties.

### Integration / Manual Testing Steps:

1. Add a known game (S-01 path) → confirm add flow unaffected.
2. Edit its title + platform, save → list shows the change after reload.
3. On a `no_match` entry, hand-fill genre/developer via chips, save → values persist, "No metadata" badge unchanged.
4. Fix a mistyped title, click Re-fetch → metadata fields populate; save → badge clears (matched).
5. Re-fetch a junk title → "No match found", typed values intact.
6. Delete an entry from the row; cancel once, then confirm → entry gone.
7. Delete an entry from inside the edit dialog → entry gone.
8. As a second user, attempt PUT/DELETE against user 1's id (via devtools) → 404.

## Performance Considerations

Edit/delete are single-row writes over the `user_id`-indexed table — negligible. Re-fetch makes the same up-to-2 IGDB calls as an add (Twitch token KV-cached by F-02). Reload-after-mutation re-runs the existing paginated list query (one ranged `count: 'exact'` query) — fine at the 50–few-hundred-entry scale. Per-row islands hydrate only on `client:visible`; the dialog JS bundle is shared, not duplicated per row.

## Migration Notes

None — F-01's schema and RLS policies (including update + delete) are sufficient. No production migration ships with this slice.

## References

- Roadmap slice + design note: `context/foundation/roadmap.md` (S-02)
- PRD: FR-010 (edit any field), FR-011 (delete), FR-020 (confirm), FR-006 (auto-save correction path) — `context/foundation/prd.md`
- S-01 plan (seams this slice extends): `context/archive/2026-06-10-manual-add-and-browse/plan.md`
- Service to extend: `src/lib/services/library.ts`
- Dialog/form seams: `src/components/library/AddGameDialog.tsx`, `GameFormFields.tsx`
- Enrichment contract: `src/lib/services/igdb.ts` (`lookupGameMetadata`)
- RLS policies: `supabase/migrations/20260606150950_create_library_entries.sql:43-50`
- KV access rule: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Service + API layer (update, delete, lookup)

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 924524b
- [x] 1.2 Linting passes: `npm run lint` — 924524b
- [x] 1.3 Unit tests pass for `updateLibraryEntry` (writes patch, returns row, no-row→throws not-found) — 924524b
- [x] 1.4 Unit tests pass for `deleteLibraryEntry` (deletes by id, no-row→throws not-found) — 924524b
- [x] 1.5 Unit test: update schema accepts valid payload, rejects empty title + out-of-enum play_status — 924524b
- [x] 1.6 Production build succeeds: `npm run build` — 924524b

#### Manual

- [x] 1.7 `PUT /api/library/[id]` valid body returns 200 with updated entry; persists on reload — 924524b
- [x] 1.8 `PUT` empty title returns 400; `PUT` to non-existent/foreign id returns 404 — 924524b
- [x] 1.9 `DELETE /api/library/[id]` returns 204 and removes the row; repeat DELETE returns 404 — 924524b
- [x] 1.10 `POST /api/library/lookup` returns matched for known, no_match for junk, 401 signed out — 924524b

### Phase 2: Form expansion + unified add/edit dialog

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — e2a25d6
- [x] 2.2 Linting passes: `npm run lint` — e2a25d6
- [x] 2.3 Production build succeeds: `npm run build` — e2a25d6

#### Manual

- [x] 2.4 Add mode unchanged: only Title + Platform; Save / Save-&-add-another work — e2a25d6
- [x] 2.5 Edit mode renders all fields pre-filled; play-status select + chip inputs work — e2a25d6
- [x] 2.6 Re-fetch fills metadata on match; shows "No match found" and keeps typed values on junk — e2a25d6
- [x] 2.7 In-dialog Delete opens the AlertDialog and removes the entry on confirm — e2a25d6

### Phase 3: Page integration (per-row islands)

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — f83d40e
- [x] 3.2 Linting passes: `npm run lint` — f83d40e
- [x] 3.3 Production build succeeds: `npm run build` — f83d40e

#### Manual

- [x] 3.4 Each row shows Edit + Delete; Edit opens pre-filled dialog; saved change appears on correct page after reload — f83d40e
- [x] 3.5 Hand-edited metadata on a no_match entry persists but badge stays until a successful Re-fetch — f83d40e
- [x] 3.6 Row Delete confirm removes entry; Cancel leaves it; deleting last row on a page lands on a valid page — f83d40e
- [x] 3.7 A second user cannot edit or delete user 1's entries (PUT/DELETE 404 under RLS) — f83d40e
- [x] 3.8 Add flow (header + empty-state) still works unchanged — f83d40e
