# Mark a game with a play status (+ optional play time) — Implementation Plan

## Overview

Let the user set, change, or clear a play status ("Playing now", "Played", "Completed", "100% completed", and back to "Not played") directly on a library-list row, and — when a game is marked finished — optionally record play time in hours. Changes reflect **without a full page reload**.

This is a frontend-led slice: the data model, service, and a full-replace `PUT` endpoint already exist from S-02. The new work is (1) a lean partial-update endpoint, (2) an inline status control with a status display on the list, and (3) an optional play-time capture at the moment a game is finished.

## Current State Analysis

What already exists (built across F-01 and S-02) — do **not** rebuild:

- **Schema:** `library_entries.play_status text NOT NULL DEFAULT 'not_played'` with a CHECK constraint on exactly `('not_played','playing_now','played','completed','completed_100')`; `play_time_hours integer CHECK (play_time_hours >= 0)` nullable (`supabase/migrations/20260606150950_create_library_entries.sql:11-13`).
- **Types:** `PlayStatus` enum, `PLAY_STATUSES`, and user-facing `PLAY_STATUS_LABELS` (`src/types.ts:25-36`).
- **Service:** `updateLibraryEntry(supabase, id, patch)` already accepts a partial `LibraryEntryUpdate` and does a true partial patch with `EntryNotFoundError` on a missing row (`src/lib/services/library.ts:109-123`).
- **API:** `PUT /api/library/[id]` validates the **full** editable set via `updateEntrySchema` (all-required `z.object`, `src/lib/validation/library.ts:32-46`); `DELETE` also lives there (`src/pages/api/library/[id].ts`).
- **Dialog:** `GameFormFields` already renders a `play_status` Select and a `play_time_hours` number input — but only in `mode === "edit"` inside `GameDialog` (`src/components/library/GameFormFields.tsx:109-156`). `GameDialog` mutates via `PUT` then `window.location.reload()`.
- **List:** `src/pages/library/index.astro` is server-rendered. The table columns are Title / Platform / Genre / Year / Actions (`index.astro:120-153`). Each row mounts a per-row React island `EntryRowActions` (`client:visible`) in the Actions cell (`index.astro:147`, `src/components/library/EntryRowActions.tsx`).

What's missing (the S-04 delta):

- Play status is **never displayed** on the list.
- There is **no fast inline way** to change status — only the full edit dialog.
- Every mutation triggers `window.location.reload()` — the opposite of "reflects without a full page reload."

### Key Discoveries

- The per-row island seam (`EntryRowActions`, `client:visible`) means we can add a hydrated **status cell** without converting the whole SSR table to a client component (`index.astro:131-151`).
- `updateEntrySchema` is fully required, so a status-only change cannot reuse `PUT` without resending every field — hence a dedicated partial `PATCH` (`src/lib/validation/library.ts:32-46`).
- The service layer already supports partial patches (`updateLibraryEntry`, `src/lib/services/library.ts:109`), so the `PATCH` route is thin.
- shadcn `popover` and `command` are installed (used by `PlatformCombobox`); `dropdown-menu` and `badge` are **not** yet installed (`src/components/ui/`).
- "Clear a play status" maps to selecting **"Not played"** — the column is `NOT NULL DEFAULT 'not_played'`, so there is no nullable state to model.

## Desired End State

On the library list, every row shows its current play status as a colored badge. Clicking the badge opens a small menu of the five statuses; picking one updates the badge **immediately** (optimistically) and persists via a background `PATCH`, with no page reload. If the chosen status is a "finished" one (Played / Completed / 100% completed), a compact inline popover offers an optional play-time-in-hours field with Save and Skip; the status commits regardless. A failed save rolls the badge back to its previous value and shows a brief inline error on the row.

Verify by: changing a status on the list and seeing the badge update with no reload and the value surviving a manual refresh; marking a game "Completed", entering hours, and confirming both persist; simulating a server error and seeing the badge revert with an error message.

## What We're NOT Doing

