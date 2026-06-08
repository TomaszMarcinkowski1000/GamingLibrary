---
change_id: igdb-metadata-enrichment
title: IGDB metadata enrichment — lookup by title + platform returns the 5 metadata fields
status: implemented
created: 2026-06-07
updated: 2026-06-08
archived_at: null
---

## Notes

Seeded from `context/foundation/roadmap.md` → **F-02: IGDB metadata enrichment**.

- **Outcome:** a server-side lookup that, given a title + platform, returns the five metadata fields (genre, overall length, release year, developer, release date) from IGDB, with a graceful "no match" result. Not user-facing on its own.
- **PRD refs:** FR-008 (eager enrichment at save time); supports US-03's length/recency ranking inputs.
- **Unlocks:** S-01 (enrich on manual save), S-03 (enrich on photo save), S-07 (length + release-date + de-prioritization inputs for the recommender).
- **Prerequisites:** — (parallel with F-01, F-03).

**Unknowns (from roadmap):**
- IGDB/Twitch API credentials must be registered (self-serve developer app) before the lookup can run — Owner: user. Block: no (planning + scaffolding can proceed; only live calls need the key).
- Does IGDB reliably return an *overall length* value per title+platform (the recommender's length bucket depends on it)? — Owner: team. Block: no (handle missing length as "unbucketed"; S-07 absorbs the gap).

**Risk:** Made a foundation rather than folded into S-01 because three slices consume it and it carries an external integration with its own setup. Keep minimal — one lookup contract, not "all integrations."

## Decisions

Resolved during external research (see `external-research.md`):

- **Add `series` to the stored metadata.** Sourced from IGDB `games.collections.name` (plural — the singular `collection` field is deprecated). Collection = IGDB's "Series"; Franchise (cross-media) is deliberately *not* used.
- **Multi-valued fields stored as `text[]`:** `genre`, `developer`, `series`. IGDB returns all three as arrays (genres, involved_companies with `developer=true`, collections). Co-developed games (multiple studios with `developer=true`) are therefore preserved, not flattened.
- **Keep both `release_date` and `release_year`** with distinct semantics: `release_date` = per-platform precise date (from `release_dates`, for the matched platform); `release_year` = global first-release year (from `first_release_date`, the recency signal for S-07/US-03 ranking). Also justified by IGDB date-precision flags — a year may be known when an exact date isn't.
- **Schema impact:** these change `public.library_entries`, which belongs to the already-closed foundation **F-01 (library-entry-store)**. Implemented as a *new* migration under this change (`YYYYMMDDHHmmss_...`), not an edit to F-01's migration. F-02 amends F-01's schema by design.
