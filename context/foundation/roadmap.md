---
project: "Gaming Library"
version: 1
status: draft
created: 2026-06-02
updated: 2026-06-12
prd_version: 1
main_goal: market-feedback
top_blocker: external
---

# Roadmap: Gaming Library

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline (2026-06-02).
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Gaming Library helps a physical-game collector (50+ titles, 3+ consoles) answer two questions their hand-maintained spreadsheet can't: "what should I play next?" and "do I already own this?". Two bets make it worth building — a photo-of-the-box entry path that recognizes game + platform so cataloguing 50+ titles isn't death-by-typing, and a deterministic recommender that ranks the already-owned shelf against a chosen time-commitment and novelty mood. The recommender is the product's reason to exist; photo entry is the *enabling capability* that makes a populated library affordable in the first place.

## North star

**S-03: a collector captures a single-game box photo and an identified, IGDB-enriched entry lands in their library.** This is the validation milestone, tied to the `market-feedback` goal: it proves the core product bet (affordable photo entry of the differentiating kind) and carries the **binding guardrail** — a hard pass/fail threshold v1 must clear to be considered shipped: ≥ 90% correct game + platform identification on the collector's own shelf (`PRD §Success Criteria > Guardrails`).

> "North star" here means the smallest end-to-end, user-visible flow whose successful delivery would prove the core product hypothesis — placed as early as its Prerequisites allow, because everything else only matters if this works. It sits behind two enabling foundations (data + vision) and is currently `blocked` until the vision-accuracy spike (F-03) confirms the guardrail can be met.

## At a glance

| ID    | Change ID                  | Outcome (user can …)                                            | Prerequisites              | PRD refs                  | Status   |
| ----- | -------------------------- | --------------------------------------------------------------- | -------------------------- | ------------------------- | -------- |
| F-01  | library-entry-store        | (foundation) user-isolated library-entry store exists           | —                          | NFR (isolation, persist)  | done     |
| F-02  | igdb-metadata-enrichment   | (foundation) lookup by title+platform returns the 5 fields      | —                          | FR-008                    | done     |
| F-03  | photo-identification-spike | (foundation) vision returns game+platform, ≥90% validated       | —                          | FR-005, Guardrails        | ready    |
| S-01  | manual-add-and-browse      | add a game by title+platform, enriched, and browse the library  | F-01, F-02                 | US-04, FR-007, FR-008, FR-009 | done     |
| S-02  | edit-and-delete-entry      | edit any field of an entry, and delete with confirmation        | F-01, S-01                 | FR-010, FR-011, FR-020    | done     |
| S-03  | photo-to-library           | capture a box photo → identified, enriched entry auto-saved     | F-01, F-02, F-03, S-01, S-02 | US-01, FR-004, FR-005, FR-006, FR-008 | blocked  |
| S-04  | mark-play-status           | mark a game's play status (+ optional play time)                | F-01, S-01                 | US-02, FR-013, FR-014     | proposed |
| S-05  | search-library-by-title    | search the library by title to check ownership before buying    | F-01, S-01                 | US-05, FR-012             | proposed |
| S-06  | filter-and-sort-library    | filter and sort the library by status, platform, and genre      | F-01, S-01, S-04           | US-05, FR-019             | proposed |
| S-07  | play-next-recommendation   | get a ranked "what should I play next?" list under constraints  | F-01, F-02, S-01, S-04     | US-03, FR-015, FR-016, FR-018 | proposed |
| S-08  | post-login-library-landing | reach the library directly after login (no dashboard hop)       | S-01                       | US-04 (navigation)        | optional |
| S-09  | enrichment-match-precision | avoid false-positive IGDB matches for thin/ambiguous titles     | F-02, S-01                 | FR-008                    | optional |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                         | Chain                                                  | Note                                                                                      |
| ------ | ----------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| A      | Library core (data + CRUD)    | `F-01` → `S-01` → `S-02` / `S-04` / `S-05` → `S-06`    | Everything builds on this; sequenced first. The north star joins it at `S-02`.            |
| B      | Photo entry (killer feature)  | `F-03` → `S-03`                                        | `F-03` resolves the ≥90% guardrail (the `external` blocker); `S-03` joins Stream A at `S-02` (edit/delete = the photo auto-save correction path). |
| C      | Metadata & recommendation     | `F-02` → `S-07`                                        | `F-02` enrichment also feeds `S-01`/`S-03`; `S-07` joins Stream A at `S-04` (play status drives ranking). |

