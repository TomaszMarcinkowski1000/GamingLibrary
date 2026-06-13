# Mark a game with a play status (+ optional play time) — Plan Brief

> Full plan: `context/changes/mark-play-status/plan.md`

## What & Why

Let a collector mark where they are with each game — Not played / Playing now / Played / Completed / 100% completed — and optionally log play time in hours, straight from the library list and without a page reload. It's roadmap slice S-04 (US-02, FR-013, FR-014) and is **load-bearing downstream**: the status filter (S-06) and the recommender (S-07) both consume play status.

## Starting Point

The data model is already complete from F-01/S-02: the `play_status` column (5-value CHECK, default `not_played`) and a nullable `play_time_hours` column exist, the `PlayStatus` enum + labels exist, the service does partial patches, and a full-replace `PUT /api/library/[id]` is live. S-02 even put status/play-time fields in the edit dialog. But status is **never shown on the list**, there is **no quick way to change it**, and every mutation does a full `window.location.reload()`.

## Desired End State

Every library row shows a colored status badge. Click it → menu of the five statuses → the badge updates instantly (optimistic) and persists in the background, no reload. Marking a game finished pops a small optional "hours" field on the row. A failed save quietly rolls the badge back and shows an inline error.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where status is set | Status **badge → menu** on each row | Delivers the slice's distinct value (fast set/change/clear) vs the existing dialog-only path | Plan |
| Update API | New **partial `PATCH`** endpoint | Avoids resending the whole entry (and clobbering risk) since `PUT`'s schema is all-required | Plan |
| Reflecting the change | **Optimistic** local update + rollback | Matches the "without a full page reload" criterion exactly | Plan |
| Play time (FR-014) | **Prompt on finished transitions**, skippable | Captures hours at the natural moment while respecting it as a nice-to-have | Plan |
| Hours prompt UI | Small **inline popover** on the row | Stays in the fast inline flow; reuses the popover already in the codebase | Plan |
| On save failure | **Revert + inline error** | Honest feedback, consistent with existing dialog errors, no new toast infra | Plan |

## Scope

**In scope:** display status on the list; inline set/change/clear; partial `PATCH`; no-reload optimistic update with rollback; optional play-time capture on finished transitions.

**Out of scope:** filtering/sorting by status (S-06); bulk edits; removing dialog fields; a toast system; required play time; recommender logic (S-07); converting the list to a client component.

## Architecture / Approach

The SSR library table stays server-rendered; only a new **Status cell** hydrates as a per-row React island (`PlayStatusControl`, `client:visible`) — the same seam `EntryRowActions` already uses. That island owns the optimistic value, the status menu, the `PATCH` call, rollback/error, and the Phase-3 hours popover. Backend adds one thin `PATCH /api/library/[id]` route over the existing partial-patch service.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Partial-update API | `PATCH /api/library/[id]` + partial zod schema | Partial semantics: omitted field vs explicit `null` clear |
| 2. Inline control + display | Status badge/menu island, new column, optimistic + rollback, no reload | Keeping the hydrated cell consistent with SSR initial render |
| 3. Play-time prompt | Optional hours popover on finished transitions, single combined PATCH | Sequencing optimistic badge → popover → one PATCH (not two) |

**Prerequisites:** none open — F-01 + S-01 done; data model, service, and PUT already exist. `dropdown-menu` shadcn component needs installing (Phase 2).
**Estimated effort:** ~1–2 focused sessions across the three phases.

## Open Risks & Assumptions

- No automated test framework in the repo; lint + build are the only automated gates, so verification leans on the per-phase manual checks.
- "Clear a play status" = set back to "Not played" (the column is `NOT NULL DEFAULT 'not_played'` — no nullable state).
- The status/play-time fields stay in the edit dialog as harmless redundancy; this slice does not touch them.

## Success Criteria (Summary)

- A user can set, change, and clear play status from the library list with the badge updating immediately and no page reload, and the value persisting on refresh.
- Marking a game finished optionally captures play time in hours via a skippable inline prompt.
- A failed save reverts the badge and tells the user, with no partial write.
