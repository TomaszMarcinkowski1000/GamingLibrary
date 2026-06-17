# Add a game via photo (S-03, north star) — Implementation Plan

## Overview

Ship the north-star slice: a signed-in collector captures or uploads a single-game box photo from a browser (including mobile camera), the system identifies the game + platform, **auto-saves** the identified entry into the library with IGDB metadata attached, and immediately reopens it in the review/edit dialog so the user can confirm or correct. If the photo can't be identified, the user is offered the manual-entry path instead of an auto-saved guess.

This slice is unusually de-risked: the vision read (`identifyGameFromPhoto`, ~95%), the IGDB grounding (`lookupGameMetadata` + `collapseToBaseGame`, S-09 re-measure 92.9% ≥ 90%), the auth-gated `POST /api/identify` route, the create-with-enrichment path, and the unified add/edit `GameDialog` (with its add→edit review seam) **all already exist**. The new work is: (1) make the identify route persist on a confident read, (2) build the photo-capture client island, and (3) wire it into the library page as the primary add affordance and validate the mobile-camera NFR across the four mainstream browsers.

## Current State Analysis

- **`POST /api/identify`** (`src/pages/api/identify.ts:122`) — auth-gated, accepts multipart `photo` (≤10 MB; png/jpeg/webp/gif), runs `identifyGameFromPhoto` → grounds via `lookupGameMetadata`, and returns `IdentifyResponse` (`identified | unsure`). It **does not persist** anything (built for the F-03 spike/harness). Critically, it currently **folds an IGDB `no_match` into `unsure`** (`identify.ts:171-173`) to keep the harness accuracy metric clean ("couldn't ground" ≠ "wrong").
- **`identifyGameFromPhoto`** (`src/lib/services/vision.ts:76`) → `VisionIdentifyResult = { status:"identified"; title; platform; confidence } | { status:"unsure"; confidence }` (`src/types.ts:211`). Gemini 2.5 Flash via OpenRouter, p95 3.25 s.
- **`lookupGameMetadata`** (`src/lib/services/igdb.ts:424`) → `IgdbLookupResult = { status:"matched"; igdbId; genre; developer; series; releaseYear; releaseDate; lengthHours; collapsedFrom? } | { status:"no_match" }` (`src/types.ts:187`). S-09 grounding (edition-collapse, platform-alias normalization, false-positive suppression) is shipped.
- **`createLibraryEntry`** (`src/lib/services/library.ts:53`) — inserts a row, enriching by calling `lookupGameMetadata` itself (best-effort try/catch; `date_bought` defaults to today). Takes `{ title, platform }` only.
- **`GameDialog`** (`src/components/library/GameDialog.tsx:91`) — the single add/edit dialog. **Trigger-driven**: it renders its own `DialogTrigger` button and owns `open` via internal `useState` (`GameDialog.tsx:97`). After a successful *add* it keeps itself open and flips to edit mode pre-filled with the freshly-created entry (`savedEntry`, `GameDialog.tsx:98-107`) — exactly the review seam S-03 needs — but it cannot be opened programmatically from outside today.
- **`POST /api/library`** (`src/pages/api/library/index.ts:26`) — create from `{ title, platform }`, returns `{ entry: LibraryEntry }`.
- **Library page** (`src/pages/library/index.astro`) — SSR, mounts the `GameDialog` island in the header; list refresh after add is a navigation/reload on dialog close (`savedSinceOpen`).
- **Env/secrets** — `OPENROUTER_API_KEY`, `TWITCH_CLIENT_*` in `astro.config.mjs` `env.schema`; `IGDB_TOKENS` KV binding accessed via `import { env } from "cloudflare:workers"` (per `lessons.md` — never `locals.runtime.env`).
- **Harness** — `scripts/identify-harness.mjs` (`npm run harness`) POSTs to `/api/identify`. It must keep working unchanged.
- **Runtime constraint** — workerd has no Node `sharp`, so the route cannot downscale server-side (`identify.ts:44-47`). Downscaling must happen client-side (this plan) — which also serves the mobile-uplink latency budget.

## Desired End State

