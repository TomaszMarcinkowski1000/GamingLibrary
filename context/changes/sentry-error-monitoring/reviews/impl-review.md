<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Sentry Error Monitoring

- **Plan**: `context/changes/sentry-error-monitoring/plan.md`
- **Scope**: Phases 1–3 of 3 (all complete), plus the post-epilogue commit `cf16416`
- **Date**: 2026-07-29
- **Verdict**: REJECTED at review → **all 10 findings triaged and fixed** (see Triage outcome below)
- **Findings**: 1 critical, 5 warnings, 4 observations — 10 fixed, 0 skipped, 0 accepted

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Every one of the plan's ten contracted changes matches its stated contract, the Phase 3 deviation is
properly recorded, and all automated criteria were re-run green (`npm test` 14 files / 254 tests,
`npm run typecheck` 0 errors, `npm run lint` exit 0, `npm run build` exit 0 with no Sentry credential,
`dist/client` free of Sentry code and of `.map` files). The FAIL is a single SDK-semantics
misunderstanding whose consequence is credential exposure.

## Findings

### F1 — `httpBodies: []` does not suppress request-body capture

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `sentry.server.config.ts:43`
- **Detail**: The plan calls this option "load-bearing, not cosmetic". It is inert. Verified against
  the installed `@sentry/cloudflare@10.68` / `@sentry/core`:
  - `dataCollection.httpBodies` is never consulted on the Cloudflare request path.
    `captureIncomingRequestBody` (`integrations/httpServer.js:12-29`) gates only on
    `maxRequestBodySize === "none"`, method, and `ignoreRequestBody`.
  - It then calls `captureBodyFromWinterCGRequest` (`core/utils/request.js:64`), which writes the
    body (truncated to 10 KB at the `"medium"` default) onto the isolation scope.
  - `requestDataIntegration` attaches it unconditionally: `include.data` is hardcoded `true`, above
    the SDK's own comment at `core/integrations/requestdata.js:25` — *"Always attach body data that's
    already on the scope — dataCollection.httpBodies gates write-time, not read-time."*

  Consequence: `src/components/auth/SignInForm.tsx:43` and `SignUpForm.tsx:66` are native
  `<form method="POST">` with no `encType`, i.e. `application/x-www-form-urlencoded` — which is in
  the SDK's `TEXT_CONTENT_TYPES` (`core/utils/request.js:9-15`). Any event raised during a sign-in or
  sign-up request therefore carries `email=…&password=<plaintext>`. `signin.ts` itself only calls
  `logWarning`, but an unhandled throw anywhere in that request is caught by `withSentry` and
  captured. `/api/library` JSON bodies are captured the same way, and those routes do have `logError`
  call sites.

  The irony: `POST /api/identify` — the one route the comment names — is `multipart/form-data`
  (`identify.ts:127`), fails `isTextualContentType`, and was never at risk. The base64 shelf photos
  the option was written to protect are protected by content-type, not by this setting.
- **Fix**: Add `integrations: [Sentry.httpServerIntegration({ maxRequestBodySize: "none" })]` to the
  options object, and rewrite the comment to say what actually holds (multipart is skipped by
  content-type; textual bodies need this integration override).
  - Strength: `httpServerIntegration` is the only real gate in this code path, and passing it in
    `integrations` overrides the default instance by name. It stops the body being read at all,
    rather than scrubbing it after the fact.
  - Tradeoff: Loses request bodies as debugging context on genuine API failures.
  - Confidence: HIGH — traced end to end through the installed SDK source, not inferred from docs.
  - Blind spot: Sentry's server-side scrubber may redact some of this; it matches structured keys,
    and the captured value here is a raw urlencoded string, so it likely does not. Not worth relying on.
- **Decision**: FIXED — `integrations: [Sentry.httpServerIntegration({ maxRequestBodySize: "none" })]`
  added at `sentry.server.config.ts:53`, comment rewritten to state what actually holds. `httpBodies: []`
  kept as a deny-by-default for any path that does consult it, now labelled as such.