- **Filtering or sorting by status** — that is S-06 (`filter-and-sort-library`). This slice only sets and displays status.
- **Bulk / multi-row status edits.**
- **Removing the status/play-time fields from the edit dialog** — they stay (harmless redundancy; the dialog remains the full-edit surface).
- **A toast notification system** — failures use an inline message, consistent with the dialogs.
- **Required play time** — FR-014 is a nice-to-have; the hours prompt is always skippable.
- **Recommender or 100%-complete de-prioritization logic** — that consumes status in S-07.
- **Changing the SSR list to a fully client-rendered list** — only the status cell hydrates.

## Implementation Approach

Build bottom-up in three independently verifiable phases: a lean partial-update endpoint first, then the inline control + display that delivers the core outcome, then the optional play-time capture on top. The status cell becomes a new per-row React island (`PlayStatusControl`) that owns the optimistic value, the menu, the PATCH call, rollback/error, and (Phase 3) the hours popover — so all related state lives in one component rather than being threaded through the SSR page.

## Critical Implementation Details

- **State sequencing (Phase 3):** when a finished status is picked, set the optimistic badge to the new status _immediately_, then open the hours popover. The `PATCH` fires on the popover's Save (with `play_time_hours`) or Skip / dismiss (without it) — one `PATCH` per change, never two. For non-finished statuses there is no popover and the `PATCH` fires right away. This keeps the badge instant while still bundling status + hours into a single request.
- **Partial semantics:** the `PATCH` body must distinguish "field omitted" (leave unchanged) from `play_time_hours: null` (explicitly clear). Use an optional key for omission and allow an explicit `null` value — do not coerce a missing key to null.

## Phase 1: Partial-update API (PATCH /api/library/[id])

### Overview

Add a partial-update endpoint so an inline status change sends only the fields it owns, without resending (and risking clobbering) the full entry.

### Changes Required:

#### 1. Partial update validation schema

**File**: `src/lib/validation/library.ts`

**Intent**: Add a `patchEntrySchema` for partial updates carrying only the fields this slice mutates, leaving the existing full-replace `updateEntrySchema` untouched.

**Contract**: `patchEntrySchema = z.object({ play_status: z.enum(PLAY_STATUSES).optional(), play_time_hours: z.number().int().min(0).nullable().optional() }).refine(at least one key present)`. `play_status` optional (omitted = unchanged); `play_time_hours` optional and independently nullable (present-null = clear, omitted = unchanged). Reject an empty body.

#### 2. PATCH handler

**File**: `src/pages/api/library/[id].ts`

**Intent**: Add a `PATCH` export mirroring the existing `PUT` (auth guard, JSON parse, zod validate, call service, map `EntryNotFoundError` → 404) but validating with `patchEntrySchema` and passing only the provided fields to `updateLibraryEntry`.

**Contract**: `export const PATCH: APIRoute`. 200 with `{ entry }` on success; 400 invalid body; 401 unauthenticated; 404 `EntryNotFoundError`; 500 otherwise. `prerender = false` already set on the file. Reuses `updateLibraryEntry` (`src/lib/services/library.ts:109`) unchanged.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes (type-checks the route + schema): `npm run build`

#### Manual Verification:

- `PATCH /api/library/<id>` with `{ "play_status": "playing_now" }` returns 200 and the updated entry; the value persists on reload.
- `PATCH` with `{ "play_time_hours": 12 }` updates only hours, leaving status unchanged.
- `PATCH` with an empty body `{}` returns 400.
- `PATCH` against a non-existent id returns 404; against another user's entry returns 404 (RLS).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Inline status control + display (no reload)

### Overview

Add a "Status" column to the library list whose cell is a hydrated badge-plus-menu control. Picking a status updates the badge optimistically, persists via the Phase 1 `PATCH`, and rolls back with an inline error on failure. Delivers the core slice outcome (set/change/clear status, no reload).

### Changes Required:

#### 1. Install the dropdown-menu primitive

**File**: `src/components/ui/dropdown-menu.tsx` (generated)

