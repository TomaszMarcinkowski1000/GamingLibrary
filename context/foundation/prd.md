---
project: "Gaming Library"
version: 1
status: draft
created: 2026-05-25
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# Gaming Library — Product Requirements Document

## Vision & Problem Statement

A physical game collector with 50+ titles spread across 3+ consoles can't easily decide what to play next from their shelf — they sit in front of the collection and freeze. Secondarily, when buying a new title in a store or online they can't reliably check whether they already own it, especially across editions (Standard vs. Legendary vs. GOTY vs. regional variants). The two pains together form the core problem: a sizable, valuable physical library is functionally inaccessible to its owner.

Existing tools fail this collector for two compounding reasons. A hand-maintained spreadsheet handles the tracking job adequately but every entry is typed by hand — for 50+ titles, that friction is enough to give up. Public game-tracking apps reduce entry friction in some cases but each misses something critical: no central, authoritative gaming database the collector trusts to identify the exact game; no edition-level distinction (collectors care about the edition; trackers conflate them); and no recommendation algorithm that scores "what to play next" against the collector's actual shelf. The insight that makes this product worth writing is twofold: (1) a photo-of-the-shelf entry path that recognizes game + platform removes the data-entry barrier that kills every existing alternative, and (2) a hybrid scoring recommender — informed by metadata like genre, length, and the user's play history — closes a "decide what to play" gap no existing tracker fills.

## User & Persona

**Primary persona (v1): a single named collector — the builder themselves.** A hobbyist gamer with a sizable physical library (50+ titles, 3+ consoles). They are not a casual owner with a handful of games; they are not a streamer or content creator; they are not a retro-collector chasing rarities. They are an enthusiast who owns more than they have time to play, who values the difference between editions, and who currently keeps everything in a hand-maintained spreadsheet because no public tool does the job better.

They reach for this product in two distinct moments. **The primary moment**: they have an hour, an evening, or a weekend free and they're standing or sitting in front of the shelf, paralyzed. Time available, mood/genre fit, and the tradeoff between novelty and comfort all drive the decision — and existing tools help with none of them. **The secondary moment**: they're in a store or scrolling an online marketplace, about to buy a title, and they want to check whether they already own it (or own an edition of it) before paying.

V1 is built for this single named user. If the design works for them, it generalizes naturally to the hobbyist-collector niche (collectors with 50+ titles, 3+ consoles); broader audiences are deferred.

## Success Criteria

### Primary
- A returning user completes the full v1 flow end-to-end: (a) takes or uploads a single-game photo, (b) the app identifies game + platform, (c) the entry lands in their library with metadata from the external game-metadata source attached, (d) the user marks status on at least one game, (e) the user requests "what should I play next?" and receives a ranked list whose top result is a defensible match for their stated length-commitment and novelty-mode constraints.

### Secondary
- The user can search their library to check whether they already own a given title before buying it — covering the secondary moment (in-store / online-marketplace decision support) without dedicated UI surface beyond a search box.

### Guardrails
- Photo identification of game + platform reaches ≥ 90% correct on the user's own shelf. Below this floor, manual entry becomes the only viable path and the product's core differentiator collapses.
- The photo-capture flow works end-to-end on a modern mobile browser — taking a photo on a phone and landing the recognized entry in the library must not require a desktop step. The phone is the camera; if the phone path breaks, the killer feature breaks.

## User Stories

### US-01: Add a game to the library via photo

- **Given** a signed-in user on a mobile or desktop browser
- **When** they capture or upload a single-game photo
- **Then** the system identifies game + platform and the entry is auto-saved to the library with external metadata attached; the user can edit or delete it after the fact

#### Acceptance Criteria
- The user can upload from the device gallery OR use the camera directly from the browser
- The proposed identification names a specific game title and platform — not just a genre or franchise
- The entry lands in the library immediately with metadata attached (genre, length, year, developer, release date)
- If the system cannot identify the game from the photo, the user is offered the manual-entry flow rather than an auto-saved guess
- Incorrect auto-saved entries are corrected via FR-010 (edit) or removed via FR-011/FR-020 (delete with confirm)

### US-02: Mark a game with a play status

- **Given** a signed-in user with at least one game in their library
- **When** they open a library entry and select a play status
- **Then** the status is persisted and reflected in the library view immediately

#### Acceptance Criteria
- Available statuses: "Playing now", "Played", "Completed", "100% completed"
- Status can be set, changed, or cleared at any time
- Optional play time field (hours) accepts a non-negative integer; empty means unset
- Status changes are visible without a full page reload