From the library page, a signed-in user taps **Add via photo** (the primary add affordance), picks an existing phone photo *or* shoots a new one, and within ~a few seconds either:
- sees the identified game open in the review dialog, already saved with IGDB metadata attached (confirm or correct, then it's in the library); or
- (confident read, no IGDB match) sees it saved with `metadata_status='no_match'` open for review; or
- (couldn't identify) is shown a brief "couldn't identify — add it manually" and the manual add form opens empty.

Verifiable when: the capture→identify→auto-save→review flow works end-to-end on mobile Chrome/Firefox/Safari/Edge with no desktop step; `npm run build`, `npm run lint`, and the unit tests pass; and the existing `npm run harness` still runs unchanged.

### Key Discoveries:

- `POST /api/identify` already grounds and holds the full `IgdbLookupResult` in hand — persisting from it needs **no second IGDB lookup** (`identify.ts:161-183`).
- The `no_match → unsure` fold (`identify.ts:171-173`) is harness-correct but the **opposite** of the chosen UI behavior; persistence must be an opt-in path that persists a confident read even on no_match.
- `GameDialog` already supports being seeded with an `entry` and reviewing it (`GameDialog.tsx:24-26, 105-107`) — the only gap is programmatic (controlled) opening.
- `createLibraryEntry` re-enriches; a sibling that inserts from a **pre-grounded** result keeps the route to one lookup and reuses the exact column-mapping shape (`library.ts:60-99`).
- workerd cannot resize images server-side — client-side canvas downscale is mandatory, not an optimization (`identify.ts:44`).

## What We're NOT Doing

- **No edition-level precision** — game + platform only; S-09 deliberately collapses editions to the base game (PRD Non-Goals).
- **No multi-game / shelf scanning** — one game per photo (PRD Non-Goals).
- **No photo storage** — the uploaded image is used for identification and discarded; nothing is written to Supabase Storage / R2 in v1 (F-03 out-of-scope, reconfirmed).
- **No vision/grounding changes** — the model and S-09 grounding are unchanged; this slice does not re-tune accuracy.
- **No harness re-run as an acceptance gate** — S-09's 92.9% stands; acceptance is manual E2E + the standard automated gates (per the chosen acceptance bar). The harness must keep working but is not a CI gate here.
- **No client-side image rectification (opencv.js)** — F-03 showed skew is not a dominant error driver.
- **No `getUserMedia` live-preview capture** — a native file input covers both FR-004 paths across all four browsers.
- **No confirm-*before*-save gate** — the chosen UX is auto-save-then-review (FR-006 literal), not a pre-save confirmation.

## Implementation Approach

The client island captures/selects an image, downscales it in-browser (canvas, ~1024 px long edge, JPEG, EXIF-orientation baked in), and POSTs it to `/api/identify` with an opt-in **persist** flag. The route runs the existing vision→grounding path; when persist is requested and the vision read is confident, it inserts the entry from the already-computed grounding result (matched → full metadata; no_match/transport-fail → nulls + `metadata_status='no_match'`) and returns the created `LibraryEntry`. The island branches on the response: identified → open `GameDialog` (controlled) seeded with the returned entry in review/edit mode; unsure or error → open `GameDialog` in empty add mode behind a short "couldn't identify" note. On dialog close, the page refreshes (reusing the existing add-flow reload seam). The harness path — POST without the persist flag — is byte-for-byte unchanged, including the `no_match → unsure` fold.

## Critical Implementation Details

- **The persist flag inverts the no_match branch.** Without persist (harness): a confident read that grounds to `no_match` returns `unsure` (`identify.ts:171-173`) — keep this. With persist (UI): the same read must **persist** the entry with `metadata_status='no_match'` and return it. Only `unsure` from the *vision* layer routes to the manual fallback. Get this branching right or the harness metric or the UI behavior breaks.
- **EXIF orientation.** Phone photos carry an orientation tag; a naive canvas draw rotates the box sideways and tanks the vision read. The downscale step must apply orientation (modern browsers honor `createImageBitmap(blob, { imageOrientation: "from-image" })`; verify across the four targets).
- **Controlled GameDialog.** Adding `open`/`onOpenChange` must not regress the existing trigger-driven add/edit usages on the library page — make the controlled props optional and default to today's internal-state behavior when absent.
- **One IGDB lookup.** Persist from the `IgdbLookupResult` the route already holds; do not call `createLibraryEntry` (it would ground a second time).

---

## Phase 1: Server — persist-on-identify

### Overview

Make `POST /api/identify` able to auto-save a confident identification server-side, from the grounding result it already computes, behind an opt-in flag — leaving the harness path untouched.

### Changes Required:

#### 1. Library service — insert from a pre-grounded result

**File**: `src/lib/services/library.ts`

**Intent**: Add a function that creates a library entry from an already-resolved `IgdbLookupResult`, so the identify route persists without a second IGDB round-trip. Mirrors `createLibraryEntry`'s column mapping and `date_bought=today` default, but takes the grounding instead of performing it.

**Contract**: `createLibraryEntryFromGrounding(supabase: TypedSupabaseClient, input: { title: string; platform: string; grounding: IgdbLookupResult | null }): Promise<LibraryEntry>`. A `matched` grounding populates the metadata columns + `metadata_status='matched'`; a `no_match` grounding or `null` (transport failure) folds to nulls + `metadata_status='no_match'`. Reuse the exact `metadata` shape from `library.ts:60-99`; insert and return the row.

#### 2. Identify route — opt-in persistence

**File**: `src/pages/api/identify.ts`

**Intent**: When the caller opts into persistence and the vision read is confident, insert the entry from the grounding already in hand and return it; otherwise behave exactly as today (the harness path).

**Contract**: Accept a `persist` opt-in on the POST (a `persist` form field, e.g. `"true"`, parsed alongside `photo` in `uploadSchema`). When `persist` is **off** → current behavior verbatim, including the `no_match → unsure` fold (`identify.ts:171-173`). When `persist` is **on**: `unsure` vision → return `{ status:"unsure", confidence }` (no write); confident vision → call `createLibraryEntryFromGrounding` with the resolved grounding (matched **or** no_match/null) using the route's authenticated Supabase client, and return `{ status:"identified", title, platform, confidence, igdbId, metadataStatus, debug, entry }` where `entry: LibraryEntry` is the created row. Extend the `IdentifyResponse` `identified` variant with an optional `entry?: LibraryEntry`. Obtain the Supabase client the same way `api/library/index.ts` does.

#### 3. Response/type wiring

**File**: `src/types.ts` (only if a shared type is warranted) and `src/pages/api/identify.ts`

**Intent**: Surface the created entry on the identified response without breaking the harness's field reads (`title`/`platform`/`igdbId`/`status`).

**Contract**: Keep all existing `identified` fields; add `entry?: LibraryEntry`. No change to the `unsure` variant. No change to the GET grounding-shortcut.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (Astro check + build)
- Linting passes: `npm run lint`
- Unit tests pass for `createLibraryEntryFromGrounding`: matched → metadata columns + `matched`; no_match → nulls + `no_match`; `null` grounding → nulls + `no_match` (mocked Supabase client)

#### Manual Verification:

- `POST /api/identify` with `persist` off returns the unchanged spike shape; `npm run harness` runs and scores as before
- `POST /api/identify` with `persist` on and a confident, matched read creates exactly one `library_entries` row with metadata attached and returns it as `entry`
- A confident read that grounds to no_match persists with `metadata_status='no_match'` (not abstained) when `persist` is on
- A vision `unsure` read with `persist` on writes nothing and returns `unsure`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Client — photo-capture island

### Overview

Build the React island that captures/selects an image, downscales it client-side, posts it to `/api/identify` with persistence, and routes the response to the review dialog or the manual-add fallback. Give `GameDialog` a controlled-open mode so the island can open it programmatically.

### Changes Required:

#### 1. Client image downscale utility

**File**: `src/lib/image/downscale.ts` (new)

**Intent**: Resize a user-selected image to a bounded long edge and re-encode as JPEG before upload, with EXIF orientation applied — keeping the payload small (mobile uplink + 10 MB route cap) and matching the resolution F-03 measured accuracy on.

**Contract**: `downscaleImage(file: File, opts?: { maxEdge?: number; quality?: number }): Promise<Blob>` — default `maxEdge ≈ 1024`, JPEG output, orientation honored (`createImageBitmap(file, { imageOrientation: "from-image" })` → canvas). Pure-ish and unit-testable for the dimension math; the canvas/bitmap path is exercised manually.

#### 2. Photo-capture island

**File**: `src/components/library/PhotoCapture.tsx` (new)

**Intent**: The user-facing capture entry point and the orchestrator of the identify→review flow.

**Contract**: A React component rendering a hidden `<input type="file" accept="image/*">` (**no** `capture` attribute, so mobile shows Camera/Photo Library/Files and desktop shows a file picker — both FR-004 paths) behind an "Add via photo" button. On selection: downscale → `POST /api/identify` as multipart with the `photo` blob and `persist`; show a loading state (the read can take several seconds; budget ≤10 s). Branch: `identified` → open `GameDialog` (controlled) seeded with `response.entry` in review/edit mode; `unsure` → show a brief "couldn't identify — add it manually" note and open `GameDialog` in empty add mode; HTTP error (400/401/502) → user-readable message + offer manual add. Props include `platformOptions: string[]` (passed through to `GameDialog`). Reuse the inline `text-destructive` error pattern; no toast library.

#### 3. GameDialog controlled-open mode

**File**: `src/components/library/GameDialog.tsx`

**Intent**: Allow the dialog to be opened programmatically by `PhotoCapture`, seeded with the created entry, without regressing its existing self-triggered usages.

**Contract**: Add optional `open?: boolean`, `onOpenChange?: (open: boolean) => void`, and `hideTrigger?: boolean`. When provided, the dialog is controlled and may omit the `DialogTrigger`; when absent, behavior is exactly as today (internal `open` state + rendered trigger). The existing `entry`-seeded edit mode and the `savedSinceOpen`→refresh-on-close seam continue to apply, so a photo-created entry reviewed here refreshes the list on close like a manual add.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Unit test for `downscaleImage` dimension math (aspect-ratio preserved, long edge clamped to `maxEdge`)

#### Manual Verification:

- Selecting a gallery photo and shooting a new photo both reach the identify call (desktop file picker + mobile chooser sheet)
- Identified read opens the review dialog pre-filled with the saved entry; saving/closing returns to a refreshed library
- Unsure read shows the "couldn't identify" note and opens the empty manual-add form
- A portrait phone photo is identified correctly (EXIF orientation applied — not rotated sideways)
- Loading state is visible during the multi-second read; errors render inline, never a blank/broken state

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Library page integration + cross-browser validation

### Overview

Make "Add via photo" the primary add affordance on the library page (manual entry secondary), surface it in the first-run empty state, ensure the list refreshes after a photo-created entry, and validate the mobile-camera NFR across the four mainstream browsers.

### Changes Required:

#### 1. Header add affordances

**File**: `src/pages/library/index.astro`

**Intent**: Foreground the killer feature — mount the `PhotoCapture` island as the prominent primary action in the library header, with the existing manual `GameDialog` demoted to a secondary "Add manually" affordance.

**Contract**: Render `PhotoCapture` (primary) and the existing manual `GameDialog` (secondary) in the header, both fed `platformOptions`/`platforms`. Preserve current SSR data flow; no API change. Keep an appropriate client directive (e.g. `client:visible`/`client:load`) consistent with the page's existing islands.

#### 2. First-run empty state

**File**: `src/pages/library/index.astro` (empty-state block) and/or the empty-state component it uses

**Intent**: When the library is empty, lead with the photo path as the primary CTA, manual entry as the fallback.

**Contract**: Empty state offers "Add via photo" as the primary CTA and "Add manually" as secondary. Reuse the existing empty-state styling.

#### 3. List refresh on close

**File**: `src/components/library/PhotoCapture.tsx` / `GameDialog.tsx`

**Intent**: After a photo-created entry is reviewed and the dialog closes, the library list reflects it.

**Contract**: Reuse the existing `savedSinceOpen`→navigate/reload seam (`GameDialog.tsx:117, 294-296`) so a photo-created entry triggers the same refresh as a manual add. No new state machinery.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- Formatting passes: `npm run format` (no diffs)

#### Manual Verification:

- End-to-end capture→identify→auto-save→review works on **mobile** Chrome, Firefox, Safari, and Edge with **no desktop step** (NFR guardrail) — both shoot-new and pick-from-gallery
- End-to-end works on desktop Chrome/Firefox/Safari/Edge via the file picker
- "Add via photo" reads as the primary action; "Add manually" remains reachable in one tap; empty state leads with the photo CTA
- A newly photo-added entry appears in the list after the review dialog closes
- Confident-but-no-IGDB-match entry is saved and visible with a no-metadata indication; unsure photo cleanly routes to manual add
- Perceived latency is acceptable on mobile broadband (well inside the 10 s p95 budget); large phone photos upload without hitting the 10 MB cap (downscale working)

**Implementation Note**: This phase carries the binding mobile-camera NFR. After automated verification, complete the cross-browser manual matrix below and confirm before considering the slice done.

---

## Testing Strategy

### Unit Tests:

- `createLibraryEntryFromGrounding` — matched/no_match/null grounding → correct column mapping and `metadata_status` (mocked Supabase).
- `downscaleImage` — aspect ratio preserved; long edge clamped to `maxEdge`; below-threshold images pass through unscaled.

### Integration Tests:

- Manual (no automated integration harness in v1): `POST /api/identify` with/without `persist`, asserting one-vs-zero `library_entries` rows and the response shape, against local `npm run dev`.

### Manual Testing Steps (cross-browser matrix — the NFR guardrail):

For each of mobile **Chrome, Firefox, Safari, Edge** (and a desktop pass each):
1. Tap "Add via photo" → choose **Photo Library / pick existing** → identified entry opens for review → save → appears in library.
2. Tap "Add via photo" → choose **Camera / shoot new** (portrait orientation) → identified correctly (not rotated) → save.
3. Upload a deliberately unidentifiable image → "couldn't identify" → empty manual-add opens.
4. Upload a confident game whose IGDB lookup misses → saved with no-metadata indication.
5. Confirm the multi-second loading state and that no step requires a desktop hop.

## Performance Considerations

- Client-side downscale to ~1024 px keeps mobile uplink small (the unmodeled leg of the 10 s p95 latency NFR) and the base64 vision payload bounded; it is also **required** because workerd cannot resize server-side.
- The identify path runs at most one IGDB lookup (persist reuses the grounding already computed); no added round-trips versus the spike.
- Latency budget has ample headroom: F-03 measured server+model p95 at 3.25 s against the 10 s bar.

## Migration Notes

- No schema migration — entries are written to the existing `library_entries` table via the shipped insert path; RLS already isolates per user.
- No new env/secrets beyond those already declared (`OPENROUTER_API_KEY`, `TWITCH_CLIENT_*`, `IGDB_TOKENS` KV); production use still requires `wrangler secret put OPENROUTER_API_KEY`.

## References

- Change: `context/changes/photo-to-library/change.md`
- Roadmap: `context/foundation/roadmap.md` — S-03 (this slice), F-03, S-09
- PRD: `context/foundation/prd.md` — US-01, FR-004/005/006/008, §Success Criteria > Guardrails, NFRs
- F-03 spike results (error decomposition, ~95% vision read): `context/archive/2026-06-11-photo-identification-spike/results.md`
- S-09 grounding (edition-collapse, platform-alias, false-positive): `context/archive/2026-06-13-enrichment-match-precision/plan-brief.md`
- Lessons: `context/foundation/lessons.md` — Cloudflare binding access via `cloudflare:workers`; platform-aware relation-collapse
- Key files: `src/pages/api/identify.ts:122`, `src/lib/services/library.ts:53`, `src/lib/services/igdb.ts:424`, `src/components/library/GameDialog.tsx:91`, `src/pages/library/index.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server — persist-on-identify

#### Automated

- [ ] 1.1 Type checking passes: `npm run build`
- [ ] 1.2 Linting passes: `npm run lint`
- [ ] 1.3 Unit tests pass for `createLibraryEntryFromGrounding` (matched / no_match / null grounding)

#### Manual

- [ ] 1.4 `persist` off returns unchanged spike shape; `npm run harness` runs and scores as before
- [ ] 1.5 `persist` on + confident matched read creates one row and returns it as `entry`
- [ ] 1.6 Confident read grounding to no_match persists with `metadata_status='no_match'` when `persist` on
- [ ] 1.7 Vision `unsure` read with `persist` on writes nothing and returns `unsure`

### Phase 2: Client — photo-capture island

#### Automated

- [ ] 2.1 Type checking passes: `npm run build`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Unit test for `downscaleImage` dimension math passes

#### Manual

- [ ] 2.4 Gallery photo and new-shot photo both reach the identify call
- [ ] 2.5 Identified read opens review dialog pre-filled with the saved entry; close returns to a refreshed library
- [ ] 2.6 Unsure read shows "couldn't identify" note and opens empty manual-add form
- [ ] 2.7 Portrait phone photo identified correctly (EXIF orientation applied)
- [ ] 2.8 Loading state visible during the read; errors render inline, never blank/broken

### Phase 3: Library page integration + cross-browser validation

#### Automated

- [ ] 3.1 Type checking passes: `npm run build`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Formatting passes: `npm run format` (no diffs)

#### Manual

- [ ] 3.4 E2E capture→identify→auto-save→review works on mobile Chrome/Firefox/Safari/Edge, no desktop step (shoot + gallery)
- [ ] 3.5 E2E works on desktop Chrome/Firefox/Safari/Edge via file picker
- [ ] 3.6 "Add via photo" is primary; "Add manually" reachable in one tap; empty state leads with photo CTA
- [ ] 3.7 Newly photo-added entry appears after the review dialog closes
- [ ] 3.8 Confident-but-no-match saved with no-metadata indication; unsure routes to manual add
- [ ] 3.9 Perceived latency acceptable on mobile broadband; large photos upload without hitting the 10 MB cap