**Intent**: Add the shadcn `dropdown-menu` component used for the status-pick menu.

**Contract**: `npx shadcn@latest add dropdown-menu` (new-york variant, per project convention). No manual edits to the generated file.

#### 2. Status badge presentation helper

**File**: `src/components/library/playStatus.ts` (new) or colocated in the control

**Intent**: Map each `PlayStatus` to a Tailwind badge class set (color per status, in the existing cosmic palette) and reuse `PLAY_STATUS_LABELS` for text. Centralizes the color mapping so the SSR initial render and the island agree.

**Contract**: `playStatusBadgeClass(status: PlayStatus): string`. Distinct, accessible-contrast styles for the five values (e.g. neutral for `not_played`, accent for `playing_now`, success tones for the finished trio). Labels come from `PLAY_STATUS_LABELS` (`src/types.ts:31`).

#### 3. PlayStatusControl island

**File**: `src/components/library/PlayStatusControl.tsx` (new)

**Intent**: Per-row React island rendering the current status as a badge that triggers a `DropdownMenu` of the five statuses. On selection: optimistically set local status, call `PATCH /api/library/[id]` with `{ play_status }`, and on failure revert to the prior value and surface an inline error. (Phase 3 extends this with the hours popover.)

**Contract**: `function PlayStatusControl({ entry }: { entry: LibraryEntry })`. Local state seeded from `entry.play_status`. Menu items from `PLAY_STATUSES` labeled via `PLAY_STATUS_LABELS`, current value indicated. Uses `fetch` directly (matching `GameDialog`'s pattern — no shared mutation hook exists). Error message rendered adjacent to the badge; control disabled while a request is in flight only insofar as needed to prevent overlapping writes. **No `window.location.reload()`.**

#### 4. Mount the control in a new Status column

**File**: `src/pages/library/index.astro`

**Intent**: Add a "Status" column header and a cell rendering `<PlayStatusControl entry={entry} client:visible />` for each row, between existing columns (e.g. after Platform).

**Contract**: New `<th>Status</th>` in the table head (`index.astro:121-128`) and a matching `<td>` in the row map (`index.astro:131-151`) mounting the island with `client:visible` (same hydration strategy as `EntryRowActions`). Import added at the top alongside `EntryRowActions`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes: `npm run build`
- Formatting clean: `npm run format`

#### Manual Verification:

- Each row shows a colored badge with the correct current status on initial SSR load.
- Clicking the badge opens a menu of all five statuses with the current one indicated.
- Selecting a status updates the badge immediately with **no page reload**; the new value survives a manual refresh.
- Selecting "Not played" clears a previously-set status.
- With the network throttled/offline, a failed change reverts the badge and shows an inline error.
- Adding a new game (which reloads to the list) shows the new row with a "Not played" badge.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Play-time prompt on finished transitions (FR-014)

### Overview

When the user marks a game Played, Completed, or 100% completed from the inline menu, offer an optional play-time-in-hours field via a small popover anchored to the row. Saving or skipping both commit the status; entering hours folds `play_time_hours` into the same `PATCH`.

### Changes Required:

#### 1. Hours popover in PlayStatusControl

**File**: `src/components/library/PlayStatusControl.tsx`

**Intent**: When a selected status is one of `played | completed | completed_100`, optimistically set the badge, then open a `Popover` containing an hours number input with Save and Skip. Save sends `PATCH { play_status, play_time_hours }`; Skip / dismiss sends `PATCH { play_status }`. Non-finished selections keep the Phase 2 immediate-PATCH behavior. Seed the input from the entry's existing `play_time_hours`.

**Contract**: Reuses the installed `Popover` (`src/components/ui/popover.tsx`). Finished-status set defined as a constant (`played`, `completed`, `completed_100`). Hours input `type="number" min={0}`, empty → omit `play_time_hours` (not null). Exactly one `PATCH` per status change (never a status PATCH followed by a separate hours PATCH). Same optimistic-rollback + inline-error path as Phase 2 on failure.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Selecting "Completed" (or Played / 100% completed) shows the hours popover; entering 15 and Saving persists both status and hours (verified on refresh).
- Skipping (or dismissing) the popover commits the status with play time unchanged.
- Selecting "Playing now" or "Not played" does **not** open the popover and commits immediately.
- Re-opening the popover for an entry that already has hours pre-fills the existing value.
- A failed Save reverts the badge and shows the inline error; play time is not partially written.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- No automated test harness exists in the repo today (lint + build are the automated gates); follow the existing convention rather than introducing a framework in this slice.
- If a `patchEntrySchema` unit check is cheap to add inline with any existing validation tests, cover: status-only body, hours-only body, explicit `play_time_hours: null`, and empty-body rejection.

### Integration Tests:

- Manual end-to-end against local Supabase (`npx supabase start`) per the per-phase manual criteria.

### Manual Testing Steps:

1. Load `/library` with several entries; confirm each shows a status badge.
2. Change a status via the menu; confirm instant badge update, no reload, persistence on refresh.
3. Mark a game Completed; enter hours; confirm both persist. Repeat and Skip; confirm status-only.
4. Throttle the network (DevTools offline) and change a status; confirm rollback + inline error.
5. Confirm "Not played" clears a status, and that filtering/sorting is absent (out of scope).

## Performance Considerations

Each row hydrates one additional small island (`client:visible`, so off-screen rows defer). For the 20-row page size this is negligible. The `PATCH` writes a single row by primary key under existing RLS — no new query cost.

## Migration Notes

None — no schema change. `play_status` and `play_time_hours` columns and constraints already exist (F-01).

## References

- Roadmap slice S-04: `context/foundation/roadmap.md:154-164`
- Change identity: `context/changes/mark-play-status/change.md`
- S-02 design note on the dialog/inline/both decision: `context/foundation/roadmap.md:137`
- Existing per-row island pattern: `src/components/library/EntryRowActions.tsx`
- Update service (partial patch): `src/lib/services/library.ts:109`
- Existing PUT + validation: `src/pages/api/library/[id].ts`, `src/lib/validation/library.ts:32-46`
- Status types/labels: `src/types.ts:25-36`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Partial-update API (PATCH /api/library/[id])

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — d5e2120
- [x] 1.2 Build passes: `npm run build` — d5e2120

#### Manual

- [x] 1.3 PATCH with `{ play_status }` returns 200 and persists — d5e2120
- [x] 1.4 PATCH with `{ play_time_hours }` updates only hours — d5e2120
- [x] 1.5 PATCH with empty body returns 400 — d5e2120
- [x] 1.6 PATCH against missing / other-user id returns 404 — d5e2120

### Phase 2: Inline status control + display (no reload)

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — b8f2b80
- [x] 2.2 Build passes: `npm run build` — b8f2b80
- [x] 2.3 Formatting clean: `npm run format` — b8f2b80

#### Manual

- [x] 2.4 Each row shows correct status badge on SSR load — b8f2b80
- [x] 2.5 Badge menu opens with all five statuses, current indicated — b8f2b80
- [x] 2.6 Selecting a status updates immediately with no reload; survives refresh — b8f2b80
- [x] 2.7 Selecting "Not played" clears a previously-set status — b8f2b80
- [x] 2.8 Failed change reverts badge and shows inline error — b8f2b80
- [x] 2.9 Newly added game row shows "Not played" badge — b8f2b80

### Phase 3: Play-time prompt on finished transitions (FR-014)

#### Automated

- [x] 3.1 Linting passes: `npm run lint` — 057a91f
- [x] 3.2 Build passes: `npm run build` — 057a91f

#### Manual

- [x] 3.3 Finished status opens hours popover; Save persists status + hours — 057a91f
- [x] 3.4 Skip/dismiss commits status only — 057a91f
- [x] 3.5 Non-finished statuses commit immediately, no popover — 057a91f
- [x] 3.6 Popover pre-fills existing hours — 057a91f
- [x] 3.7 Failed Save reverts badge + inline error; no partial write — 057a91f
