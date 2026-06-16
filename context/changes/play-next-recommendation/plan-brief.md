# "What should I play next?" Recommendation — Plan Brief

> Full plan: `context/changes/play-next-recommendation/plan.md`

## What & Why

Build the PRD's reason-to-exist (US-03, FR-015/016/018): a **deterministic recommender** that ranks games from the user's own library, biased by a multi-select length-bucket dial and one of three novelty modes (new releases / newly bought / comfort). The collector with 50+ titles freezes in front of the shelf; a spreadsheet can't help them choose. This feature makes the "decide what to play next under stated constraints" decision for them.

## Starting Point

The library is fully populated and editable (S-01, S-02, S-04 done). Every field the recommender reads already lives on `library_entries` — `play_status`, `length_hours` (nullable), `release_date` (nullable), `date_bought`, `created_at`. **No migration needed.** What's missing is the scoring logic and a surface to invoke it.

## Desired End State

A signed-in user visits `/play-next` (linked from the library header), sees a ranked top-10 immediately (defaults: all four length buckets + "newly bought"), and adjusts two dials to re-rank. Identical dials always produce the identical list. When nothing qualifies, a sentence names why and suggests a fix — never a blank list.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Length filter | Soft penalty, **graded by bucket distance** | Absent short games, medium ranks above long above very_long | Plan |
| Length buckets | 4: short `<10` · med `10–30` · long `30–60` · very_long `60h+`; **multi-select** | Extends the PRD's 3 buckets; default = all selected = "no preference" | Plan |
| Null `length_hours` | Max bucket-distance penalty | Honest — can't claim a length match we don't have | Plan |
| Ranking model | Weighted numeric score, weights scaled so length ≫ completion ≫ novelty | Keeps PRD "top respects length" true while honoring weighted-score preference | Plan |
| Tie-break | `created_at` then `id` | Total order ⇒ determinism (hard PRD requirement) | Plan |
| Novelty scoring | Rank-normalized recency per mode; null dates rank worst | Scale-free; matches FR-018's three shapes | Plan |
| 100%-complete | New modes **exclude** `completed_100` (penalize `completed`); comfort grades playing_now < played < completed < completed_100 | "De-prioritized except under comfort" | Plan |
| Mode eligibility | Comfort excludes `not_played`; new modes exclude `completed_100` | Defines the only hard filter ⇒ what the empty-state attributes | Plan |
| UI surface | Dedicated **SSR `/play-next` page** (GET-form dials) | Deep-linkable, deterministic, testable; no API route or island | Plan |
| Result count | Top 10 | Enough to scan alternatives without overwhelming | Plan |
| Empty-state | Name the binding constraint + suggest a relaxation | PRD US-03 | Plan |
| Defaults | All four buckets + "newly bought" | Least likely to hit empty-state on first load | Plan |

## Scope

**In scope:** pure scoring engine + Vitest coverage; all-entries service fetch; query-param parser; `/play-next` SSR page with dials, top-10 list, empty-state; library-header link.

**Out of scope:** migration, API route, React island, LLM ranking, mood/genre (FR-017), play-history write-back, result pagination, editing from this page.

## Architecture / Approach

Pure function `recommend(entries, request, limit=10)` in `src/lib/services/recommendation.ts` implements the model: hard mode-eligibility filter → weighted score `−(W_LEN·distance) − (W_COMP·statusPenalty) + (W_NOV·novelty)` with strict-priority weights → stable sort with `created_at`→`id` tie-break → top 10 or a structured empty-reason. `getRecommendations` loads all RLS-scoped entries (`listAllEntries`) and delegates. The `/play-next` page parses query params, calls the service in frontmatter (mirroring `library/index.astro`), and renders — no client JS beyond the GET form.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Engine + service + types | Deterministic `recommend()`, `listAllEntries`, param parser, full Vitest matrix | Weight scaling must enforce strict priority so "top respects length" is provable |
| 2. `/play-next` page + entry point | SSR page, dial form, empty-state, header link | Lint-crash on frontmatter `Astro.redirect` — normalize params in place instead |

**Prerequisites:** F-01, F-02, S-01, S-04 (all done). No new env/secret/binding.
**Estimated effort:** ~1–2 sessions across 2 phases.

## Open Risks & Assumptions

- `length_hours` / `release_date` coverage is sparse; sparse data degrades length/novelty fidelity but never crashes (nulls handled explicitly). Re-enrichment is the fix, out of scope here.
- The four-bucket / multi-select dial extends the PRD's three single-select buckets — an intentional, owner-approved deviation.
- Confirm `/play-next` is covered by `PROTECTED_ROUTES` in `src/middleware.ts`; add it if not.

## Success Criteria (Summary)

- A populated library returns a deterministic, sensible ranked top-10 for any dial combination, with the top result respecting the length selection whenever an in-bucket game exists.
- 100%-completed games are hidden in new modes and last under comfort.
- Every no-result case shows a sentence naming the binding constraint, not a blank list.
