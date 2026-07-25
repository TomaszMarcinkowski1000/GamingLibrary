---
date: 2026-07-20T00:00:00Z
researcher: Tomasz Marcinkowski
git_commit: d2b1cd46da4370f36923fb467fe15ccd62888f7c
branch: main
repository: GamingLibrary
topic: "Ground test-plan Phase 1 — Grounding & identify-seam integration (Risks #1, #2)"
tags: [research, codebase, identify-seam, igdb-grounding, vision, edition-collapse, fr-006, oracle]
status: complete
last_updated: 2026-07-20
last_updated_by: Tomasz Marcinkowski
---

# Research: Grounding & identify-seam integration (test-plan Phase 1)

**Date**: 2026-07-20
**Researcher**: Tomasz Marcinkowski
**Git Commit**: d2b1cd46da4370f36923fb467fe15ccd62888f7c
**Branch**: main
**Repository**: GamingLibrary

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` ("Grounding & identify-seam integration") in code, for two risks:

- **Risk #1** — the photo path attaches the wrong game/edition/platform metadata, or a thin/ambiguous read false-positives instead of abstaining, and the auto-saved entry is silently trusted.
- **Risk #2** — the photo identify orchestration mis-assembles: un-normalized platform/title reaches grounding, or a `no_match`/abstain still auto-saves a guess instead of routing to manual entry (FR-006).

The task is to **verify, not blindly accept** the test-plan's risk-response guidance: locate the real failure paths, quote them, correct the guidance where code disagrees (research is ground truth, per test-plan §1 principle #3), find existing tests, name the cheapest useful test layer, and flag speculative risk or misleading hot-spot evidence.

## Summary

The seam is real and testable, and grounding it changed three things in the plan's stated response guidance:

1. **Risk #2's framing "a `no_match`/abstain still auto-saves a guess instead of offering manual entry (FR-006)" is imprecise and, taken literally, would produce a wrong test.** The grounded oracle (FR-006 `prd.md:126-127`, US-01 AC `prd.md:58`, `photo-to-library/plan.md:56`) draws the manual-entry line at the **vision layer**, not the IGDB layer. Only a *vision* `unsure` routes to manual entry (empty form, **no save**). A **confident vision read that grounds to IGDB `no_match`** (or whose IGDB call threw) is **deliberately auto-saved** with `igdb_id=null, metadata_status='no_match'`. That is the spec, not a bug. A test that asserts "IGDB `no_match` → route to manual, don't save" would fail against correct behavior — a mirror of a misread requirement. The real regression to guard is that these **two abstain faces never collapse into each other**.

2. **Risk #1's "a thin/ambiguous read yields `no_match`" is only half-implemented.** `isConfidentMatch` (`igdb.ts:403-424`) abstains on *thin/weak* reads (single-char term, name-similarity floor, platform-disagreement veto, obscure-borderline). But there is **no multiple-close-hits disambiguation** — index 0 of IGDB's relevance order is trusted, so two genuinely different real games that both match well will not trigger an abstain. "Ambiguous ⇒ abstain" should be flagged as **unimplemented**, not covered.

3. **The S-09 shelf sample is not a committed fixture.** `fixtures/shelf/` commits only `README.md` + `labels.example.csv`; the real photos and `labels.csv` are gitignored (`.gitignore:46-51`). The grounding oracle **must be authored** as hand-built `Game`-shaped fixtures (mirroring `igdb.test.ts`), encoding the base-game truth from the documented edition-collapse and remake cases — not read from disk and not "whatever IGDB returns."

Beyond those corrections: normalization provably runs before grounding (inside `vision.ts:137-138`, a single choke point); the POST error path does **not** leak provider keys or raw upstream bodies (one residual on the GET path via the third-party IGDB wrapper); and no test touches the identify seam today. The cheapest useful layer for both risks is a **hermetic integration test**: mock the OpenRouter and IGDB HTTP at the network edge, stub the Supabase insert, and **never mock the internal grounding** (`lookupGameMetadata` / `isConfidentMatch` / `collapseToBaseGame`) — that is the seam under test.

## Detailed Findings

### Risk #1 — IGDB grounding: edition-collapse, abstain threshold, and the leak surface

**Entry point.** The route grounds a `(title, platform)` read via `lookupGameMetadata(title, platform, kv)` (`src/lib/services/igdb.ts:437`). It returns a **discriminated union on `status`**, never throws for a miss (`src/types.ts:187`):

```ts
export type IgdbLookupResult =
  | { status: "matched"; igdbId: number; genre: string[]; developer: string[]; series: string[];
      releaseYear: number | null; releaseDate: string | null; lengthHours: number | null; collapsedFrom?: number | null; }
  | { status: "no_match" };
