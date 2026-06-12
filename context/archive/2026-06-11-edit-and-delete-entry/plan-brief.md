# Edit & Delete a Library Entry (S-02) — Plan Brief

> Full plan: `context/changes/edit-and-delete-entry/plan.md`

## What & Why

Let a user edit **any field** of a library entry and **delete** an entry behind a confirmation step (FR-010 / FR-011 / FR-020). This is the correction path the photo auto-save (S-03 / FR-006) depends on — S-03 auto-saves identifications and relies on edit/delete to fix the ≤10% it gets wrong — so it must land before the north star.

## Starting Point

S-01 shipped add-and-browse and **deliberately left seams for this slice**: `AddGameDialog` is built to become a unified add/edit dialog, `GameFormFields` is a record-based body designed to widen to a full field set, and the service layer owns the data queries. F-01's table already has RLS **UPDATE and DELETE policies** — no migration needed. The `/library` page is a static, paginated SSR table with no per-row interactivity yet.

## Desired End State

Every row on `/library` shows **Edit** and **Delete**. Edit opens the same dialog used to add, now pre-filled with all editable fields (incl. a play-status select, chip inputs for genre/developer/series, and a **Re-fetch metadata** button). Delete — from the row or inside the edit dialog — opens an AlertDialog confirm; confirming removes the entry. Any successful mutation reloads the list.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Editable field set | All fields, incl. hand-editable metadata | FR-010 says "any field" and it's the FR-006 correction path. | Plan |
| Re-enrichment | Manual **Re-fetch** button → populates form for review (no auto re-run, no direct write) | User reviews before committing; no surprise overwrites. | Plan |
| play_status placement | In the edit dialog now; S-04 reuses this control | Satisfies "any field" without rebuilding S-04's inline UX. | Roadmap + Plan |
| Delete confirm | shadcn AlertDialog modal | Purpose-built, accessible, clearly interruptive per FR-020. | Plan |
| Row actions | Per-row React island + reload after mutation | Server owns the paginated list; minimal hydration, no client list-state. | Plan |
| Extra delete entry point | Delete button inside the edit dialog too (shared confirm) | User request; one shared `DeleteEntryDialog`. | Plan |
| Array field input | Tag/chip input | Clearer multi-value affordance. | Plan |
| Dialog shape | Unified add/edit dialog, not a separate edit screen | Settled by the roadmap S-02 design note. | Roadmap |

## Scope

**In scope:** UPDATE + DELETE service functions and routes; a lookup-only enrichment route for re-fetch; the unified add/edit dialog with the full field set; chip input + delete-confirm components; per-row Edit/Delete actions on the list.

**Out of scope:** new migration; automatic re-enrichment; GET endpoint / fresh-fetch on edit-open; optimistic in-place list updates or infinite scroll; inline-on-list play-status (S-04); soft-delete/archive/undo; editing `id`/`user_id`/`created_at`.

## Architecture / Approach

Bottom-up, mirroring S-01. **Service** (`library.ts`) gains `updateLibraryEntry` + `deleteLibraryEntry` (RLS isolates; zero-row → 404). **Routes**: `PUT`/`DELETE /api/library/[id]` and a no-write `POST /api/library/lookup`. **UI**: widen `GameFormFields` behind a `mode` flag, evolve `AddGameDialog` → `GameDialog` (an optional `entry` prop switches to edit mode), add a `TagInput` and a reusable `DeleteEntryDialog`, and mount a per-row `EntryRowActions` island in the SSR table. Entry data flows from the SSR payload into the row island as props — no GET endpoint.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Service + API | update/delete functions, `[id]` PUT/DELETE, lookup route, unit tests | Translating Supabase's silent zero-row update/delete into a real 404 |
| 2. Form + unified dialog | TagInput, DeleteEntryDialog, widened mode-gated form, `GameDialog` | Widening the form/dialog without altering add-mode behavior |
| 3. Page integration | per-row `EntryRowActions` island + Actions column | Reload target staying on a valid page after deleting the last row on a page |

**Prerequisites:** F-01 (done), S-01 (done). No external setup beyond the IGDB key already used by S-01.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- `metadata_status`/`igdb_id` are enrichment-owned: hand-editing metadata does **not** clear the "No metadata" badge — only a successful Re-fetch does. Deliberate, documented; verify it reads as intended in manual testing.
- PUT is full-row last-write-wins; concurrent edits in two tabs lose one — accepted for a single-user app.
- Re-fetch on `no_match` must leave typed values intact (never wipe user input).
- S-04 must **reuse**, not rebuild, the play-status select introduced here.

## Success Criteria (Summary)

- A user can change any field of an entry and see it persist; can correct a mis-identified entry by hand or via Re-fetch.
- A user can delete an entry only after an explicit confirm, from either the row or the edit dialog.
- A second user can never edit or delete another user's entries (RLS → 404), and the S-01 add flow is unchanged.