### F2 — Supplying `dataCollection` flips every unnamed field to the permissive default

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `sentry.server.config.ts:43`
- **Detail**: `core/utils/data-collection/resolveDataCollectionOptions.js:16` reads
  `const base = options.dataCollection != null ? DEFAULTS : defaultPiiToCollectionOptions(options.sendDefaultPii)`.
  Passing `dataCollection` *at all* therefore switches the base for every field not named from the
  restrictive `sendDefaultPii: false` profile to fully-permissive `DEFAULTS`. Concretely
  `databaseQueryData` goes `false → true` and `genAI.{inputs,outputs}` go `false → true`; `cookies`
  and `httpHeaders` go from deny-list objects to bare `true`.

  Live exposure today is nil: cookies survive because `sdk.js:31` separately passes
  `requestDataIntegration({ include: { cookies: false } })` — and `cookiesEnabled` at `sdk.js:16`
  tests `dataCollection?.cookies != null`, which is false here — and that `include` is spread last so
  it wins. No Supabase or AI integration is registered, so the DB/genAI flips have nothing to act on.
  The finding is that the config *reads* as locked-down while being permissive-by-default for five of
  seven categories, so registering e.g. the Supabase integration later would silently begin shipping
  query values.
- **Fix**: Name every field explicitly rather than relying on the base, e.g. add `cookies: false`,
  `httpHeaders: { request: false, response: false }`, `urlQueryParams: false`,
  `databaseQueryData: false`, `genAI: { inputs: false, outputs: false }`.
- **Decision**: FIXED — all seven flipping fields named explicitly in `sentry.server.config.ts`, with a
  comment stating that an omitted field inherits "on", not "off". `graphQL` and `stackFrameVariables`
  are identical in both bases, so they were left to the base deliberately.
- **Note**: `stackFrameVariables` defaults to `true` in *both* bases, so it is outside this finding —
  but it is a live capture-local-variables setting. Inert on Workers today (the LocalVariables
  integration is Node-only, needing `inspector`); worth revisiting if that ever changes.

### F3 — `environment: "production"` is hardcoded while local verification is documented

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `sentry.server.config.ts:44`
- **Detail**: `.dev.vars.example:19-23` and the plan's manual-testing steps both instruct developers
  to paste a DSN into `.dev.vars` to verify the wiring. Those events are tagged
  `environment: production` and land in the same stream as real incidents — which is what forced
  Progress row 3.12 to be settled "by restatement" rather than literally. (The DSN has since been
  emptied in `.dev.vars`, so nothing is leaking right now.)
- **Fix**: Derive it — `environment: env.SENTRY_RELEASE ? "production" : "development"` — since
  `SENTRY_RELEASE` is set only by the deploy script.
- **Decision**: FIXED — `environment: env.SENTRY_RELEASE ? "production" : "development"`, with the
  reasoning (presence of `SENTRY_RELEASE` == deployed Worker) recorded in the comment.

### F4 — Deploy script reports "source maps uploaded" without ever checking any exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/deploy-worker.mjs:135-152`
- **Detail**: Nothing asserts that `dist/server` actually contains `.map` files. If
  `serverOnlySourcemaps()` (`astro.config.mjs:19-26`) ever stops applying — Vite changes the
  `isSsrBuild` signal, plugin order shifts, the adapter changes its output layout — both
  `sentry-cli sourcemaps inject` and `upload` succeed over a map-less directory and the script prints
  `"deployed, source maps uploaded."` That is precisely the silent regression the script exists to
  prevent, and it is the same failure mode `cf16416` was written to fix.
- **Fix**: Before the inject step, glob `dist/server/**/*.map` and `fail()` if the count is zero.
- **Decision**: FIXED — `countSourceMaps()` added; zero maps now `fail()`s before the inject step, and
  the success line reports the count (`deployed, 47 source maps uploaded.`) so the claim is checkable.
  One deliberate narrowing: the hard fail is gated on `uploadSourceMaps`. Without Sentry credentials
  the script already prints "upload skipped" and makes no false claim, and failing there would break
  the script's explicit "Sentry is optional, a deploy must still be possible" stance — that path
  warns instead. Verified against the real `dist/server`: 47 maps, guard does not false-positive.