```

**Edition-collapse rule** — `collapseToBaseGame` (`igdb.ts:314-330`). It follows `top.version_parent ?? top.parent_game` (`igdb.ts:317`) **only if the related base still covers the query platform** — `candidateCoversPlatform(related, query.platform)` (`igdb.ts:289-296`). This is the platform-aware collapse the lessons register already codifies (`context/foundation/lessons.md:13-17`): `parent_game` also links remakes/ports to their *original* on older consoles, so a naive follow regresses to a platform that excludes the boxed console. Two skeptical holes to know about when authoring tests:

- The platform gate is **permissive on missing data** (`igdb.ts:291,293`): if the related base has no `platforms.name` populated, collapse proceeds unconditionally.
- The gate **only guards the relation path**. The title-match fallback (`igdb.ts:322-327`) collapses purely on `normalizeBaseTitle` equality + shortest name, with **no platform check**; the only backstop is the downstream `isConfidentMatch` platform veto, and only when both sides resolve to disjoint IGDB ids.

**Abstain / false-positive threshold** — `isConfidentMatch` (`igdb.ts:403-424`), constants at `igdb.ts:345-348` (`MIN_QUERY_INFO_CHARS=2`, `NAME_SIM_FLOOR=0.34`, `NAME_SIM_STRONG=0.8`, `POP_FLOOR=5`). Four branches return `false` → `no_match`: (1) thin query term, (2) name-similarity below floor (Sørensen–Dice token overlap over `normalizeBaseTitle`, maxed across `name` + `alternative_names`), (3) platform veto when both query and candidate resolve to disjoint IGDB ids, (4) borderline name (below `NAME_SIM_STRONG`) that fails the popularity floor. Wired into the service at `igdb.ts:517-519`: `if (!isConfidentMatch(...)) return { status: "no_match" }`. Empty candidate list is a separate `no_match` at `igdb.ts:500-502`.

**The ambiguity gap (correction to plan guidance).** `isConfidentMatch` is pure over the *single* resolved `base` candidate and the query — it never compares candidate[0] against candidate[1]. There is no disambiguation for two plausible different games. "Thin/ambiguous ⇒ abstain" is true for **thin** and **weak/wrong-platform/obscure** reads, but **absent for genuine ambiguity**. The design does honor "result ≠ right result" — `candidates.length > 0` (`igdb.ts:500`) is separate from `isConfidentMatch` (`igdb.ts:517`) — but ambiguity itself is not detected.

**Wrong-metadata leak surface.** A `matched` reads all fields off the *collapsed* `base` (`game`) at `igdb.ts:509,551-561`. The variant's metadata leaks through whenever `collapseToBaseGame` returns the top candidate unchanged *while that top is itself an edition entry* — the two `return { base: top }` branches at `igdb.ts:329` (relation vetoed + no title-match; or no relation + no title-match). In both, `igdbId` = the edition id, and `isConfidentMatch` will usually still pass it (edition entries have strong name-sim and correct platform). This is the precise "attaches the wrong edition metadata" surface.

**Network edge.** `igdb.ts` never calls `fetch` directly — HTTP is owned by `@api-wrappers/igdb-wrapper`; the games query runs at `igdb.ts:499`. The only interception point in-repo is the `fetch` option passed to the client (`igdb.ts:34`, `createTokenCachingFetch`), whose wrapper passes IGDB calls straight through (`igdb-token-cache.ts:57-59`). A test mocks **`globalThis.fetch`** (or injects a stub `fetch` into a hand-built client). The Twitch auth-header/Client-ID shape is built inside the third-party wrapper, not assertable here.

### Risk #2 — identify orchestration: the two abstain faces, normalize-before-ground, secret leakage

**Orchestration shape** (POST, `src/pages/api/identify.ts:117-213`, `prerender=false` at `:10`):

1. Auth gate — `if (!locals.user) return 401` (`identify.ts:118-121`).
2. Parse form / validate image — `request.formData()` then `uploadSchema.safeParse` (`identify.ts:123-136`; 400 on bad/empty/oversized/non-image).
3. Vision read — `identifyGameFromPhoto(dataUrl)` in try/catch → **502 on throw** (`identify.ts:140-148`).
4. **Vision-abstain shortcut** — `if (vision.status === "unsure") return {status:"unsure", confidence}` (`identify.ts:150-152`), **before** any save, on both persist and harness paths.
5. Grounding — `lookupGameMetadata(vision.title, vision.platform, env.IGDB_TOKENS)` in try/catch; **a throw is swallowed → `grounding` stays `null`** (`identify.ts:156-161`).
6. Route/save split — persist branch auto-saves (`identify.ts:167-194`); harness branch folds `no_match`→`unsure` (`identify.ts:200-202`) or returns the identified payload.

**Normalize-before-ground — proven true.** Normalization is a single choke point *inside the vision service*: the `identified` branch returns `title: normalizeTitleCasing(parsed.title)` (`vision.ts:137`) and `platform: normalizePlatformLabel(parsed.platform)` (`vision.ts:138`), both from `src/lib/platforms.ts` (`:150`, `:94`). The route feeds those already-normalized values into grounding (`identify.ts:158`) and save (`identify.ts:175`) unchanged. Within the POST `identified` branch there is **no bypass**. Note: because grounding re-derives its keys via `resolvePlatformIds`/`normalizeBaseTitle` (`igdb.ts`), a normalization miss degrades *display/saved fidelity*, not the matched id — so a normalization test must assert the **displayed/saved** value, and must **not mock the vision module** (mocking it skips the normalizers and makes the assertion hollow).

**The abstain asymmetry — the core of Risk #2 (correction to plan guidance).** Two negative signals are handled deliberately differently, and the route comment says so verbatim (`identify.ts:163-166`: "matched → full metadata, no_match/null → nulls + `no_match`. This INVERTS the harness's no_match→unsure fold… the UI wants the saved entry, not an abstain."):

| Signal | Persist (photo/S-03 UI) path | Oracle verdict |
|---|---|---|
| **Vision `unsure`** (parse-fail, or `confidence < 0.6`, `vision.ts:120-129`) | returns `{status:"unsure"}`, **never inserts** (`identify.ts:150-152`) | ✅ FR-006/US-01: route to manual entry, don't auto-save a guess |
| **Vision confident + IGDB `no_match`/`null`** | **still inserts** a row: `igdb_id=null, metadata_status='no_match'` (`identify.ts:167-194` → `library.ts:143` "insert always happens") | ✅ **By design** — `photo-to-library/plan.md:56`: "a confident read that grounds to `no_match` must persist the entry with `metadata_status='no_match'`… Only `unsure` from the *vision* layer routes to the manual fallback." |

The only guard around the insert is `if (persist)` (`identify.ts:167`); save is gated on `locals.user` + `vision.status !== "unsure"` + `persist=true`, **never on grounding confidence**. So **"a row saved ≠ identify grounded"** — a confident vision read that ground-missed still writes a row. That is correct per spec, but it means any test asserting success via "a row exists" would pass against an un-grounded guess. The test must assert on `metadata_status` / `igdb_id`, not row presence.

**Secret leakage — no leak on POST; one residual on GET.** Provider secrets: `OPENROUTER_API_KEY` (`vision.ts:1`, Bearer at `vision.ts:87`), `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` (`igdb.ts:2,32-33`), `env.IGDB_TOKENS` (KV binding, not a secret string). The vision error path logs the raw upstream body **server-side only** and throws a **status-only** message (`vision.ts:105-112`); the route maps it to a clean 502 (`identify.ts:143-148`). IGDB throws on POST are swallowed (`identify.ts:159-161`). **Residual:** the GET path returns `error.message` at status 502 (`identify.ts:105-108`); those messages originate in the third-party `@api-wrappers/igdb-wrapper`, so if that wrapper ever embedded the Twitch token/`Authorization` header in an error string, the GET route would echo it. Worth one hermetic assertion that the GET 502 body carries neither the Twitch secret nor a bearer token. The POST path is safe because it swallows IGDB errors.

**Auth/session shape a seam test needs.** Both verbs require truthy `locals.user` (middleware-populated; shape not inspected in-route, so any truthy object satisfies it — `identify.ts:119`). The persist path additionally builds a Supabase client via `createClient(request.headers, cookies)` (`identify.ts:168`; `supabase.ts:6-9` returns `null` if `SUPABASE_URL`/`SUPABASE_KEY` unset → 500 "Supabase is not configured"). A POST seam test constructs an `APIContext` with a `multipart/form-data` `Request` (a `photo` `File`, optional `persist="true"`), `cookies`, `locals.user`, env vars set, and a stubbed Supabase insert chain — the `insertClient()` stub in `library.test.ts:23-35` is the ready-made shape.

### The oracle — S-09 shelf sample (must be authored) and the gold rows

**No committed fixture exists.** `fixtures/shelf/` commits only `README.md` + `labels.example.csv`; photos, the real `labels.csv`, and `report.json` are gitignored (`.gitignore:46-51`; `fixtures/shelf/README.md:3-6`). "S-09" is the roadmap slice id for `enrichment-match-precision`, not a data file. The committed `labels.example.csv` gives the **truth-set schema** — `filename,true_title,true_platform,angled,true_igdb_id` (`true_igdb_id` pinned only when title+platform is ambiguous). The oracle for a hermetic test must therefore be **authored as hand-built `Game`-shaped fixtures**, the exact pattern the enrichment change used (`enrichment-match-precision/plan.md:250,255`: "pure functions over hand-built `Game`-shaped fixtures").

**Gold oracle rows (base-game truth, independent of IGDB's current output):**

- **Edition-variant collapse** (box says an edition → must ground to the **base** id, keep boxed platform), from `photo-identification-spike/results.md:34` and `enrichment-match-precision/change.md:15`: *Alan Wake II Deluxe Edition* → base Alan Wake II; *Horizon Forbidden West Complete Edition* → base; *Bloodborne GOTY* → base Bloodborne; *Marvel's Spider-Man* (edition-named entry) → base. (~16 cases enumerated in results.md.)
- **Remake/port platform-agreement** (must resolve to the entry whose platform covers the boxed console, **not** collapse to the older original), from `lessons.md:15-16`: **Dead Space (2023 remake)** → remake entry on current-gen, not the 2008 original; **Super Mario RPG (2023 Switch remake)** → not the SNES original; **Ocarina of Time 3D (3DS)** → not the N64 original.
- **Truth-set cleaning rules** (`fixtures/shelf/README.md:38-54`): drop junk rows (demo-disc compilations, non-games); pin Polish-edition titles to base id (*God of War: Duch Sparty* → Ghost of Sparta; *Star Wars Jedi Ocalały* → Jedi: Survivor); cross-gen platform corrections (Yakuza boxes read **Xbox One**, not Xbox Series X).

**FR-006 contract, verbatim** (`prd.md:126-127`): "After photo identification, the proposed entry is auto-saved into the library; the user can edit or delete it after the fact… auto-save chosen for a smoother happy-path UX. The ≥90% accuracy guardrail makes after-the-fact correction acceptable." FR-006 does **not** contain the "no_match → manual" rule. The manual-entry-on-failure requirement lives in **US-01 AC** (`prd.md:58`: "If the system cannot identify the game from the photo, the user is offered the manual-entry flow rather than an auto-saved guess"), **Guardrails** (`prd.md:43,174`, the binding ≥90% floor for FR-005), and **FR-007** (`prd.md:130-131`, manual add as the safety net). "Cannot identify" = the **vision `unsure`** face, not IGDB `no_match`.

**Precision context (not an oracle — background).** F-03 spike: strict accuracy 71.2% (74/104) → FAIL, but the *vision read* was ~95% and grounding was the bottleneck (`photo-identification-spike/results.md:12,20,76-79`). Enrichment re-measure: 92.9% accuracy-when-answered (92/99) PASS, abstain 13.2% (`enrichment-match-precision/change.md:25`). This confirms the risk lives in **grounding correctness**, not perception.

### Existing tests and precise gaps

- `src/lib/services/igdb.test.ts` — **pure unit tests over hand-built `Game` fixtures**; imports only the pure helpers, never invokes `lookupGameMetadata`, mocks no HTTP. Solid, honestly-oracled coverage of `collapseToBaseGame` (version_parent/parent_game collapse, platform-agreement veto incl. the Dead Space case, title-match fallback, over-collapse guards) and `isConfidentMatch` (thin reject, name mismatch, platform disagreement, popularity floor, alt-name). **Gaps:** no test of the `lookupGameMetadata` wiring (fetch→collapse→confidence→`no_match`|field-map at `igdb.ts:499-561`); no test that returned metadata is read off the **collapsed base, not the edition** (the `igdb.ts:329` leak); no ambiguity test (feature absent); boundary constants (0.34/0.8/5) asserted only implicitly (mutation-survivable); the two permissive-collapse holes untested.
- `src/pages/api/identify.ts` — **no test exists** (confirmed). The `library.test.ts` grep hit is only `createLibraryEntryFromGrounding` (`library.test.ts:111-175`), with Supabase and `./igdb` mocked. The entire orchestration — auth gate, upload validation, vision→normalize→ground→route/save wiring, the persist-vs-harness split, the 502 mapping, secret non-leakage — is untested.
- `platforms.test.ts` / `validation/library.test.ts` — cover the two normalizers and the save DTO directly; **neither asserts that `identifyGameFromPhoto` actually calls the normalizers** (the read↔normalize integration is untested), and no empty-title-through-normalizer case.
- **Test harness gap:** `test/stubs/astro-env-server.ts` (aliased in `vitest.config.ts:15`) exports SUPABASE/TWITCH but **not `OPENROUTER_API_KEY`**, so any test that exercises the real `vision.ts` fetch path throws the missing-key error until the stub is extended.

## Code References

- `src/pages/api/identify.ts:117-213` — POST orchestration (auth → upload → vision → ground → route/save)
- `src/pages/api/identify.ts:150-152` — vision-`unsure` → `{status:"unsure"}`, no save (manual-entry face)
- `src/pages/api/identify.ts:156-161` — grounding call; IGDB throw swallowed to `null`
- `src/pages/api/identify.ts:163-194` — persist branch: `no_match`/`null` still inserts `metadata_status='no_match'`
- `src/pages/api/identify.ts:200-202` — harness branch: `no_match`→`unsure` fold (the inverted, non-persist behavior)
- `src/pages/api/identify.ts:89-115` — GET grounding shortcut; `:105-108` returns `error.message` (GET-only leak residual)
- `src/lib/services/igdb.ts:437` — `lookupGameMetadata` entry point; `:499-561` untested wiring
- `src/lib/services/igdb.ts:314-330` — `collapseToBaseGame`; `:289-296` `candidateCoversPlatform`; `:329` edition-leak fallback
- `src/lib/services/igdb.ts:403-424` — `isConfidentMatch`; `:345-348` thresholds; `:517-519` no_match wiring
- `src/lib/services/vision.ts:77` — `identifyGameFromPhoto`; `:120-129` abstain triggers; `:137-138` normalize choke point; `:84-112` fetch + status-only error
- `src/lib/services/library.ts:143` — insert "always happens"; `:92-120` `metadataFromGrounding`
- `src/lib/platforms.ts:94-96` — `normalizePlatformLabel`; `:150-169` `normalizeTitleCasing`; `:50-87` alias map
- `src/types.ts:187` — `IgdbLookupResult`; `:211-213` `VisionIdentifyResult`
- `src/lib/services/library.test.ts:23-35` — `insertClient()` Supabase-stub pattern to reuse
- `fixtures/shelf/labels.example.csv` — committed truth-set **schema** (no real data); `.gitignore:46-51`
- `context/foundation/prd.md:126-127` (FR-006), `:58` (US-01 AC), `:43,174` (≥90% guardrail), `:130-131` (FR-007)

## Architecture Insights

- **The identify seam has one deliberate asymmetry that is the whole point of the phase:** the manual-entry boundary sits at the **vision layer** (`unsure` → manual, no save), while the **IGDB layer** never routes to manual — a confident read that ground-misses is persisted as `metadata_status='no_match'` for after-the-fact review. Both faces are load-bearing; a regression that merges them breaks either FR-006 (auto-save) or US-01 (no auto-saved guess).
- **Grounding correctness is layered:** `collapseToBaseGame` (which id) then `isConfidentMatch` (is it right enough to attach). "A result exists" and "the result is right" are separate code steps by design — the test strategy should mirror that separation.
- **Normalization is cosmetic to grounding but not to persistence:** `igdb.ts` re-normalizes internally, so the matched id is invariant to casing/alias; the saved/displayed title+platform is where a normalization miss actually shows. This tells you *what to assert* and *what not to mock*.

## Historical Context (from prior changes)

- `context/foundation/lessons.md:13-17` — platform-aware relation-collapse rule (Dead Space/Super Mario RPG/OoT 3D). Directly the Risk #1 collapse oracle.
- `context/archive/2026-06-11-photo-identification-spike/results.md` — F-03 measured 71.2% (FAIL); vision ~95%, grounding the bottleneck; edition-specific first-match the single largest error source.
- `context/archive/2026-06-13-enrichment-match-precision/` — S-09 slice; re-measure 92.9% PASS, abstain 13.2%; edition-collapse cases enumerated; truth-set cleaning rules in `fixtures/shelf/README.md`.
- `context/archive/2026-06-17-photo-to-library/plan.md:56` — the authoritative statement that vision `unsure`→manual and IGDB `no_match`→persist-with-`no_match`.
- `context/archive/2026-06-19-normalize-photo-platform-title/plan.md` — normalization added as a single choke point inside `vision.ts`; grounded id invariant guaranteed.

## Corrections to the test-plan Risk Response Guidance

1. **Risk #2 "abstain/`no_match` still auto-saves a guess instead of offering manual entry (FR-006)"** — reframe. Split into two testable rules: (a) *vision* `unsure` → returns `{status:"unsure"}`, **insert never called** (this is the FR-006/US-01 manual-entry line); (b) confident vision + IGDB `no_match`/`null` → **inserts** `igdb_id=null, metadata_status='no_match'` (correct per spec — assert the row shape, do **not** assert manual routing). The protective assertion is that the two faces stay distinct.
2. **Risk #1 "thin/ambiguous read yields `no_match`"** — split. Thin/weak/wrong-platform/obscure reads abstain (testable against `isConfidentMatch`). **Genuine ambiguity (two close hits) is not detected** — flag as an unimplemented gap; do not write a test that pretends coverage.
3. **"Treat the S-09 shelf sample as an independent truth-set/oracle"** — valid intent, but **no committed fixture exists**; the oracle must be authored as hand-built `Game`-shaped fixtures from the documented base-game truth. Do not read `fixtures/shelf/` at test time.
4. **Hot-spot evidence check** — `src/lib/services` (5 commits/30d) is a *likelihood* signal only, and it holds: the churn is exactly `igdb.ts`/`vision.ts`/`library.ts`, which own the grounding+save decisions. Not misleading.

## Recommended test design (for /10x-plan)

- **Layer:** hermetic integration. Mock `globalThis.fetch` for both OpenRouter and IGDB at the network edge; stub the Supabase insert chain (`library.test.ts:23-35` shape). **Never mock** `lookupGameMetadata`/`isConfidentMatch`/`collapseToBaseGame` (the seam under test) or the `vision.ts` normalizers (mocking either makes the seam hollow).
- **Ordered phases likely:** (1) test-harness setup — extend `test/stubs/astro-env-server.ts` with `OPENROUTER_API_KEY`, add IGDB/OpenRouter `fetch` fixtures; (2) `lookupGameMetadata` wiring tests (edition-collapse to base id, remake platform-agreement, `no_match` on thin/weak/disjoint-platform, metadata read off base not edition) against authored `Game` fixtures; (3) `/api/identify` seam tests (vision-`unsure`→no-save; confident+`no_match`→saved `metadata_status='no_match'`; normalize-before-ground via a raw shouty/aliased read reaching stubbed IGDB normalized; 502 no-leak on OpenRouter non-2xx and GET IGDB throw); (4) cookbook update (§6.2) + plan sync.
- **Oracle discipline:** assert base-game truth and the FR-006/US-01 branch split, never "whatever IGDB returns." Add boundary fixtures at the `isConfidentMatch` constants (0.34/0.8/5) to kill constant mutants (candidate for a selective Stryker pass).

## Open Questions

- **Empty-title edge:** `vision.ts` schema is `z.string()` (no `.min(1)`, `vision.ts:32-36`) with no blank-title guard — a high-confidence empty title passes as `identified`. Is an empty-string title a real vision output worth an abstain/guard, or can't the model produce it? (Affects whether to add a defensive test/assertion.)
- **Ambiguity abstain:** is multiple-close-hits disambiguation in scope for this test phase (would require new code, out of a pure test-writing phase), or is it recorded as a known gap for a later change?
- **GET-path leak residual:** worth one assertion now, or deferred — does the team consider the third-party wrapper's error strings a real exposure given the GET path is harness-only?

## Related Research

- `context/archive/2026-06-11-photo-identification-spike/research.md` — original vision/grounding spike.
- `context/archive/2026-06-07-igdb-metadata-enrichment/research.md` — IGDB enrichment/token-cache background.