## Baseline

What's already in place in the codebase as of `2026-06-02` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro 6 + React 19 + Tailwind 4 + Radix/shadcn ("new-york") UI kit wired (`src/components/ui/`); only auth pages + a dashboard welcome (`src/pages/dashboard.astro`) exist. No feature pages.
- **Backend / API:** partial — only auth endpoints (`src/pages/api/auth/{signin,signup,signout}.ts`). No domain routes, no `src/lib/services/`.
- **Data:** absent — `supabase/migrations/` empty, `schema_paths = []`; no tables, no entity/DTO types in `src/types.ts`. Supabase is configured but has zero schema.
- **Auth:** present — full Supabase email+password (`src/lib/supabase.ts`), route protection via `src/middleware.ts` (`PROTECTED_ROUTES`), signin/signup/signout live and verified in production. **Satisfies FR-001, FR-002, FR-003 (all must-have) — no slice needed.**
- **Deploy / infra:** present — live on Cloudflare Workers (`gaming-library.lordtomar.workers.dev`), push-to-`main` auto-deploy via Workers Builds, one-command rollback ready (`context/changes/deployment/deployment-plan.md`).
- **Observability:** absent — `wrangler tail` / console only; no Sentry/OTel/pino. Not required by any PRD must-have; no foundation opened for it.

## Foundations

### F-01: Library-entry store

- **Outcome:** (foundation) the smallest persistent, user-isolated library-entry store exists — one entry table carrying the user-facing fields (title, platform, play status, date-added, and the IGDB metadata fields), per-user RLS policies, and a shared entry type in `src/types.ts`. Nothing user-facing on its own.
- **Change ID:** library-entry-store
- **PRD refs:** NFR (per-user isolation: "no view/search/recommendation/filter ever returns an entry the requesting user does not own"); NFR (persistence: "no confirmed/auto-saved entry lost to a backend restart"); Access Control (single-tenant, login-gated)
- **Unlocks:** S-01, S-02, S-03, S-04, S-05, S-06, S-07 (every slice reads or writes the library); reduces the isolation + persistence NFR risks
- **Prerequisites:** — (auth + DB connection are present per Baseline)
- **Parallel with:** F-02, F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because nothing can be stored without it. Kept minimal — one table + RLS, not a full data layer; the first consuming slice (S-01) still designs and exercises the columns through a real create/read. Over-modeling fields the recommender doesn't yet need is the main trap.
- **Status:** done

### F-02: IGDB metadata enrichment

