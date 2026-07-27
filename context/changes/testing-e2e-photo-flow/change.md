---
change_id: testing-e2e-photo-flow
title: Test rollout Phase 4 — end-to-end mobile photo flow (Risk #3)
status: implemented
created: 2026-07-27
updated: 2026-07-27
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "End-to-end photo flow".
Risks covered: Risk #3 — the end-to-end photo journey breaks on a mobile browser (camera capture -> identify -> auto-saved entry never lands visibly, or a desktop-only step sneaks in). Impact High, Likelihood Medium; evidence: interview Q4, PRD §NFR (mobile-camera path, latest-two of 4 browsers), US-01.
Test types planned: e2e (Playwright).

Risk response intent:
- Risk #3: prove that on an **emulated** mobile browser, capture -> identify -> auto-save -> entry-visible-in-library completes with no required desktop step. Cheapest layer is e2e because no cheaper layer covers the browser + camera journey; the anti-pattern to avoid is e2e-ing what the §6.2 integration suite already covers (grounding / identify-seam logic).
  - **Scope corrected at close (2026-07-27).** The original wording said "a real mobile browser" and set the challenge as "'works on desktop Chrome' is not 'works on mobile Safari camera'". That challenge is unsatisfiable by this harness and the claim over-reaches: the suite is Chromium-only and `devices["Pixel 5"]` is Chromium with a mobile UA. WebKit was declined in writing (plan, Decision 3) because the fake-media launch args are Chromium-only — a WebKit run would silently exercise the file-input path — and WebKit is not iOS Safari anyway. What shipped is the emulated journey, with `pointer: coarse` and a real `getUserMedia` → canvas → JPEG pipeline against a fake device. Mobile Safari, a real camera, OS-level page eviction, and the 10 s p95 latency NFR remain uncovered by design; the four-browser NFR keeps its manual-matrix home.

Prior state on disk this change inherits (not a fresh start): commit 31d9aba wired the Playwright harness outside any change folder — playwright.config.ts, e2e/auth.setup.ts (storageState via the real /api/auth/signin route), e2e/seed.spec.ts (manual-add persistence), e2e/RULES.md, npm run test:e2e, Playwright 1.62.0. Chromium only; mobile is per-spec test.use({ ...devices["Pixel 5"] }), not a second project. So the harness is ready and the Risk #3 coverage is what is owed — see test-plan §4 e2e row and §6.3 "Still owed".

Known constraint the change should carry forward: IGDB and the vision provider are called server-side, so page.route() cannot intercept them; e2e/seed.spec.ts sidesteps this with a title that can never match. Phase 4 must decide how the identify path is exercised given that.