### US-03: Get a "what should I play next?" recommendation

- **Given** a signed-in user with at least one unplayed, in-progress, or previously-played game in their library
- **When** they request a recommendation, optionally constraining by overall game length and novelty mode
- **Then** the app returns a ranked list of suggestions from their library that match the constraints

#### Acceptance Criteria
- Constraints supported in v1: overall game length (short < 10h / medium 10–30h / long 30h+), novelty mode ("new releases" / "newly bought" / "comfort")
- Top result respects the length constraint — the game's reported overall length (from the external metadata source) fits the chosen bucket
- Top result respects the novelty mode — "new releases" surfaces entries with recent release dates; "newly bought" surfaces recently-added entries; "comfort" surfaces older, previously-played or completed entries
- 100%-completed games are de-prioritized except under the "comfort" mode
- Ranking is deterministic — identical inputs produce identical outputs (no randomness in v1)
- If the library has no eligible game for the constraints, the user sees an explanatory empty-state, not an empty list

### US-04: Add a game to the library manually

- **Given** a signed-in user who does not want to use the photo path
- **When** they choose "Add manually" and enter at least a title and a platform
- **Then** the entry is created and enriched with external metadata (genre, length, year, developer)

#### Acceptance Criteria
- Title and platform are required; all other fields are optional at creation
- External-source enrichment runs at save time; if no match is found, the entry is still saved with the user-supplied fields and a flag indicating "no metadata match"
- Manual entry never requires going through the photo flow first

### US-05: Search and filter the library

- **Given** a signed-in user with games in their library
- **When** they enter a search term and/or apply filters by status, platform, or genre
- **Then** the library view updates to show only matching entries

#### Acceptance Criteria
- Search is case-insensitive and matches any substring of the title
- Filters by status, platform, and genre can be combined with each other and with the search term
- When no entries match, the user sees an explanatory empty-state, not a broken list
- Clearing all filters and search returns to the full library view
- Filter/sort state is preserved within a single browsing session (no need to be reapplied between pages)

## Functional Requirements

### Authentication
- FR-001: User can register an account with email and password. Priority: must-have
  > Socrates: counter-argument considered: "use only OAuth (e.g. Google) to skip password management." Resolution: rejected — OAuth would couple v1 to a third-party identity provider; email+password keeps the auth surface minimal and self-contained.
- FR-002: User can sign in to access their library. Priority: must-have
  > Socrates: counter-argument considered: "make sessions persist forever so users never re-sign-in." Resolution: kept as drafted — standard session expiry is the safer baseline for v1.
- FR-003: User can sign out. Priority: must-have
  > Socrates: counter-argument considered: "drop explicit sign-out and rely on session expiry only." Resolution: kept as drafted — explicit sign-out preserves user control on shared devices.

### Library entry — photo path
- FR-004: User can upload or capture a single-game photo from a browser, including mobile. Priority: must-have
  > Socrates: counter-arguments considered: "camera-only" and "upload-only". Resolution: kept both paths — upload supports cataloguing-from-existing-photos and live capture supports the phone-as-camera primary workflow.
- FR-005: User receives a system-proposed game + platform identification from the photo. Priority: must-have
  > Socrates: counter-argument considered: "v1 manual-only — drop photo identification entirely." Resolution: rejected — photo identification is the core differentiator; without it, the product loses its identity.
- FR-006: After photo identification, the proposed entry is auto-saved into the library; the user can edit or delete it after the fact using the standard library-management capabilities. Priority: must-have
  > Socrates: counter-argument considered: "explicit confirm step before save". Resolution: revised — auto-save chosen for a smoother happy-path UX. The ≥90% accuracy guardrail makes after-the-fact correction acceptable; bad identifications can be fixed via FR-010 (edit) or FR-011/FR-020 (delete with confirm).

### Library entry — manual path
- FR-007: User can manually create a library entry by entering title + platform. Priority: must-have
  > Socrates: counter-argument considered: "drop manual entry — photo path only in v1." Resolution: kept — manual entry is the safety net for photo-recognition failures, which the 90% accuracy floor explicitly permits.

### Metadata
- FR-008: Each library entry is automatically enriched with external metadata (genre, length, year, developer, release date) at save time. Priority: must-have
  > Socrates: counter-argument considered: "lazy enrichment on first view; or drop metadata enrichment entirely." Resolution: kept eager enrichment — length and genre data feed the recommender, so the data must be present when the user requests a suggestion. Lazy enrichment adds caching complexity for no UX benefit at v1 scale.