- **Outcome:** (foundation) a server-side lookup that, given a title + platform, returns the five metadata fields (genre, overall length, release year, developer, release date) from IGDB, with a graceful "no match" result. Not user-facing on its own.
- **Change ID:** igdb-metadata-enrichment
- **PRD refs:** FR-008 (eager enrichment at save time); supports US-03's length/recency ranking inputs
- **Unlocks:** S-01 (enrich on manual save), S-03 (enrich on photo save), S-07 (length + release-date + de-prioritization inputs for the recommender)
- **Prerequisites:** —
- **Parallel with:** F-01, F-03
- **Blockers:** —
- **Unknowns:**
  - IGDB/Twitch API credentials must be registered (self-serve developer app) before the lookup can run — Owner: user. Block: no (planning + scaffolding can proceed; only live calls need the key).
  - Does IGDB reliably return an *overall length* value per title+platform (the recommender's length bucket depends on it)? — Owner: team. Block: no (handle missing length as "unbucketed"; S-07 absorbs the gap).
- **Risk:** Made a foundation rather than folded into S-01 because three slices consume it and it carries an external integration with its own setup. Kept minimal — one lookup contract, not "all integrations." If length data is sparse, the recommender's length constraint degrades; that surfaces in S-07, not here.
- **Status:** done

### F-03: Photo-identification spike

- **Outcome:** (foundation) a server-side vision call that, given a single-game box photo, returns a proposed game title + platform — plus a thin accuracy harness run against a sample of the collector's own shelf to measure the ≥90% guardrail. Not user-facing on its own.
- **Change ID:** photo-identification-spike
- **PRD refs:** FR-005 (system-proposed identification); Success Criteria > Guardrails (≥90% accuracy, the binding pass/fail for FR-005); NFR (identification within 10s p95 on mobile broadband)
- **Unlocks:** S-03 (the north-star photo slice); resolves the binding guardrail unknown that determines whether the photo differentiator is viable at all
- **Prerequisites:** —
- **Parallel with:** F-01, F-02
- **Blockers:** —
- **Unknowns:**
  - Vision-provider API key (OpenRouter or equivalent) must be plumbed in (`env.schema`, `.dev.vars`, Worker secret) — Owner: user. Block: no (self-serve; deploy plan already documents the wiring as deferred-until-needed).
  - **Does the chosen vision model identify game + platform from box photos at ≥90% on the collector's own shelf?** — Owner: user/team. Block: yes — this is the binding guardrail; until the spike confirms it, S-03 stays `blocked`.
- **Risk:** Promoted to its own foundation (not buried in S-03) precisely because `top_blocker = external` and `main_goal = validate-riskiest`: this is the single cheapest experiment that tells you whether v1 is viable. If accuracy < 90%, the photo path is cut and manual entry (S-01) becomes the primary path — better to learn that in a spike than after building the full capture UI. Latency (10s p95) is a secondary risk measured here.
- **Status:** ready

## Slices

### S-01: Add a game manually, see it in the library

- **Outcome:** user can add a game by entering title + platform, have it auto-enriched with IGDB metadata (or saved with a "no metadata match" flag), and browse their library in a paginated view.
- **Change ID:** manual-add-and-browse
- **PRD refs:** US-04, FR-007, FR-008, FR-009
- **Prerequisites:** F-01, F-02
- **Parallel with:** F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The first end-to-end create→enrich→display loop; de-risks F-01 and F-02 together through a real user capability and gives the recommender (S-07) a way to populate data without depending on the riskier photo path. Lowest-risk slice, deliberately not the north star but the safe feeder beneath it.
- **Status:** done

### S-02: Edit and delete a library entry

- **Outcome:** user can edit any field of a library entry after creation, and delete an entry behind a confirmation step.
- **Change ID:** edit-and-delete-entry
- **PRD refs:** FR-010, FR-011, FR-020
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced right after S-01 because it is the **correction path the photo auto-save (FR-006) depends on** — S-03 auto-saves identifications and relies on edit/delete to fix the ≤10% it gets wrong. Building it before S-03 keeps the north star's acceptance criteria satisfiable.
- **Design note (from S-01 planning, 2026-06-10):** Implement edit as an **expansion of S-01's add dialog into a unified add/edit dialog**, not a separate edit screen. S-01 ships `AddGameDialog` with its form body factored into a reusable, mode-extensible `GameFormFields` component (title + platform only at add); S-02 grows that body to all editable fields and adds an UPDATE path (the F-01 RLS update policy already exists). The headline is "expand the add dialog," not "build an edit screen." This also lets S-01's post-save seam swap to "reopen the just-saved entry in edit mode for review/correction." **Watch the S-04 overlap:** `play_status` is editable here but S-04 (mark-play-status) owns that capability — decide during S-02 planning whether play-status lives in the dialog, inline on the list, or both, so the two slices don't build it twice.
- **Status:** done

### S-03: Add a game via photo (auto-saved + identified)  — ★ north star

- **Outcome:** user can capture or upload a single-game photo from a browser (including mobile camera), the system proposes a game + platform, and the identified entry is auto-saved into the library with IGDB metadata attached; if identification fails, the user is offered the manual-entry path instead of an auto-saved guess.
- **Change ID:** photo-to-library
- **PRD refs:** US-01, FR-004, FR-005, FR-006, FR-008
- **Prerequisites:** F-01, F-02, F-03, S-01 (manual-entry fallback), S-02 (edit/delete correction path)
- **Parallel with:** S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Vision identification must clear ≥90% accuracy on the collector's shelf — Owner: user/team. Block: yes (resolved by F-03's spike; until then this slice cannot responsibly auto-save).
  - Does the in-browser mobile camera-capture path work end-to-end on the four mainstream browsers (NFR), with no required desktop step? — Owner: team. Block: no (a known mobile-web risk to validate during planning, not a sequencing blocker).