### F5 — Release tracking added, though the plan lists it under "What We're NOT Doing"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: `sentry.server.config.ts:36`, `scripts/deploy-worker.mjs:86-94,139,150`
- **Detail**: `plan.md:85` excludes "alerting/notification rules, dashboards, or release tracking".
  The implementation adds a complete release chain: `resolveRelease()` → `wrangler deploy --var
  SENTRY_RELEASE:<sha>` → `sentry-cli sourcemaps upload --release <sha>` → `release: env.SENTRY_RELEASE`
  in the SDK options. The Phase 3 deviation note (`plan.md:483-497`) authorizes the *uploader*
  mechanism and never mentions releases. It is useful and harmless, and it is unrecorded scope. It is
  also not required for readable traces: `sentry-cli sourcemaps inject` matches on debug IDs, which
  work without a release.
- **Fix A ⭐ Recommended**: Keep it, and record it — add a line to the Phase 3 deviation note stating
  that release tagging was added alongside the uploader and why.
  - Strength: The work is done, deployed, and verified; releases are genuinely useful for "which
    deploy introduced this". Recording it keeps the plan usable as ground truth for the next review.
  - Tradeoff: The exclusion list becomes something the plan overrode rather than honored.
  - Confidence: HIGH — this repo already records deviations in the Progress section rather than
    reverting working code.
  - Blind spot: None significant.
- **Fix B**: Strip the release wiring back out to honor the stated boundary.
  - Strength: Keeps scope discipline literal.
  - Tradeoff: Removes working, deployed, verified functionality for a bookkeeping reason, and touches
    the production deploy path to do it.
  - Confidence: MEDIUM — low risk mechanically, but it is churn on the one script that ships.
  - Blind spot: Existing Sentry issues are already tagged with releases; untagging mid-stream splits
    the history.
- **Decision**: FIXED via Fix A — release tagging kept, and recorded as a second paragraph in the
  Phase 3 deviation note (`plan.md`), naming it as an override of the exclusion line and stating that
  the source-map chain does not depend on it (debug IDs, not releases).

### F6 — `cf16416` landed after the close-out epilogue and left no trace in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `plan.md:41-43`, `plan.md:86`
- **Detail**: Three linked problems.
  1. The plan's Current State says *"Deploy is manual — `npx wrangler deploy` … there is no deploy
     workflow"*, and "What We're NOT Doing" says *"No CI deploy workflow. Deploy stays manual."*
     Both rest on a false premise: `context/changes/deployment/deployment-plan.md:188-201` records
     Cloudflare Workers Builds auto-deploying every push to `main`, verified 2026-06-02. An
     automated deploy path already existed and the plan missed it.
  2. `cf16416` correctly *repairs* that path (`--skip-build`, `WORKERS_CI_COMMIT_SHA`, strict
     argument rejection) — without it every auto-deploy silently reverted production to minified
     traces and dropped `SENTRY_RELEASE`. No workflow was added; `.github/workflows/` still holds
     only `ci.yml` and `migrate.yml`. So the guardrail is not violated in substance.
  3. But `cf16416` landed *after* the epilogue commit `bb40599`. `git log -1 -- plan.md` and
     `-- change.md` both return `bb40599`: no Progress row, no second deviation note, and the wrong
     Current State claim stands uncorrected. A future reader of this plan will still believe deploy
     is manual — the exact belief that caused the gap.
- **Fix**: Add a short Phase 3 addendum recording `cf16416` (what it fixed and why), and correct the
  Current State bullet at `plan.md:41-43` to name Workers Builds as the real deploy path.
- **Decision**: FIXED — three edits to `plan.md`: (a) Current State bullet rewritten to name Workers
  Builds as the second deploy path, flagged as corrected after the fact, and explaining *why* planning
  missed it (dashboard-configured, so nothing in the repo to grep); (b) the "No CI deploy workflow"
  guardrail restated as "no new deploy automation", noting the original "Deploy stays manual" was
  false when written; (c) new Progress row **3.14** recording `cf16416` in full, including the human
  gate on the dashboard deploy command. Verified `deployment-plan.md:188-203` first-hand.

