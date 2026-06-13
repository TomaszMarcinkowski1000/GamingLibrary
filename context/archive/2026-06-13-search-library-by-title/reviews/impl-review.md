<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Search the Library by Title

- **Plan**: context/changes/search-library-by-title/plan.md
- **Scope**: Full plan (Phase 1 + 2 of 2)
- **Date**: 2026-06-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## What's solid

- All 5 planned changes verified MATCH: service `search` param + `.ilike("title", "%…%")` inserted before `.order/.range` so `count:"exact"` reflects the filtered total; `q` parsed and threaded into both the initial fetch and the clamp re-fetch; GET search form; generic param-preserving `pageHref` helper; `noMatches`/`isEmpty` re-gating with a dedicated no-match state.
- Escaping correct: `escapeLikeTerm` (library.ts:150-152) escapes backslash first, then `%` and `_`, so the escape can't be defeated. Verified against installed `postgrest-js` source that `,`/`(`/`)`/`*` are URL-encoded into a single `ilike.<value>` and cannot break out into a new filter — no injection.
- No XSS: `query` echoed via Astro `{expr}` (auto-escaped); no `set:html`.
- RLS isolation preserved; clamp math correct against the filtered total; no write paths; `npm run lint` and `npm run build` pass.
- In-scope improvement: `buildQuery`/`fetchPage` factoring ensures the out-of-bounds clamp re-fetch is also filtered.

## Findings

### F1 — Unrelated env bindings rode into the p1 commit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: worker-configuration.d.ts (commit 8caa173, p1)
- **Detail**: The backend-filter commit regenerated worker-configuration.d.ts (`wrangler types`) and picked up three bindings belonging to a different slice (igdb-metadata-enrichment), not title search: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, OPENROUTER_API_KEY. The file isn't in the plan's file list and the bindings are unrelated to `?q=` search. Type-level only — no runtime effect, no security impact — but if this branch merges before the igdb slice, it declares bindings not yet in the merged wrangler config.
- **Fix**: Restore worker-configuration.d.ts to its pre-slice state on this branch (`git checkout 54e46b5 -- worker-configuration.d.ts`, then commit), letting the igdb slice own that regeneration. Or accept it as harmless type-ahead and leave a note — but it shouldn't silently ride in a title-search commit.
- **Decision**: SKIPPED — accepted as harmless type-ahead; no runtime/security effect.

### F2 — Search form gated on !loadError (beyond plan wording)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/library/index.astro:109
- **Detail**: Plan said "show the search form whenever the library is non-empty." Implementation gates on `!isEmpty && !loadError`, so the form is also hidden during a load-error. Sensible tightening, consistent with the other content gates — flagged only as a deviation from the literal plan wording, not a defect.
- **Fix**: None needed — accept as a benign improvement.
- **Decision**: ACCEPTED — benign improvement, kept as-is.