- **Risk:** The validation milestone and the killer feature, placed as early as its prerequisites allow per the `market-feedback` goal. Its viability is gated entirely by F-03 — which is why F-03 is the recommended first move. If the guardrail fails, this slice is cut and the product falls back to S-01 as the entry path.
- **Status:** blocked

### S-04: Mark a game with a play status

- **Outcome:** user can set, change, or clear a play status ("Playing now", "Played", "Completed", "100% completed") on a library entry, and optionally record play time in hours; changes reflect without a full page reload.
- **Change ID:** mark-play-status
- **PRD refs:** US-02, FR-013, FR-014
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-02, S-03, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Independent of the photo path and small in scope, but load-bearing downstream: the recommender (S-07) and the status filter (S-06) both consume play status, so it precedes them. FR-014 (play time) rides along as the slice's only nice-to-have.
- **Status:** proposed

### S-05: Search the library by title

- **Outcome:** user can type a title substring (case-insensitive) and see only matching entries — the fast "do I already own this?" check that covers the secondary success criterion (in-store / marketplace duplicate-purchase avoidance).
- **Change ID:** search-library-by-title
- **PRD refs:** US-05, FR-012
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-02, S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Split out from filter/sort (S-06) because it has independent product value — it is the entire secondary success criterion — and needs nothing beyond a populated library, so it can ship well before the status-dependent filters. Low risk.
- **Status:** proposed

### S-06: Filter and sort the library

- **Outcome:** user can filter and sort the library view by status, platform, and genre, combining filters with each other and with the title search; filter/sort state persists within a browsing session.
- **Change ID:** filter-and-sort-library
- **PRD refs:** US-05, FR-019
- **Prerequisites:** F-01, S-01, S-04
- **Parallel with:** S-03, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Depends on S-04 because filtering by status is its headline use ("show me unplayed PS5"); platform and genre come from S-01 entries. Sequenced after status exists so the most useful filter isn't a dead control. A browse enhancement, not on the critical path to the north star.
- **Status:** proposed

### S-07: "What should I play next?" recommendation

- **Outcome:** user can request a deterministic ranked list from their own library, constrained by overall game-length bucket (short < 10h / medium 10–30h / long 30h+) and biased by one of three novelty modes ("new releases" / "newly bought" / "comfort"); 100%-completed games are de-prioritized except under "comfort", and an empty result explains which constraint excluded everything.
- **Change ID:** play-next-recommendation
- **PRD refs:** US-03, FR-015, FR-016, FR-018
- **Prerequisites:** F-01, F-02 (length + release-date metadata), S-01 (a populated library), S-04 (play status drives comfort bias + 100%-complete de-prioritization)
- **Parallel with:** S-03, S-06
- **Blockers:** —
- **Unknowns:**
  - Will the recommendation meet the < 2s p95 NFR over a 50+ entry library on Workers SSR? — Owner: team. Block: no (deterministic scoring over a small dataset; measure during planning).
