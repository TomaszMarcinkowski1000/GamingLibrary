---
date: 2026-07-25T19:02:50+02:00
researcher: Tomasz Marcinkowski
git_commit: e2de9243b416e77a4168cc43a6f786b4de420d3f
branch: main
repository: GamingLibrary
topic: "Ground rollout Phase 3 — API route contracts + cross-user isolation (Risks #5, #6)"
tags: [research, codebase, api-routes, rls, supabase, validation, vitest, test-harness]
status: complete
last_updated: 2026-07-25
last_updated_by: Tomasz Marcinkowski
---

# Research: Ground rollout Phase 3 — API route contracts + cross-user isolation

**Date**: 2026-07-25T19:02:50+02:00
**Researcher**: Tomasz Marcinkowski
**Git Commit**: `e2de9243b416e77a4168cc43a6f786b4de420d3f` (pushed to `origin/main`)
**Branch**: main
**Repository**: GamingLibrary

> File references are repo-relative `path:line` so downstream `/10x-plan` and
> `/10x-implement` can open them directly. Permalink base for external readers:
> `https://github.com/TomaszMarcinkowski1000/GamingLibrary/blob/e2de9243b416e77a4168cc43a6f786b4de420d3f/<path>#L<line>`

## Research Question

Ground rollout Phase 3 of `context/foundation/test-plan.md`: Risk #5 (cross-user
library exposure — IDOR/RLS gap) and Risk #6 (input-boundary regressions in the
add/edit path). Verify — not accept — the plan's response guidance, ground the
real failure path in code, locate existing tests, identify the cheapest useful
layer, and flag speculative risks or misleading hot-spot evidence. Also ground
`getRecommendations`' uncovered Supabase boundary and the untested `listAllEntries`
(§6.6, Phase 2 mutation pass).

## Summary

**Baseline**: 9 test files, 172 tests, green in 2.7s on `e2de924`. Vitest **4.1.10**.

Both risks are real, but **the test plan's response guidance is wrong about how
each one fails**, in opposite directions. Correcting the guidance is the main
output of this research.

**Risk #5 — the guidance inverts the architecture.** §2's "must challenge" reads
*"an RLS policy exists" is not "the route enforces ownership."* In this codebase
the route deliberately does **not** enforce ownership, and that was a ratified
decision (`archive/2026-06-11-edit-and-delete-entry/plan.md:23`). `library.ts:31-33`
states the rule in production code: *"RLS does user isolation, so these queries
never filter by `user_id` themselves."* Ownership is 100% Postgres, 0% TypeScript.
Consequence: **a stubbed-Supabase test cannot prove Risk #5 at all** — it would
assert the fake's own configuration and read as coverage while proving nothing.
Also, the "GET / PUT / DELETE" verb list is unimplementable: there is no
GET-by-id route anywhere, and **PATCH** — a real write path — is missing from the
guidance.

**Risk #6 — two of three failure modes are inverted or unbuilt.** "Prove a decimal
length saves" would assert a divergence the team deliberately closed the other way
(H-02 ceils at the IGDB source and left the integer-only input intact, on purpose).
"Prove platform aliases normalize" would assert a feature that was **explicitly
scoped out** of the manual path (H-03). And "the zod parity between client and
server" describes something that does not exist — **there is no client-side zod**;
the client's constraints are two `.trim()` truthiness checks plus HTML5
`type="number"`.

**Hot-spot evidence for Risk #6 is mislabeled.** §2 cites `src/components/library`
at "10 commits/30d". That is **10 commits all-time**. In the 30-day window the plan
was authored in it was 3; in the last 30 days it is **0**. The directory that
actually carries Risk #6's failure is `src/lib/validation/` + `src/pages/api/library/`,
and `src/pages/api/library/` has had **3 commits ever**, the last on 2026-06-13.