### Library management
- FR-009: User can browse their library via a paginated view. Priority: must-have
  > Socrates: counter-argument considered: "search-only; no browse view." Resolution: revised — pagination chosen over scroll-all to scale gracefully past 50+ entries while keeping the "see my collection" feel.
- FR-010: User can edit any field of a library entry after creation. Priority: must-have
  > Socrates: counter-argument considered: "restrict editable fields — metadata frozen after save." Resolution: kept full edit — required by FR-006's auto-save decision so users can correct mis-identified entries without deleting and re-creating.
- FR-011: User can delete a library entry. Priority: must-have
  > Socrates: counter-argument considered: "soft-delete with archive view instead of hard delete." Resolution: kept hard delete (guarded by FR-020) — archive adds data-model complexity for marginal v1 value.
- FR-012: User can search their library by title — covers the duplicate-purchase secondary criterion. Priority: must-have
  > Socrates: counter-argument considered: "skip search; rely on platform filter." Resolution: kept — substring title search is the fastest path to "do I own this game?" and the secondary success criterion depends on it.
- FR-019: User can filter and sort the library view by status, platform, and genre. Priority: must-have
  > Socrates: counter-arguments considered: "default sort only, no filters" and "platform-only filter". Resolution: kept all three filters — at 50+ entries across multiple consoles, filtering by status (e.g., "show me unplayed PS5") is the only practical browse pattern.
- FR-020: User must confirm a delete action before the entry is removed. Priority: must-have
  > Socrates: counter-arguments considered: "undo banner" and "soft-delete archive". Resolution: kept confirm-on-delete — interruptive but reliable; undo adds state complexity, archive adds a new view.

### Play status
- FR-013: User can mark a library entry with a play status: "Playing now", "Played", "Completed", or "100% completed". Priority: must-have
  > Socrates: counter-argument considered: "binary Played / Not played." Resolution: revised — added "Playing now" as a fourth status. The recommender's comfort bias and the "what should I play next?" gap both depend on knowing what's in-progress vs. dropped vs. completed; binary loses that signal.
- FR-014: User can optionally record play time (hours) against a library entry. Priority: nice-to-have
  > Socrates: counter-argument considered: "drop entirely or promote to must-have." Resolution: kept as nice-to-have — useful future signal but not load-bearing for v1's recommender or core flow.

### Recommendation
- FR-015: User can request a "what should I play next?" ranked list from their library. Priority: must-have
  > Socrates: counter-argument considered: "replace with random pick or return one suggestion only." Resolution: kept ranked list — the recommender IS the core value proposition; degrading it to a button-press kills the product.
- FR-016: User can constrain the recommendation request by overall game length they want to commit to, in buckets: short (< 10h), medium (10–30h), long (30h+). Priority: must-have
  > Socrates: counter-argument considered: "skip explicit input; assume medium." Resolution: revised — reframed from "session length tonight" to "overall game length commitment" because IGDB has total-length data (HowLongToBeat-style) but no session-length data. Buckets map directly to IGDB length fields.
- FR-017: User can constrain the recommendation request by mood / genre preference. Priority: nice-to-have
  > Socrates: counter-argument considered: "drop entirely from v1." Resolution: kept as nice-to-have — mood matters per the persona's decision drivers but needs a genre taxonomy and UI surface; revisit in v2 once recommender quality is measured.
- FR-018: User can bias the recommendation toward one of three modes: "new releases" (release-date recency from the external metadata source), "newly bought" (date-added-to-library recency), or "comfort" (older entries, previously played/completed). Priority: must-have
  > Socrates: counter-argument considered: "single combined novelty score under one dial." Resolution: revised — three explicit user-facing modes chosen because the persona's "novelty" intuition has two distinct shapes (recent in the world vs. recent in their collection); collapsing them loses precision the collector cares about.

## Non-Functional Requirements

