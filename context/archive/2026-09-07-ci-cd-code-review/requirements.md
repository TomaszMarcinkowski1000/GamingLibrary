# Requirements — agentic code review in CI

> Acceptance criteria for a pull request in this repository, written to be consumed by
> `packages/code-reviewer` (as `context` / an extension of `REVIEW_INSTRUCTIONS`), not read
> by a human as a checklist. Derived from `CLAUDE.md`, `context/foundation/lessons.md`, and
> `context/foundation/test-plan.md` §1, §2, §5, §7 in conversation on 2026-09-07.

## Overall concept

- GHA workflow run for every new pull request to `main`
- composite action for the review itself so that the main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff

## Not criteria — preconditions

**CI is assumed green.** `ci` (`npm test` → lint → typecheck → build) and `e2e`
(`npm run test:db` → `npm run test:e2e`) are already blocking on every PR to `main`. The
reviewer does not re-score what those jobs mechanically enforce; it scores what they
structurally cannot see. A red CI is not a review finding — it is a PR that is not ready
for review.

## Not a criterion — advisory only

**Change-folder scope.** There is no rule that a PR maps to a `context/changes/<id>/`
folder; small changes land without one and that is normal. The reviewer may *suggest* a
change folder when the diff is large or feature-shaped, and — when a folder or `plan.md`
is present — may score the work against it. Neither ever blocks a merge, and their absence
is never reported as a defect.

## Code Review Criteria

Each criterion is scored on a 1–10 scale. The scale is operational, not descriptive:
**1 is a state that should block the merge**, 10 is work worth copying the next time.
Criterion 1 is the only *hard* blocker — a 1 there fails the PR on its own, whatever the
other four say.

1) **test falsifiability** _(hard blocker)_ — can each new or changed test actually fail
   against the defect it claims to defend, and is there evidence that it does?
   - _1_: a test that cannot go red. A stubbed client asserting cross-user isolation the
     database actually enforces; a spec glob matching zero files; a CI step whose exit code
     is swallowed; a guard over a bypass path that stays green after the bypass is disarmed.
     Worse than no test, because it reads as coverage. Blocks the merge on its own.
   - _10_: every test names the behaviour it would catch, and the risky ones carry proof —
     a watched red run, a deliberate break pushed and reverted (as in the three falsification
     rows in test-plan §5), or an equivalent. Tests guarding a production bypass path
     (e.g. the two locks on `stubbedVisionRead`) keep their enforcement intact and demonstrably
     enforcing.

2) **assertion oracle** — does each assertion come from the specification, or from the code
   it is supposed to be testing?
   - _1_: assertions mirrored from the implementation — validation constants copied out of the
     schema, ordering asserted from the sort key, absence asserted where the rule says
     _de-prioritized_, or an exact value pinned where the spec is genuinely ambiguous. Such a
     test locks in current behaviour and calls it correctness; it will pass straight through
     the bug it was written to catch.
   - _10_: every assertion traces to a citable source — an FR/PRD line, an RLS policy, an
     independent truth-set — named in the test or a comment beside it. Where the code is
     stricter than the rule, or the spec is ambiguous, the test says so and is labelled
     documentation-of-behaviour rather than passed off as spec.

3) **test layer (cost × signal)** — is each test at the cheapest layer that gives a real
   signal for the risk it defends?
   - _1_: the layer cannot pay for itself, in either direction. Promoted upward — an e2e for
     logic the integration suite already covers, a test per page or per button, a model-based
     check stacked on a deterministic one that already catches the regression. Or promoted
     into blindness — a risk asserted at a layer that structurally cannot observe it (a schema
     test for a browser-side rejection, a stubbed route test for isolation the database owns).
   - _10_: each test sits at the cheapest layer that carries real signal, the PR names which
     risk it defends (test-plan §2 #1–#6, or an argued new one), and the expensive layers are
     spent only where no cheaper layer exists at all. Roughly one test per risk, never one per
     file.

4) **stack conventions** — does the change read like the code already in this repository?
   - _1_: fights the established patterns. Hand-concatenated Tailwind class strings instead of
     `cn()`; an API route without zod validation or without `prerender = false`; a new table
     without RLS and granular per-operation, per-role policies; Cloudflare bindings reached via
     `Astro.locals.runtime.env` (removed in Astro 6 / `@astrojs/cloudflare` v13 — see
     `lessons.md`); Next.js directives in React components; a deploy path that bypasses
     `scripts/deploy-worker.mjs` and silently drops source-map debug IDs.
   - _10_: indistinguishable from well-written surrounding code — `cn()` for class merging,
     zod at every API boundary, secrets through `astro:env/server`, bindings through
     `import { env } from "cloudflare:workers"` over generated `worker-configuration.d.ts`,
     the `@/` alias, migrations named `YYYYMMDDHHmmss_short_description.sql`, hooks in
     `src/components/hooks/`, shared types in `src/types.ts`.

5) **security and isolation** — does the change keep per-user isolation in the layer that
   actually enforces it, and keep secrets out of everything else?
   - _1_: opens a hole or disarms a wall. A new table without RLS, or a policy widened to
     `using (true)` or granted `to anon`; an error path that echoes provider keys or raw
     upstream errors to the client; a bypass seam reduced from two independent locks to one;
     a test-only key (`E2E_VISION_STUB_KEY`) reachable in a deployed environment; a test run
     pointed at production credentials instead of the ephemeral container's own keys.
   - _10_: ownership stays entirely in the database policy layer, and every new or changed
     policy gains a pgTAP assertion that would catch its removal or widening; failure paths
     surface clean errors that leak nothing about the provider; any deliberate bypass keeps
     independent locks plus a unit guard proving the default state is dead; test credentials
     are generated per run and die with the container, consuming no repository secrets.

## Parked for later

- business alignment (requires broader context)
- architectural fit (requires broader context)
- implementation correctness, complexity, documentation — the generic axes from the template.
  Dropped deliberately for v1: `REVIEW_INSTRUCTIONS` already asks for correctness defects, and
  the five above are the ones this repo has actually been burned on.
- plan-drift scoring against `context/changes/<id>/plan.md` — currently advisory only

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:retry` is added

## Open — needs a decision before implementation

- **Pass/fail threshold.** Proposed, not agreed: criterion 1 scoring ≤3 fails the PR on its
  own; any other criterion scoring ≤2 fails; otherwise pass, with all findings posted as the
  comment. Needs sign-off, since it is what the two labels mean.
- Whether the reviewer sees only the diff, or may read whole files via its `read_file` /
  `search_code` tools in CI. Criteria 2 and 5 are hard to score from a diff alone — an oracle
  claim and an RLS policy both live outside the changed lines.