- **Risk:** The PRD's stated reason-to-exist, but correctly sequenced *after* its data dependencies — it is only meaningful once the library can be populated (S-01) and statuses set (S-04). Its quality, not its existence, is the real risk, and that can only be judged once real entries exist; deterministic-only scoring (no LLM in v1) keeps it tractable.
- **Status:** proposed

### S-08: Reach the library directly after login  — ◇ optional

- **Outcome:** after signing in the user lands on their library (or reaches it in a single, obvious step) rather than the current dashboard → library two-hop, and a persistent way back to the library exists.
- **Change ID:** post-login-library-landing
- **PRD refs:** US-04 (browsing the library is the primary post-login action); general navigation/usability
- **Prerequisites:** S-01
- **Parallel with:** any
- **Blockers:** —
- **Unknowns:**
  - Should login redirect straight to `/library`, or should the dashboard be reframed as a library-first landing (keeping sign-out etc.)? — Owner: user. Block: no (decide during planning).
- **Risk:** Pure UX polish surfaced during S-01 manual verification (2026-06-11) — the dashboard → library hop is an inconvenience, not a defect. **Optional:** gates no other slice; current navigation works. Low risk, mostly a redirect/nav decision.
- **Status:** optional

### S-09: Tighten IGDB match precision  — ◇ optional