### F7 — Unquoted org/project slugs interpolated into a `shell: true` command

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/deploy-worker.mjs:62-63,147,149`
- **Detail**: The comment claims *"No argument here is user-supplied, so there is nothing to quote
  around"*. `release` is validated as 40-hex (`:88,:93`), but `process.env.SENTRY_ORG` and
  `SENTRY_PROJECT` come straight from `.env` and are interpolated unquoted into a `shell: true`
  command line. A slug containing a space breaks the upload quietly; one containing `&` or `;`
  executes. Practical severity is low — it is the operator's own `.env` — but the comment asserts a
  property the code does not have.
- **Fix**: Drop the `--org` / `--project` flags entirely; `sentry-cli` reads `SENTRY_ORG` and
  `SENTRY_PROJECT` from the environment natively. Then correct the comment.
- **Decision**: FIXED — `--org` / `--project` dropped; sentry-cli resolves both from the inherited
  environment (verified: `SENTRY_ORG=probe-org SENTRY_PROJECT=probe-proj sentry-cli info` echoes them
  back as Default Organization / Default Project). The `run()` comment now states the property the code
  actually has — every argument reaches a shell unquoted, the only dynamic one is the 40-hex-validated
  `release`, and free-form config goes through the environment instead.

### F8 — `sentry.server.config.ts` has no test; its privacy claims live only in a comment

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `sentry.server.config.ts`
- **Detail**: `src/lib/logger.test.ts` is genuinely strong — full-object `toHaveBeenCalledWith`
  rather than `objectContaining`, `mock.calls[0][1]` indexing that throws if the call never happened,
  and a case that proves the try/catch by making the mock throw *and* asserting the console line
  still landed. Nothing comparable guards the SDK configuration, which is why F1 and F2 survived
  implementation and phase review. The one file making privacy claims is the one file with no
  executable assertion behind them.
- **Fix**: Add a small test that imports the options callback and asserts the resolved
  privacy-relevant options (no body capture, `tracesSampleRate: 0`, `userInfo: false`).
- **Decision**: FIXED — `sentry.server.config.test.ts` added (7 tests), with `vitest.config.ts`
  `include` widened to `["src/**/*.test.ts", "*.test.ts"]` so a root-level entrypoint keeps its test
  beside it. `withSentry` is mocked to capture the options callback; the rest of `@sentry/cloudflare`
  is the real module, so the HttpServer assertion runs against the real integration factory and reads
  the same `maxRequestBodySize` property `captureIncomingRequestBody` gates on.
  The `dataCollection` test asserts the **key set**, not just the values — that is what guards F2's
  actual failure mode (an omitted field inherits "on", not "off").
  Verified by mutation, not just by passing: `maxRequestBodySize: "none" → "medium"` fails 1 test;
  deleting `databaseQueryData: false` fails 2; reverting `environment` to a hardcoded `"production"`
  fails 1. Config restored, 7/7 green.

### F9 — `.env.example` and `CLAUDE.md` disagree on where the deploy credentials live

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `.env.example:55-76`, `CLAUDE.md:59-63`
- **Detail**: `.env.example` states the three deploy credentials "belong in `.env` on the deploying
  developer's machine" and that "CI runs no deploy at all and needs none of these". `CLAUDE.md` now
  requires `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` in the Cloudflare Workers Builds
  build environment. Both are true; `.env.example` is stale by omission. Same root cause as F6.
- **Fix**: Add one line to the `.env.example` deploy-credentials block naming the Workers Builds
  build environment as the second home for these values.
- **Decision**: FIXED — `.env.example` now lists both homes explicitly (developer `.env`, and the
  Workers Builds build environment, with its required deploy command). Also sharpened the adjacent
  "CI runs no deploy" line to say *GitHub Actions* CI, since that is the sentence that made Workers
  Builds easy to overlook.

### F10 — Server source maps with embedded sources sit under a directory the root config would publish

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `wrangler.jsonc:14`
- **Detail**: `assets.directory` is `./dist`, which covers `dist/server`. That directory now holds 47
  `.map` files carrying full `sourcesContent` (verified: `dist/server/chunks/_id__CnRA1oVF.mjs.map`
  embeds the complete text of `src/pages/api/library/[id].ts`). Not exposed today — the effective
  deploy config is the build-generated redirect `dist/server/wrangler.json`, which narrows
  `directory` to `../client` (verified). The pre-existing root value is what makes it latent: any
  deploy that fell back to the root config would publish the app's TypeScript sources as public
  static assets. `upload_source_maps: true` did not create the risk, but it created the payload.
- **Fix**: Change `wrangler.jsonc:14` to `"directory": "./dist/client"` so the root config is correct
  on its own rather than relying on the redirect.
- **Decision**: FIXED — `wrangler.jsonc` `assets.directory` narrowed to `./dist/client`, with a
  comment recording why `./dist` is wrong. Verified with `wrangler deploy --dry-run`: it now reads 25
  files from `dist/client` rather than walking the 120-file `dist` tree, and `dist/client` holds 0
  `.map` files.

## Success criteria re-verification

All automated criteria across the three phases were re-run:

| Check | Result |
|---|---|
| `npm test` | 14 files, 254 tests, all pass |
| `npm run typecheck` | 98 files, 0 errors, 0 warnings |
| `npm run lint` | exit 0 |
| `npm run build` (no Sentry credential read anywhere in the build path) | exit 0 |
| No Sentry code in `dist/client` | confirmed, no matches |
| No `.map` files under `dist/client` | confirmed, 0 |
| `dist/server` source maps emitted | confirmed, 47 |

Manual rows: all 13 are checked, and the annotations are unusually honest — 3.2 and 3.12 are
explicitly settled "by restatement" with the reasoning shown, and 3.13 records a real defect found
late (production `SENTRY_DSN` was never set, so the whole change was inert in production until
Phase 3). No rubber-stamping found. `.dev.vars` was checked: `SENTRY_DSN` is present but empty, so
the plan's closing note was honored.

## Triage outcome

All 10 findings fixed; none skipped, dismissed, or accepted as risk. F5 took Fix A (keep and record).

| Finding | Outcome | Where |
|---|---|---|
| F1 request bodies (CRITICAL) | Fixed | `sentry.server.config.ts` |
| F2 permissive `dataCollection` base | Fixed | `sentry.server.config.ts` |
| F3 hardcoded `environment` | Fixed | `sentry.server.config.ts` |
| F4 unverified "maps uploaded" | Fixed | `scripts/deploy-worker.mjs` |
| F5 unrecorded release tracking | Fixed via Fix A | `plan.md` deviation note |
| F6 `cf16416` unrecorded | Fixed | `plan.md` Current State, guardrail, new row 3.14 |
| F7 unquoted slugs | Fixed | `scripts/deploy-worker.mjs` |
| F8 no test on the config | Fixed | `sentry.server.config.test.ts` (new), `vitest.config.ts` |
| F9 stale credential docs | Fixed | `.env.example` |
| F10 `assets.directory` too broad | Fixed | `wrangler.jsonc` |

Re-verified after the fixes:

| Check | Before triage | After |
|---|---|---|
| `npm test` | 14 files, 254 tests | **15 files, 261 tests**, all pass |
| `npm run typecheck` | 0 errors | 0 errors, 0 warnings (98 files) |
| `npm run lint` | exit 0 | exit 0 |
| `npm run build` | exit 0 | exit 0 |
| No Sentry code in `dist/client` | confirmed | confirmed, 0 matches |
| No `.map` under `dist/client` | 0 | 0 |
| `dist/server` maps emitted | 47 | 47 |
| `wrangler deploy --dry-run` assets | (not run) | 25 files from `dist/client`, not the 120-file `dist` |

The new tests were verified by mutation rather than by passing alone: three separate regressions of
the config (`maxRequestBodySize: "medium"`, a deleted `dataCollection` field, a re-hardcoded
`environment`) each fail the suite. See F8.

**Not fixed, and deliberately so:** `dataCollection.stackFrameVariables` defaults to `true` in both
resolution bases, so it sits outside F2 and was left alone. It is inert on Workers today — capturing
local variables needs the Node-only LocalVariables integration — but it is the one remaining option
that could carry a password out of a stack frame if that ever changes.

**Still a human gate:** the Cloudflare Workers Builds dashboard deploy command must remain
`node scripts/deploy-worker.mjs --skip-build`. Nothing in the repo can enforce it; see plan row 3.14.