**Harness**: `test-plan.md:114` ("Route/Worker integration — none yet … needs a
Worker/Miniflare-style harness") is stale. Phase 1 already shipped a route harness:
`src/pages/api/identify.test.ts:31` imports the handler directly and hands it a cast
`APIContext`. It stretches to the library routes with ~5 lines of change each.
Miniflare/workerd is rejected; the Astro Container API buys ceremony, not signal.

**Recommended shape: two vitest projects covering disjoint failure sets.**
A hermetic project (direct handler invocation + stubbed Supabase) carries every
route contract and all of Risk #6. A real-local-Supabase project — a handful of
tests, two real JWTs — carries Risk #5 and nothing else. They are not substitutes.

---

## Detailed Findings

### A. Risk #5 — cross-user library exposure

#### A1. The actual authenticated surface (the verb list in §2 is wrong)

| Route | Verb | `locals.user` guard | Table access |
|---|---|---|---|
| `src/pages/api/library/index.ts:26` | POST | yes, **after** the config check (`:32`) | `createLibraryEntry` → `insert` |
| `src/pages/api/library/[id].ts:14` | PUT | yes, after config check (`:20`) | `updateLibraryEntry` → `update().eq("id")` |
| `src/pages/api/library/[id].ts:60` | **PATCH** | yes, after config check (`:66`) | `updateLibraryEntry` |
| `src/pages/api/library/[id].ts:104` | DELETE | yes, after config check (`:110`) | `deleteLibraryEntry` |
| `src/pages/api/library/lookup.ts:17` | POST | yes, **first line** (`:18`) | none — never touches Supabase |
| `src/pages/api/identify.ts:117` | POST | yes, first (`:119`) | insert, only inside the `persist` branch (`:168`) |
| `src/pages/library/index.astro:46` | page GET | none of its own — middleware | `listLibraryEntries`, 2 RPCs |
| `src/pages/play-next/index.astro:23` | page GET | none of its own — middleware | `getRecommendations` → `listAllEntries` |

**There is no GET-by-id endpoint and no GET list endpoint.** `src/pages/api/library/`
contains exactly `index.ts` (POST), `[id].ts` (PUT/PATCH/DELETE), `lookup.ts` (POST).
Every read of `library_entries` happens in `.astro` frontmatter or via the two RPCs.

**Corrected wording for `test-plan.md:77` "What would prove protection":**

> A request authenticated as user A is rejected (404) for user B's resource id
> across **PUT / PATCH / DELETE**, and the page-level list read plus the two facet
> RPCs return only A's rows.

Note the by-id *read* vector still exists: PUT and PATCH return the full row in the
body (`Response.json({ entry })`, `[id].ts:43`, `:89`), so a successful cross-user
write is simultaneously a cross-user read.

#### A2. Ownership is enforced only by RLS — by design, ratified

`src/lib/services/library.ts:31-33`:

```
 * Owns create-with-enrichment, paginated listing, and used-platform queries so API
 * routes and pages stay thin. Every function takes an already-authenticated Supabase
 * client (the non-null return of `createClient`) as its first arg — RLS does user
 * isolation, so these queries never filter by `user_id` themselves.
```

`src/lib/services/library.ts:164` (update) and `:183` (delete):

```ts
const { data, error } = await supabase.from("library_entries").update(patch).eq("id", id).select().single();
if (error) {
  // PGRST116 = "no rows returned" for a `.single()` that matched nothing → not found.
  if (error.code === "PGRST116") { throw new EntryNotFoundError(id); }
  throw error;
}
```
```ts
const { data, error } = await supabase.from("library_entries").delete().eq("id", id).select("id");
if (error) { throw error; }
if (data.length === 0) { throw new EntryNotFoundError(id); }
```

`.eq("id", id)` is the *only* predicate the application writes. Postgres silently
ANDs the policy's `USING (auth.uid() = user_id)` onto the statement, so user B's id
matches zero rows — and a zero-row UPDATE/DELETE **is not an error in SQL**. The 404
therefore comes entirely from the *returning* set: `PGRST116` on `.single()`, `[]`
on `.select("id")`. Routes map `EntryNotFoundError` → 404 (`[id].ts:45`, `:91`, `:123`).
A foreign id and a nonexistent id are indistinguishable to the client — correct,
non-enumerable behaviour.

This was decided deliberately, not by omission —
`context/archive/2026-06-11-edit-and-delete-entry/plan.md:23`:

> **RLS already covers update + delete** … A miss (wrong/foreign id) returns **zero affected rows**.

and `:52`:

> **No-row update/delete is a 404, not a success.** Supabase returns no error when
> `.update()/.delete().eq('id', …)` matches zero rows (wrong id, or another user's
> row hidden by RLS).

403 was never considered (zero occurrences in the change folder). Cross-user access
*was* considered — but only as a manual verification step (`plan.md:249`: *"As a
second user, attempt PUT/DELETE against user 1's id (via devtools) → 404"*, marked
done). **That manual check is exactly what Phase 3 should automate.**

#### A3. Live database verification (independently re-run in the main context)

Local stack is up (11 `supabase_*` containers). Queried read-only against
`supabase_db_10x-astro-starter`:

```
-- pg_policy on public.library_entries
Users select own entries|r|(auth.uid() = user_id)
Users insert own entries|a|            (WITH CHECK auth.uid() = user_id)
Users update own entries|w|(auth.uid() = user_id)
Users delete own entries|d|(auth.uid() = user_id)
```

Policies match `supabase/migrations/20260606150950_create_library_entries.sql:34-44`
exactly — 4 policies, all `to authenticated`, none for `anon`, no extras.
`relrowsecurity = t`. Both RPCs are still `security invoker` (`prosecdef = f`) with
`search_path = ''` pinned.

**The finding that matters:**

```
-- role_table_grants on library_entries
anon         |DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
```

`anon` holds **full table grants** (Supabase default privileges). The migration
comment at `:5` — *"The anon role is granted no policy and therefore has no access"* —
is accurate as written, but the *absence of a policy is the entire defense*, not
defense in depth. `service_role` and `postgres` carry `rolbypassrls = t`.

#### A4. What each layer can and cannot prove (the core deliverable)

**A hermetic stubbed-Supabase test catches:**
- removal/reordering of the `if (!locals.user)` guard → wrong status code;
- `PGRST116` / empty-delete-set no longer mapping to `EntryNotFoundError` → a 500 or a misleading 204;
- the predicate drifting — `eq()` args are already asserted this way at `library.test.ts:206`, `:237`;
- an attacker-supplied `user_id` in the JSON body reaching the patch (zod strips it — `updateEntrySchema` has no `user_id` key, `validation/library.ts:32-46`);
- a malformed (non-UUID) `params.id` → Postgres `22P02` → **500, not 404** (no UUID validation anywhere; `[id].ts:25/:70/:114` only check `if (!id)`);
- response shape: `{ entry }` on 200, empty body on 204.

**It cannot prove anything about isolation.** The stub returns whatever it was
configured to return; the same test passes green against a database with RLS
disabled entirely.

**Only a real-Postgres two-user test catches** (each invisible to every stub, and
several leave the app returning a 200 with a correct-looking shape):

1. **`drop policy "Users select own entries"`** — no TypeScript changes at all. Sharpest face: with only SELECT dropped, `update().select().single()` still *performs the write* but the RETURNING set filters to empty → `PGRST116` → **the route answers 404 while the row was actually mutated.** Structurally impossible to see without real RLS.
2. **A policy widened to `to anon`, `using (true)`, or a `for all` catch-all** — one line of SQL from a full breach, because `anon` already holds every table grant (A3).
3. **`SUPABASE_KEY` swapped for the service/secret key.** `service_role` has `rolbypassrls = t`. The cookie session still resolves, `locals.user` still populates, every auth guard still passes, and every query silently returns *all users' rows*. No unit test, type check, lint, or hermetic route test detects this. `context/changes/deployment/deployment-plan.md:107` already warns about the copy-paste.
4. **`security invoker` → `security definer` on the two RPCs.** Both currently carry an explicit `user_id = (select auth.uid())` predicate, so flipping alone would still scope correctly — but definer runs as an owner with BYPASSRLS, so **RLS stops being the backstop** and the explicit predicate becomes load-bearing alone.
5. **Dropping `user_id`'s `default auth.uid()` or the INSERT/UPDATE `WITH CHECK`** — the only thing preventing a row transfer if `user_id` were ever added to `updateEntrySchema`.
6. **The 404 itself** — only a real second user proves the 404 is caused by RLS rather than by the id happening not to exist.

**Design implication:** the two layers cover *disjoint* failure sets. Cover the
handler contract hermetically because it's cheap; cover isolation against real
Postgres because nothing else can. One two-user test exercising PUT/PATCH/DELETE by
foreign id, plus one list read and one facet RPC, covers items 1–6.

#### A5. The guard-order trap (unstated in the risk, and it will bite a test)

The four `library` handlers check `if (!supabase)` **before** `if (!locals.user)`:

```ts
// src/pages/api/library/[id].ts:15-22
const supabase = createClient(request.headers, cookies);
if (!supabase) { return Response.json({ error: "Supabase is not configured" }, { status: 500 }); }
if (!locals.user) { return Response.json({ error: "Not authenticated" }, { status: 401 }); }
```

`lookup.ts:18` and `identify.ts:90/:119` check auth **first**. Under vitest,
`test/stubs/astro-env-server.ts` leaves `SUPABASE_*` `undefined` on purpose — so an
unauthenticated request to `PUT /api/library/[id]` returns **500, not 401**, and any
401 assertion is vacuous unless `@/lib/supabase` is mocked (as `identify.test.ts:29`
does). It also means a misconfigured production deploy leaks *"Supabase is not
configured"* to anonymous callers instead of a 401. Low severity, but it is an
inconsistency worth pinning as an explicit contract decision rather than leaving as
an accident. Relevant oracle: `prd.md:188` — *"unauthenticated requests to any
library route are rejected."*

Two smaller notes: `middleware.ts:12` uses `auth.getUser()` (server-validated), not
`getSession()`, so a forged cookie cannot populate `locals.user` — the auth guard is
sound. And `src/pages/api/auth/signup.ts:5-7` does `await request.formData()`
unguarded — a non-form body throws → unhandled 500. Not an isolation issue; noted
for completeness, and §7 excludes auth internals anyway.

#### A6. Speculative: the "search / filter / recommend returns another user's rows" clause

**Not a distinct attack surface.** Three independent reasons:

1. The search term never reaches a filter *string*. `query.ilike("title", "%…%")`
   (`library.ts:263`) sends the pattern as a discrete URL-encoded PostgREST value.
   **There is no `.or(`, no `.filter(`, and no raw PostgREST filter string anywhere
   in `src/`** — the greps hit only `Array.prototype.filter` and a zod `.or()`.
   `escapeLikeTerm` (`library.ts:200-202`) is a *correctness* guard (a search for `%`
   would over-match), not an isolation guard.
2. Even a hypothetical operator injection only adds a `WHERE` term. Postgres appends
   the RLS qualifier at plan time; no query-string content can remove or OR-away a
   row-security clause. A widened filter widens *within the user's own rows*.
3. The filter dimensions are populated from `library_facets()`, itself `user_id`-scoped.

Everything user-controlled that reaches a query is whitelisted or clamped:
`status` against `PLAY_STATUSES` (`library/index.astro:29`), `sort` against
`LIBRARY_SORTS` (`:34`), `page` clamped (`:19`, `library.ts:294`), `length`/`mode`
via `parseRecommendationParams` (`validation/library.ts:100`). `platform`/`genre`/
`series` pass through verbatim into `.in()`/`.overlaps()` — but that widens only
within RLS. `listAllEntries` takes no caller-supplied filter at all.

**Recommendation:** fold this clause into a *single* list-read isolation assertion
rather than enumerating filter dimensions. It is the same single dependency (RLS on
SELECT) reached through zero extra machinery.

#### A7. No privileged client exists

One client constructor repo-wide: `src/lib/supabase.ts:10`,
`createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, …)`. Every call site routes
through it; no second `createClient` import from `@supabase/supabase-js` anywhere.
`astro.config.mjs:27-35` declares exactly five secrets — **no service-role field
exists in the env schema**, so even a leaked key has no declared channel into the
app. `wrangler.jsonc` binds only the `IGDB_TOKENS` KV. `scripts/identify-harness.mjs`
never touches Supabase; it signs in through the real route and replays session
cookies.

---

### B. Risk #6 — input-boundary regressions in the add/edit path

#### B1. There is no client-side zod — the "parity" framing has no referent

`test-plan.md:78` asks research to ground *"the zod parity between client and server."*
`grep 'from "zod"'` over `src/` hits only `pages/api/library/index.ts`,
`lib/validation/library.ts`, `pages/api/identify.ts`, `pages/api/auth/signin.ts`,
`lib/services/igdb.ts`, `lib/services/vision.ts`. **Zero component files.**

The entire client validation is `src/components/library/GameDialog.tsx:178-188`:

```ts
function validate(): boolean {
  const next: Record<string, string> = {};
  if (!values.title.trim())    { next.title = "Title is required"; }
  if (!values.platform.trim()) { next.platform = "Platform is required"; }
```

…plus HTML5 constraint validation, which is live because the dialog's `<form>` has
no `noValidate` (`GameDialog.tsx:379-385`) — unlike the auth forms
(`SignInForm.tsx:43`).

So the real parity contract is **hand-rolled client checks + HTML5 attributes vs.
server zod**, and it is provable with zero infrastructure.

#### B2. Decimal length — real, but inverted, and it is an FR-010 violation

Layer by layer:

| Layer | Decimal `length_hours`? |
|---|---|
| DB — `length_hours numeric` (migration `:17`, no precision, no check) | **accepts** |
| Server — `z.number().min(0).nullable()`, **no `.int()`** (`validation/library.ts:41`) | **accepts** |
| IGDB write path — `lengthHoursFromSeconds` = `Math.ceil` (`igdb.ts:163-168`) | **never produces one** |
| Client — `<Input type="number" min={0}>` with **no `step`** (`GameFormFields.tsx:196-205`) | **rejects** (HTML5 default `step="1"`) |

Verified: `grep 'step=|inputMode|parseFloat|parseInt|toFixed|Math.round'` across `src/`
returns **zero hits** in any form component. Both number inputs run on the implicit
`step="1"`.

The archived fix knew this and declined to change the form —
`context/archive/2026-06-19-fix-decimal-game-length/plan.md:29`:

> **No form changes** — `step` stays as-is on `length_hours` and `play_time_hours`;
> the integer input is acceptable once IGDB yields integers.

with the gap accepted at `plan-brief.md:53`: *"If decimal rows ever exist, editing
them would still hit the integer-input block — out of scope here."*

**The live consequence, and the strongest oracle available.** A row whose
`length_hours` is fractional pre-fills the edit dialog via `mapEntryToValues`
(`GameDialog.tsx:73`) as e.g. `12.5`, and that row becomes **entirely un-editable**:
the browser blocks the whole form submit no matter which field the user was trying
to change, via a native validation bubble rather than the dialog's own error UI.
That is a violation of `prd.md:140` **FR-010 — "User can edit any field of a library
entry after creation. Priority: must-have"** — not a cosmetic input quirk. Note
`src/lib/services/library.test.ts:45,70` already documents the service persisting
`length_hours: 12.5`.

**Skeptical caveat:** with `lengthHoursFromSeconds` in place no *current* code path
writes a fractional length. This is a legacy-data / future-path hazard, not
something a user hits on a fresh add today.

**Correction to `test-plan.md:78`:** "prove a decimal length saves" would assert the
schema layer, pass trivially, and *not* catch the bug it names — a green test over
the exact failure. If the plan wants this covered, the assertable statement is
*"an entry carrying a fractional `length_hours` remains editable"*, and the only
layer that can see it is a browser test (Phase 4), or a production change to add
`step="any"`. A test-writing phase changes no production behaviour (§7), so the
honest Phase 3 output here is **a recorded code gap, not a test**.

#### B3. Platform normalization — a gap, not a drift, and deliberately scoped out

Every production call site of the normalizers, repo-wide (verified by direct grep):

```
src/lib/services/vision.ts:137:    title: normalizeTitleCasing(parsed.title),
src/lib/services/vision.ts:138:    platform: normalizePlatformLabel(parsed.platform),
```

That is **all of them**. The only other hits are the definitions in
`src/lib/platforms.ts:94,150` and `src/lib/platforms.test.ts`.

- **Manual add (POST `/api/library`) — NOT normalized.** `index.ts:16` is
  `platform: z.string().trim().min(1, …)` (trim only); `library.ts:59` destructures
  `const { title, platform } = input;` and `:71-73` writes it verbatim. `library.ts`
  does not import `@/lib/platforms` at all.
- **Manual edit (PUT `/api/library/[id]`) — NOT normalized.** `validation/library.ts:34`
  trims only; `[id].ts:42` forwards `parsed.data` to `updateLibraryEntry`, which
  `.update(patch)`es it verbatim (`library.ts:164`).
- **Photo/identify — normalized.** `identify.ts:175-179` feeds the already-normalized
  `vision.platform` straight to the insert.
- **Client-side — none.** `PlatformCombobox.tsx:33-42` lowercases only for filtering
  and the create-vs-exists decision; the create branch selects the raw trimmed query
  (`:108`). The component does not import `@/lib/platforms`.

**The asymmetry, stated plainly:** a photo read of `"PS5"` persists as
`"PlayStation 5"`; a user who types `ps5` and clicks `Create "ps5"` persists as
`"ps5"`. Two rows, two platform strings, same console. Blast radius: the platform
filter is an exact-match `.in()` (`library.ts:269`), and `list_used_platforms`
dedupes only `distinct on (lower(trim(platform)))` — so the two collapse for casing
but remain two facet values and two filter buckets.

**But this was decided on purpose** —
`context/archive/2026-06-19-normalize-photo-platform-title/plan.md:61-63`:

> **Not touching the manual-add path** (`createLibraryEntry`, `library.ts:55`). It
> seeds platforms from the canonical `KNOWN_PLATFORMS` picklist and takes a
> user-typed title — neither is a shouty model artifact. Normalizing user input
> there is out of scope.

**Correction to `test-plan.md:54`/`:78`:** framing un-normalized manual platform as a
*regression* is wrong — it was never normalized there. A Phase 3 test asserting
normalization on POST `/api/library` **would fail**, and would be testing an unbuilt
feature. There is also **no spec oracle**: the words "normalize" and "alias" do not
appear in `prd.md` in any platform context. The closest indirect argument is
`prd.md:146` (FR-019, filter by platform) — a filter list offering `ps5` and
`PlayStation 5` as separate entries is arguably a defect, but you have to argue for it.

The assertable Phase 3 statement is the *characterization*: **the manual and photo
paths persist platform differently** — recorded as documentation-of-behaviour, which
is exactly the §6.5 discipline Phase 2 established.

#### B4. The parity breaks that ARE real (and are not in the risk statement)

Three, all uncovered:

1. **`PATCH` / `PlayStatusControl` silently truncates.** `patchEntrySchema`
   (`validation/library.ts:63-70`) is the one schema whose client bypasses HTML5
   validation entirely — the hours input is not inside a `<form>` and Save is
   `type="button"` (`PlayStatusControl.tsx:231`). `PlayStatusControl.tsx:129-139`:

   ```ts
   function handleSave() {
     const trimmed = hoursInput.trim();
     let hours: number | undefined;
     if (trimmed !== "") {
       const parsed = Math.trunc(Number(trimmed));
       hours = Number.isFinite(parsed) ? parsed : undefined;
     }
   ```

   `"12.9"` → `12`, silently, with no user feedback — and with *different* rounding
   semantics from `lengthHoursFromSeconds`'s `Math.ceil`. `"-5"` passes the client,
   is rejected by zod `.min(0)`, and the user sees the **raw zod message** surfaced
   verbatim (`[id].ts:84` returns `parsed.error.issues[0]?.message`).
   **`patchEntrySchema` has zero tests** — including its `.refine()` "at least one
   field is required" rule.

2. **Server is looser than the DB on integer columns.** `release_year`
   (`z.number().int().nullable()`, no min/max) and `play_time_hours`
   (`.int().min(0)`, no max) both accept values beyond `int4`. Postgres raises
   `22003`, the route's catch-all answers **500 "Failed to update the entry"**
   instead of a 400. Same class as the non-UUID `params.id` → `22P02` → 500 (A4).
   No PRD line bounds these; the DB column type is the de-facto ceiling.

3. **Client is stricter than server on `length_hours`** (B2). Benign in the
   security sense — but it is the actual, provable parity divergence, and it runs
   the opposite direction from §2's *"the server rejects what the client rejects."*

The one input-boundary rule with a real spec oracle is `prd.md:70`: *"Optional play
time field (hours) accepts a **non-negative integer**; empty means unset."* It is
enforced three times — `updateEntrySchema` (`validation/library.ts:36`),
`patchEntrySchema` (`:66`), and the DB `check (play_time_hours >= 0)` (migration `:14`).
Also spec-backed: `prd.md:94` *"Title and platform are required; all other fields are
optional at creation."*

#### B5. What already exists

`src/lib/validation/library.test.ts` — six `updateEntrySchema` assertions (`:20-56`):
valid full payload; rejects `title: "   "`; rejects `play_status: "abandoned"`;
rejects `play_time_hours: -1`; trims/drops empty tag-array items; `date_bought: ""`
→ `null`. The rest of the file is `parseRecommendationParams`.
**Not asserted anywhere:** `length_hours` (the `VALID` fixture uses integer `50`),
`platform` min-length, `release_year`, `igdb_id`, `metadata_status`, `release_date`,
`patchEntrySchema` (nothing), `lookupRequestSchema` (nothing), and `createEntrySchema`
(nothing — note it is defined **inline in the route** at `index.ts:14-17`, a duplicate
of `lookupRequestSchema` at `validation/library.ts:79-82`).

`src/lib/platforms.test.ts` — 13 `normalizePlatformLabel` assertions + 9
`normalizeTitleCasing` cases. **The pure functions are well covered; adding more
would be busywork.** What is uncovered is the *wiring*: which route calls which
normalizer.

**No test file exists for any `src/pages/api/library/**` route. There are no
component tests at all (no `.test.tsx` anywhere).**

---

### C. `getRecommendations` / `listAllEntries` (§6.6 carry-over)

**`getRecommendations` is a real exported function in a plain `.ts` module — it is
importable by the current harness today, with zero production edits.**
`src/lib/services/recommendation.ts:218-227`:

```ts
export async function getRecommendations(
  supabase: TypedSupabaseClient,
  request: RecommendationRequest,
  limit = 10,
): Promise<RecommendationResult> {
  const entries = await listAllEntries(supabase);
  return recommend(entries, request, limit);
}
```

The Phase 2 extraction precedent (`emptyStateMessage` moved out of `.astro`
frontmatter) **does not apply** — nothing needs moving. Its one caller is
`play-next/index.astro:32`, inside a `try/catch` → `loadError`. `listAllEntries`
(`library.ts:339-348`) has exactly one caller (`recommendation.ts:225`) and no test.

The Phase 2 triage block says it plainly — `recommendation.test.ts:67-69`:

> ` * - :224 the getRecommendations body: the Supabase I/O boundary, out of scope for a unit`
> ` *   harness. This one leaves a genuine hole rather than a covered one — listAllEntries has no`
> ` *   test anywhere in the repo, and there is no e2e layer yet (test-plan Phases 3-4).`

**What a test would actually prove:**

- *Cheap, stubbed, today's harness:* `listAllEntries` selects exactly the columns the
  engine reads and applies the row cap; it throws on `{ error }` rather than
  returning garbage; `getRecommendations` passes `limit` through and propagates a
  throw (so `play-next`'s `loadError` branch is reachable). The chainable-stub
  pattern at `library.test.ts:289-325` already does this style of arg capture.
  **Caveat:** `RECOMMENDATION_MAX_ROWS = 5000` is an internal guardrail with no PRD
  anchor (`archive/2026-06-13-play-next-recommendation/reviews/impl-review.md:40-41`
  calls it a defensive cap with "no behavior impact at real scale"). Asserting `5000`
  literally is exactly the mirror anti-pattern `test-plan.md:78` warns about. The
  column-list assertion is defensible if derived from *what `recommend()` reads*
  (a dropped `length_hours` silently breaks FR-016), not from a copied string.
- *Needs real RLS:* "only the current user's rows come back." No stub can reach it.
  Fold this into the same two-user test as A4 rather than treating it as separate work.

**Not testable today, and a genuine extraction candidate** — `library/index.astro`
frontmatter: param parsing/whitelisting (`:18-34`), the curated + used-platform merge
with case-insensitive dedupe (`:72-81`), the out-of-bounds page clamp + re-fetch
(`:83-102`), and the `isEmpty` vs `noMatches` vs `loadError` state selection
(`:107-115`). That last one maps to a user-visible contract (which empty-state copy
appears) and is the closest analogue to Phase 2's `emptyStateMessage` extraction. It
is **not** required by Risks #5/#6 — flag it, don't scope it in by default.

---

### D. Harness — the cheapest useful layer

#### D1. The precedent already exists (§4 of the test plan is stale)

`src/pages/api/identify.test.ts` invokes the route by **direct import of the exported
handler plus a hand-built, cast `APIContext`**. No Astro machinery, no HTTP.

```ts
// identify.test.ts:24-34
vi.mock("cloudflare:workers", () => ({ env: { IGDB_TOKENS: {} } }));
const holder = vi.hoisted((): { supabaseClient: unknown } => ({ supabaseClient: null }));
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => holder.supabaseClient) }));
import { GET, POST } from "./identify";
```
```ts
// identify.test.ts:90-97
function postContext(form: FormData | undefined, user: unknown = { id: "user-1" }) {
  const request = new Request("https://test.local/api/identify", { method: "POST", body: form });
  return { request, cookies: {} as never, locals: { user } } as unknown as Parameters<typeof POST>[0];
}
```

**Deltas to reach the library routes:**
- `[id].ts` — add `params: { id }` to the context factory (one extra key); **drop**
  the `cloudflare:workers` mock (it doesn't import it); body is JSON not FormData.
- `index.ts` — no `params`, but it **does** `import { env } from "cloudflare:workers"`
  (`:2`) and passes `env.IGDB_TOKENS` (`:49`), so it needs that mock *and* either
  `installFetchRouter` for the IGDB edge or a `vi.mock("@/lib/services/igdb")`,
  because `createLibraryEntry` really calls `lookupGameMetadata`. This is the single
  biggest cost difference between the two files.

**Supabase stubs: extraction, not authoring.** Every chain the library service uses
is already modelled — `insertClient` (`library.test.ts:23-35`, duplicated at
`identify.test.ts:43-52`), `updateClient` (`:179-197`, captures patch + `eq` args),
`deleteClient` (`:219-231`), `listClient` (`:249-265`), `filterListClient`
(`:289-325`). There is no reusable exported helper — every fake is inlined per file.
Phase 3's real work is lifting these into `test/helpers/supabase-mock.ts` and
de-duplicating the two `insertClient` copies. One gap: no builder captures
`select("*", { count, head })`'s second argument, so `head: true` vs `false` is
unobservable today.

#### D2. Real local Supabase — feasibility GREEN, cheaper than the plan assumed

- Docker up; full stack healthy (`supabase_db`, `_auth`, `_rest`, `_kong` on 54321).
- `supabase/config.toml:210` — **`enable_confirmations = false`**. This is the
  decisive line: two real users and two real JWTs is four lines of setup — two
  `signUp({ email: \`a-${unique}@test.local\`, password })` calls against the
  publishable key, each returning `data.session.access_token` immediately. No
  mailbox, no admin API, no service-role key in the test.
- Injection reuses the *existing* seam: `vi.mock("@/lib/supabase", () => ({ createClient: () => realClientForUser }))`
  where `realClientForUser` carries `Authorization: Bearer <jwt>`. Sidesteps
  cookie-jar construction while still hitting PostgREST with a genuine `authenticated`
  JWT, so RLS really evaluates.
- **Constraint:** `test/setup/no-network.ts` installs a deny-all `globalThis.fetch`.
  A real-Supabase suite must live in a **separate vitest project** with different
  `setupFiles`, or restore the pristine fetch.
- `config.toml:60-65` already declares `[db.seed] sql_paths = ["./seed.sql"]`, so a
  seed file works with zero config change (none exists today).
- CI: `.github/workflows/ci.yml` currently runs lint + build and has **no `npm test`
  step at all**. Adding Supabase means `supabase/setup-cli@v1` + `supabase db start`
  (~60–120 s warm) alongside finally wiring `npm test`. Wiring the test gate is
  Phase 5's job (`test-plan.md:144`); Phase 3 should not silently absorb it.

Supabase's own docs (Context7, `/supabase/supabase`, checked 2026-07-25) publish both
patterns: an application-level Vitest + `supabase-js` two-user RLS suite, and a
pgTAP suite under `supabase/tests/database/` run by `supabase test db`. The pgTAP
route tests the *policies* directly and is the cheaper thing to keep green in CI;
the Vitest route tests *our route's translation of RLS*, which is the thing Risk #5
actually names. They are complementary, and pgTAP is the better fit if the team wants
isolation coverage without a JS-side Docker dependency.

#### D3. Rejected options

**`@cloudflare/vitest-pool-workers` / miniflare — reject.** Zero occurrences in the
repo (miniflare is transitive via wrangler only). `wrangler.jsonc` `main` is
`@astrojs/cloudflare/entrypoints/server` with `assets.directory: "./dist"`, so the
Worker entry only exists after `astro build`. And per Cloudflare's own docs
(Context7, `/cloudflare/workers-sdk`): *"`vi.mock()` calls in tests cannot intercept
the worker's entry-point imports since they're loaded directly through Vite's
resolveId/load plugin hooks"* — which discards this repo's entire mocking strategy
(`vi.mock("@/lib/supabase")`, `vi.mock("cloudflare:workers")`, `installFetchRouter`).
High cost, and it still proves nothing about isolation without real Supabase, at
which point Supabase does the work and workerd is overhead. If a Worker-specific
concern surfaces, it belongs in §5's "pre-prod smoke", not the integration tier.

**Astro Container API — skip.** `astro/container` resolves under plain Node (Astro
6.3.1) and does support `renderToResponse(Endpoint, { routeType: "endpoint" })` with
`params` and `locals`. It buys a genuine `AstroCookies` and a genuine `params` object.
It does **not** run `src/middleware.ts`, does not load the Cloudflare adapter (so
`env.IGDB_TOKENS` stays undefined), and still needs every existing `vi.mock`.
Marginal gain, non-zero cost, `experimental_` prefix.

#### D4. Vitest 4 notes for whoever wires this

Installed **4.1.10** (`npx vitest --version`), not the 3.x §4 claims.
- **`test.workspace` → `test.projects`.** Directly relevant: the two-project shape
  above. `workspace` is gone.
- `environment: "node"` and `setupFiles` are unchanged — the current config needs no
  migration.
- `vi.mock` hoisting and `vi.hoisted` unchanged; the `identify.test.ts` pattern is
  v4-correct as written.
- The `basic` reporter was removed (confirmed by running it — startup error).
- `vi.spyOn` typing changed; the repo already carries the workaround at
  `identify.test.ts:111-113` — *"vitest 4's `spyOn` is overloaded, so
  `ReturnType<typeof vi.spyOn>` collapses to `any`; name the spied procedure instead"*
  → `let errorSpy: MockInstance<typeof console.error>`. Copy that idiom.

#### D5. Stryker scope for a Phase 3 mutation pass

`stryker.config.json` mutates `src/**/*.ts` minus tests/`.d.ts`/`database.types.ts`.
Note the glob is `*.ts` only — **`.tsx` is excluded**, so `GameDialog.tsx` (the
client half of Risk #6) is out of scope unless the array is widened. Per `CLAUDE.md`,
narrow anyway: `--mutate "src/pages/api/library/[id].ts"` and
`--mutate "src/lib/validation/library.ts"`, one file per invocation.

---

### E. Hot-spot evidence check

§2 cites `src/components/library` at **"10 commits/30d"** as Risk #6's likelihood
evidence. Measured on `e2de924`:

| Window | `src/components/library` | `src/pages/api` | `src/lib/services` | `src/` total |
|---|---|---|---|---|
| last 30d | **0** | 4 | 9 | 11 |
| 2026-06-18 → 07-18 (plan authored 07-18) | **3** | 1 | 3 | 5 |
| all time | **10** | 16 | 33 | 57 |

**"10 commits/30d" is the all-time count mislabeled as a 30-day rate.** It also
contradicts the plan's own §1 note (*"History was thin (5 commits/30d)"*) — 10 > 5 is
impossible under the same scope. `src/pages/api/library/` specifically has **3
commits ever** (`46d3b98` 2026-06-10, `924524b` 2026-06-12, `d5e2120` 2026-06-13) and
has not been touched since.

This does not sink Risk #6 — the archive evidence (H-01/H-02/H-03) is genuine and the
uncovered surface in B4 is real. But the likelihood weighting rests on churn that
isn't there, and the cited directory is not where the failure lives:
`src/lib/validation/` and `src/pages/api/library/` are.

---

## Code References

**Risk #5**
- `src/lib/supabase.ts:10` — the single client constructor; anon key + cookie session
- `src/lib/services/library.ts:31-33` — the "RLS does user isolation" rule, stated in production code
- `src/lib/services/library.ts:164-172` — `update().eq("id")` → `PGRST116` → `EntryNotFoundError`
- `src/lib/services/library.ts:183-189` — `delete().eq("id").select("id")` → empty → `EntryNotFoundError`
- `src/pages/api/library/[id].ts:14,60,104` — PUT / PATCH / DELETE; `:45,91,123` the 404 mapping
- `src/pages/api/library/[id].ts:15-22` — config-check-before-auth-check ordering (500 vs 401 trap)
- `src/pages/api/library/index.ts:26-34` — POST, same ordering
- `src/middleware.ts:4,12,24` — `PROTECTED_ROUTES` excludes `/api/*`; `auth.getUser()` is server-validated
- `supabase/migrations/20260606150950_create_library_entries.sql:9,34-44` — `default auth.uid()`, four policies
- `supabase/migrations/20260611120000_list_used_platforms_rpc.sql:21` / `20260616120000_library_facets_rpc.sql:29` — `security invoker` + explicit `user_id` predicate

**Risk #6**
- `src/components/library/GameDialog.tsx:178-188` — the entire client validation
- `src/components/library/GameDialog.tsx:82-98` — `mapValuesToBody`, sends all 13 fields
- `src/components/library/GameFormFields.tsx:51-59` — `toNumberOrNull` (`Number`, not `parseInt`)
- `src/components/library/GameFormFields.tsx:196-205` — `length_hours` input, no `step`
- `src/components/library/PlayStatusControl.tsx:129-139` — `Math.trunc`, outside any `<form>`
- `src/lib/validation/library.ts:32-46` — `updateEntrySchema`; `:41` `length_hours` has no `.int()`
- `src/lib/validation/library.ts:63-70` — `patchEntrySchema`, zero tests
- `src/pages/api/library/index.ts:14-17` — `createEntrySchema` defined inline, duplicating `lookupRequestSchema`
- `src/lib/services/vision.ts:137-138` — the only production call sites of both normalizers
- `src/lib/services/igdb.ts:163-168` — `lengthHoursFromSeconds` (`Math.ceil`)
- `src/lib/platforms.ts:50-96` — `PLATFORM_DISPLAY_BY_ALIAS`, `normalizePlatformLabel`

**Recommender boundary**
- `src/lib/services/recommendation.ts:218-227` — `getRecommendations`
- `src/lib/services/library.ts:321-348` — `RECOMMENDATION_COLUMNS`, `RECOMMENDATION_MAX_ROWS`, `listAllEntries`
- `src/lib/services/recommendation.test.ts:67-69` — the Phase 2 triage note naming this hole
- `src/pages/play-next/index.astro:23,32` — the only caller

**Harness**
- `src/pages/api/identify.test.ts:24-34,90-104` — the route-test precedent
- `src/lib/services/library.test.ts:23-35,179-197,219-231,249-265,289-325` — the five inline Supabase builders
- `test/setup/no-network.ts` — deny-all fetch (blocks a real-Supabase suite in the same project)
- `test/stubs/astro-env-server.ts` — `SUPABASE_*` deliberately `undefined`
- `vitest.config.ts:19,24-25` — the `astro:env/server` alias; `include`/`setupFiles`
- `supabase/config.toml:210` — `enable_confirmations = false`

**Spec oracles (`context/foundation/prd.md`)**
- `:171` — *"A user's library is isolated from every other user's library; no view, search, recommendation, or filter ever returns an entry the requesting user does not own."*
- `:188` — *"Single-tenant, login-gated … unauthenticated requests to any library route are rejected."*
- `:192` — *"Sign-up is open in v1 (anyone can register and use the app with their own library)…"*
- `:140` — FR-010, *"User can edit any field of a library entry after creation. Priority: must-have"*
- `:94` — *"Title and platform are required; all other fields are optional at creation."*
- `:70` — *"Optional play time field (hours) accepts a non-negative integer; empty means unset."*
- **No oracle exists** for platform-alias canonicalization, integer-vs-decimal length, or upper bounds on `release_year`/`play_time_hours`/`igdb_id`.

## Architecture Insights

1. **Isolation is a single-layer, single-point defense.** RLS is not a backstop
   behind application checks — it is the only check. `anon` holds full table grants;
   the absence of an `anon` policy is the whole wall. Every mitigation in A4 is a
   one-line SQL or one-env-var change away from a full breach, and none of them
   changes a line of TypeScript. That is precisely why the *only* test that can
   defend Risk #5 must exercise real Postgres.
2. **404-from-empty-returning-set is elegant but silent.** Because the 404 is derived
   from the RETURNING set rather than from a permission error, a partially-broken
   policy set can produce "404 after a successful write". A test that only asserts
   "foreign id → 404" would pass in that state.
3. **Validation lives in three places with three different strictness levels** —
   HTML5 attributes (client), zod (server), and column types + checks (DB) — and
   nothing keeps them in lockstep. The interesting failures are all at the seams, and
   they run in *both* directions (client stricter than server on `length_hours`;
   server looser than the DB on integer ranges).
4. **`.astro` frontmatter is the repo's untestable zone**, and the team already has a
   named remedy: extract to a `.ts` module under `src/lib/services/`, never
   `src/pages/` (a `.ts` file there becomes an endpoint). Phase 2 set that precedent
   with `emptyStateMessage`. Phase 3 does **not** need it for the recommender
   boundary, but `library/index.astro`'s state-selection logic is the next candidate.
5. **Normalization is an identify-path concern that never became a domain concern.**
   `platforms.ts` sits in `src/lib/` looking general-purpose; it is wired to exactly
   one caller. That is a coherent scoping decision, but it means the canonical
   platform vocabulary is enforced on 1 of 2 write paths.

## Historical Context (from prior changes)

- `context/archive/2026-06-06-library-entry-store/plan.md:47` — *"RLS correctness is the load-bearing risk … Omitting `WITH CHECK` on INSERT/UPDATE would let a user write rows owned by someone else."* The risk was named at foundation time and never got an automated test.
- `context/archive/2026-06-11-edit-and-delete-entry/plan.md:23,52,249` — the RLS-only ownership decision, the 404-not-403 mechanism, and a **manual** two-user verification step. The impl-review never revisits ownership.
- `context/archive/2026-06-13-filter-and-sort-library/plan.md:17` — *"RLS scopes every query to `auth.uid() = user_id` automatically; new queries and `SECURITY INVOKER` RPCs inherit isolation for free."* Inherited assumption, never ratified as a rule outside code comments.
- `context/archive/2026-06-19-fix-decimal-game-length/plan.md:29` + `plan-brief.md:53` — ceil-at-source chosen over changing the form; the un-editable-decimal-row gap accepted explicitly.
- `context/archive/2026-06-19-normalize-photo-platform-title/plan.md:61-63` — the manual path deliberately excluded from normalization.
- `context/archive/2026-07-18-testing-grounding-identify-seam/plan.md:116` — *"Not covering cross-user isolation or the library routes — that is test-plan Phase 3."* Also `reviews/impl-review.md:55-63` (F2): a route's best-effort `catch` can make a test pass even with the mock route deleted — assert the outgoing request, not just the final shape.
- `context/archive/2026-07-25-testing-recommender-behavior-hardening/plan.md:85-89,110` — the `.astro` → `src/lib/services/` extraction precedent and the "verbatim move only" discipline for a test-writing phase.
- `context/changes/deployment/deployment-plan.md:107` — already warns about the anon-vs-service key copy-paste that A4 item 3 describes.
- `context/foundation/roadmap.md` — every item done; sharing / multi-user explicitly parked. Nothing pending changes this surface.

## Related Research

- `context/archive/2026-07-18-testing-grounding-identify-seam/research.md` — Phase 1; stood up the route-test and fetch-edge harnesses this phase extends.
- `context/archive/2026-07-25-testing-recommender-behavior-hardening/research.md` — Phase 2; the oracle-discipline vocabulary (spec-backed vs documentation-of-behaviour) used throughout this document.

## Recommended Phase 3 shape (input to `/10x-plan`)

Two vitest projects, disjoint failure sets, in cost order:

1. **Hermetic route contracts** (`src/pages/api/library/[id].test.ts`,
   `index.test.ts`) — extend the `identify.test.ts` precedent; first extract the five
   Supabase builders into `test/helpers/supabase-mock.ts`. Covers: guard ordering and
   status codes (401/400/404/204/500), `EntryNotFoundError` → 404 on all three verbs,
   `params.id` forwarded unchanged into `.eq`, body-supplied `user_id` stripped by
   zod, non-UUID id → current 500 behaviour pinned as a decision.
2. **Validation parity** (`src/lib/validation/library.test.ts` extension) — the
   uncovered schemas: `patchEntrySchema` (including `.refine()`), `createEntrySchema`,
   `length_hours` decimal acceptance recorded as *documentation-of-behaviour* against
   the integer-only client, and the `Math.trunc` vs `Math.ceil` rounding divergence.
   Trace every assertion to `prd.md:70`/`:94`/`:140`, never to a schema constant.
3. **Cross-user isolation — pgTAP under `supabase/tests/database/`** (decided
   2026-07-25, see Open Questions 1–2). A *small* suite: as user B, `update`/`delete`
   against user A's row affects **zero rows** (`results_ne` on the `returning` set);
   as B, `select` over A's rows returns none; `list_used_platforms()` and
   `library_facets()` return only B's values; an `insert` with an explicit foreign
   `user_id` is refused by the `WITH CHECK`. Impersonate with `set local role
   authenticated` + `set local request.jwt.claim.sub`, wrapped in
   `begin … rollback`. Run by `supabase test db` as a gate **separate from
   `npm test`**, so the Vitest suite keeps needing no Docker. This is the only part
   that can defend Risk #5.
4. **`listAllEntries` / `getRecommendations`** — cheap stubbed assertions on the
   column set (derived from what `recommend()` reads) and error propagation. Fold the
   "only my rows" half into item 3.

## Open Questions

1. ~~**Does Phase 3 take on the Docker dependency?**~~ **DECIDED 2026-07-25 — pgTAP +
   hermetic routes.** Isolation is proven by SQL policy tests under
   `supabase/tests/database/`, run by `supabase test db` as a gate separate from
   `npm test`; the Vitest suite stays hermetic and Docker-free. This defends the
   actual single point of failure (A3: `anon` holds full table grants, so the missing
   policy *is* the wall) at the layer that owns it, and it kills all six stub-invisible
   failure modes in A4 except #3 (a key swap, which is a deployment concern —
   `deployment-plan.md:107` already flags it). Consequence for the plan: **no second
   Vitest project is needed**, so `test/setup/no-network.ts` can stay global and
   `test.projects` is not required.
2. ~~**§7 vs. Risk #5.**~~ **RESOLVED by decision 1 — no conflict.** §7 excludes
   *"Auth internals (Supabase email+password signin/signup/signout)"*. pgTAP never
   touches the auth provider: it impersonates users with
   `set local role authenticated` + `set local request.jwt.claim.sub = '<uuid>'`, so
   isolation is verified without exercising a single line of gotrue. §7 needs no
   carve-out and Risk #5's protection claim needs no weakening. (Had option 2 — the
   two-real-JWT Vitest project — been chosen, it *would* have called `auth.signUp`
   and required an explicit §7 carve-out.)
3. **Do the three recorded code gaps stay recorded?** The un-editable decimal row
   (FR-010 violation, B2), the manual-path normalization asymmetry (B3), and the
   `22003`/`22P02` → 500-instead-of-400 mapping (B4.2) are all production changes. A
   test-writing phase changes no production behaviour (§7 / Phase 1 & 2 precedent),
   so the default is to record them in "What We're NOT Doing". Confirm that default
   holds — the decimal one is a `must-have` FR violation, which is a stronger case for
   a follow-up change than the other two.
4. ~~**Backport to `test-plan.md` §2/§4?**~~ **DONE 2026-07-25.** Applied in place:
   §2 rows #5/#6 (risk wording + Source churn correction), both Risk Response Guidance
   rows (rewritten with the inversions above), §3 Phase 3 (test types → `db-policy
   (pgTAP) + integration`, goal reworded, status → `researched`), §4 (Vitest 4.1.10 /
   9 files / 172 tests; the provider-mocking and route-contract rows now describe the
   Phase 1 harness that exists; a new database-policy row for pgTAP), and §8. No file
   anchors were added to §2 — principle #3 holds.