- A user with a populated library receives a ranked recommendation within 2 seconds at the 95th percentile after submitting the request.
- A user uploading or capturing a single-game photo receives the identification result within 10 seconds at the 95th percentile on a typical mobile broadband connection.
- A user's library is isolated from every other user's library; no view, search, recommendation, or filter ever returns an entry the requesting user does not own.
- A library entry the user has created remains visible the next time they sign in, regardless of any intervening operational event; no entry the user has confirmed (or that has been auto-saved per FR-006) is lost to a backend restart or recovery.
- The product remains fully usable on the latest two major versions of the four mainstream browsers — Chrome, Firefox, Safari, Edge — across both desktop and mobile form factors. The mobile path explicitly includes the camera-capture flow described in FR-004.
- The photo identification accuracy guardrail (≥ 90% correct on the collector's own shelf, from `## Success Criteria > Guardrails`) is the binding success threshold for FR-005; the system either meets it or v1 is considered not-shipped.

## Business Logic

**Gaming Library decides, from a collector's physical library, which already-owned game best matches the time the collector wants to commit and the novelty mode they're in right now.**

The rule consumes three user-facing inputs: the collector's library entries (each carrying play status and a date they were added), the length-commitment bucket the collector picks for this request (short / medium / long), and the novelty mode they pick ("new releases" / "newly bought" / "comfort"). It produces a ranked list of games from the collector's own library, with the top suggestion being the one whose length matches the chosen bucket and whose novelty profile matches the chosen mode most strongly. Games at 100% completion are de-prioritized except under the "comfort" mode, where previously-played titles are exactly what's wanted.

The collector encounters the rule by tapping "what should I play next?", picking their length and novelty preferences (defaults are acceptable), and reading the resulting ranked list. Ranking is deterministic in v1 — identical inputs produce identical outputs — so the collector can trust that re-asking the same question will not capriciously reshuffle results. If no game in the library matches the constraints, the collector sees an empty state that names which constraint excluded everything, not an empty list.

The rule is not empty CRUD. The recommendation IS the product's reason to exist: the collector has 50+ titles, a hand-maintained spreadsheet doesn't help them choose, and "decide what to play next under stated constraints" is the actual decision the app makes for the user. Photo identification (FR-005 onward) is the *enabling capability* — without it, the library can't be populated affordably — but the recommendation is the rule. FR-017 (mood/genre) is currently nice-to-have; if it lands in v1, it enriches the rule with a third constraint axis but does not change the rule's identity.

## Access Control

Single-tenant, login-gated. The user signs in with email and password and reaches their own library; unauthenticated requests to any library route are rejected. The model is flat — one user, no roles, no shared workspaces, no read-only guests in v1.

Login is chosen over a local-profile / on-device model because the workflow is inherently cross-device: photos are captured on a phone, the library is browsed and the recommender consulted from a laptop or tablet. A local-profile model would force one device to own the data, which breaks the primary workflow. The smallest access model that still makes the MVP useful is therefore "an account, one user, one library".

Sign-up is open in v1 (anyone can register and use the app with their own library) but the product is designed for one collector; multi-user features (sharing, social, household libraries) are explicit non-goals for the MVP.

## Non-Goals

- **No digital library integrations.** Gaming Library will not connect to Steam, GOG, PSN, Xbox Live, or any other digital storefront in v1. The product is physical-first by identity; pulling in digital libraries dilutes the persona and the business rule.
- **No social or sharing features.** No friends, no public profiles, no shared collections, no comments, no leaderboards. v1 is built for a single named collector; multi-user sharing would change the access-control model and the recommender's framing.
- **No wishlists, no deal tracking, no series/collection grouping.** All three are listed in the source notes as out-of-scope. Each is a sizable feature in its own right and tangential to the "what should I play next?" decision. Revisit only after the core recommender proves out.
- **No edition-level precision in v1.** The photo path identifies game + platform only; Standard vs. Legendary vs. GOTY vs. regional variants are deferred to v2. Recognizing editions reliably requires substantially more vision work and is the largest single cut in the 3-week budget.
- **No AI-augmented recommender in v1.** v1 ships with deterministic scoring only — formula-based ranking over external metadata and library state. LLM-assisted suggestions land in v2 once the scoring recommender is proven and its weaknesses are known.
- **No multi-game-per-photo / shelf-scanning in v1.** One game per photo. Recognizing multiple boxes in a single frame is deferred; it adds segmentation complexity that does not fit the budget.

## Open Questions

1. **External game-metadata source — final selection.** The input notes name IGDB (igdb.com) as the data source; the user has clearly committed to it as the v1 target. The PRD describes this dependency abstractly as "external metadata source" because the specific provider is a stack-shaped concern. Forward to the tech-stack-selection step; the only PRD-level requirement is that the chosen source supplies genre, overall game length, release year, developer, and release date for the titles in the user's library, and supports lookup by title + platform. Owner: tech-stack-selection step.
2. **Quality cross-check status.** Phase 7 cross-check from `/10x-shape` ran with status `accepted` — all required elements (Access Control, Business Logic, Project artifacts, Timeline-cost ack, Non-Goals) present, no gaps surfaced. This entry is for traceability only; no resolution required.