- **Outcome:** enrichment stops attaching false-positive metadata for thin or ambiguous search terms (e.g. title "e" on "Xbox Series X" should not match a real game); low-confidence IGDB results degrade to the existing `no_match` flag instead of wrong metadata.
- **Change ID:** enrichment-match-precision
- **PRD refs:** FR-008 (eager enrichment — quality of the match)
- **Prerequisites:** F-02, S-01
- **Parallel with:** any
- **Blockers:** —
- **Unknowns:**
  - What confidence signal does IGDB expose to threshold on (name exactness, platform agreement, popularity/rating count), and where is the cut set without rejecting valid matches? — Owner: team. Block: no (investigate during planning, validate against a held-out sample of the collector's shelf).
- **Risk:** Quality refinement of F-02's lookup, surfaced during S-01 manual verification (2026-06-11). **Optional:** the current behavior is "over-eager match," not data loss, and `no_match` already exists as the safe degrade. The real risk is mis-tuning the threshold and dropping valid matches; a held-out shelf sample bounds it.
- **Status:** optional

## Backlog Handoff

| Roadmap ID | Change ID                  | Suggested issue title                                   | Ready for `/10x-plan` | Notes |
| ---------- | -------------------------- | ------------------------------------------------------- | --------------------- | ----- |
| F-01       | library-entry-store        | Library-entry store: table, RLS, shared entry type      | yes                   | Recommended after F-03; unblocks every slice |
| F-02       | igdb-metadata-enrichment   | IGDB metadata enrichment (lookup by title + platform)   | yes                   | Needs IGDB/Twitch credentials before live calls |
| F-03       | photo-identification-spike | Vision photo-ID spike + ≥90% accuracy validation        | yes                   | **Recommended first** — resolves the binding guardrail |
| S-01       | manual-add-and-browse      | Manual add + enriched + paginated library browse        | no                    | Needs F-01, F-02 |
| S-02       | edit-and-delete-entry      | Edit any field; delete with confirm                     | no                    | Needs F-01, S-01 |
| S-03       | photo-to-library           | Photo capture → identified, auto-saved enriched entry   | no                    | Blocked on F-03 guardrail; needs F-01/F-02/S-01/S-02 |
| S-04       | mark-play-status           | Mark play status (+ optional play time)                 | no                    | Needs F-01, S-01 |
| S-05       | search-library-by-title    | Search library by title (duplicate-purchase check)      | no                    | Needs F-01, S-01 |
| S-06       | filter-and-sort-library    | Filter & sort by status, platform, genre                | no                    | Needs F-01, S-01, S-04 |
| S-07       | play-next-recommendation   | Deterministic "what should I play next?" recommender    | no                    | Needs F-01, F-02, S-01, S-04 |
| S-08       | post-login-library-landing | Reach the library directly after login (no dashboard hop) | no                  | Optional UX polish; needs S-01 |
| S-09       | enrichment-match-precision | Tighten IGDB match precision (avoid false positives)    | no                    | Optional; needs F-02, S-01 |

## Open Roadmap Questions

1. **External game-metadata source — final selection.** Carried from PRD `## Open Questions` #1. Effectively resolved downstream: `tech-stack.md` and `infrastructure.md` both commit to **IGDB** (genre, overall length, year, developer, release date; lookup by title + platform). Owner: tech-stack-selection step (closed). Block: F-02 implementation detail only — not roadmap-wide.
2. **Quality cross-check status.** Carried from PRD `## Open Questions` #2. Phase-7 `/10x-shape` cross-check ran `accepted`; traceability only, no resolution required. Block: none.

(Per-slice unknowns — the vision-accuracy guardrail, IGDB length coverage, mobile-camera browser support, recommender p95 — stay in their slices above.)

## Parked

- **Mood / genre recommendation constraint (FR-017).** Why parked: nice-to-have in the PRD; needs a genre taxonomy + UI surface. Revisit in v2 once recommender (S-07) quality is measured; would add a third constraint axis without changing the rule's identity.
- **Digital library integrations (Steam, GOG, PSN, Xbox Live).** Why parked: PRD §Non-Goals — physical-first by identity; digital storefronts dilute the persona and the business rule.
- **Social / sharing features (friends, profiles, shared collections, comments, leaderboards).** Why parked: PRD §Non-Goals — v1 is single-collector; sharing would change the access-control model.
- **Wishlists, deal tracking, series/collection grouping.** Why parked: PRD §Non-Goals — each is a sizable feature tangential to the "what should I play next?" decision.
- **Edition-level precision (Standard vs. Legendary vs. GOTY vs. regional).** Why parked: PRD §Non-Goals — photo path identifies game + platform only; reliable edition recognition is the largest single cut in the 3-week budget. Deferred to v2.
- **AI-augmented recommender.** Why parked: PRD §Non-Goals — v1 ships deterministic scoring only; LLM-assisted suggestions land in v2 once the scoring recommender's weaknesses are known.
- **Multi-game-per-photo / shelf-scanning.** Why parked: PRD §Non-Goals — one game per photo in v1; multi-box segmentation doesn't fit the budget.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived. Do NOT pre-populate.)

- **F-01: (foundation) the smallest persistent, user-isolated library-entry store exists — one entry table carrying the user-facing fields (title, platform, play status, date-added, and the IGDB metadata fields), per-user RLS policies, and a shared entry type in `src/types.ts`. Nothing user-facing on its own.** — Archived 2026-06-08 → `context/archive/2026-06-06-library-entry-store/`. Lesson: —.
- **F-02: (foundation) a server-side lookup that, given a title + platform, returns the five metadata fields (genre, overall length, release year, developer, release date) from IGDB, with a graceful "no match" result. Not user-facing on its own.** — Archived 2026-06-08 → `context/archive/2026-06-07-igdb-metadata-enrichment/`. Lesson: —.
- **S-01: user can add a game by entering title + platform, have it auto-enriched with IGDB metadata (or saved with a "no metadata match" flag), and browse their library in a paginated view.** — Archived 2026-06-10 → `context/archive/2026-06-10-manual-add-and-browse/`. Lesson: —.
- **S-02: user can edit any field of a library entry after creation, and delete an entry behind a confirmation step.** — Archived 2026-06-12 → `context/archive/2026-06-11-edit-and-delete-entry/`. Lesson: —.
