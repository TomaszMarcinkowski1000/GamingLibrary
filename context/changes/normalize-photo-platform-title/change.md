---
change_id: normalize-photo-platform-title
title: Normalize photo-extracted platform aliases and title casing
status: implemented
created: 2026-06-19
updated: 2026-06-19
archived_at: null
---

## Notes

Roadmap v1 Hardening H-03 (GitHub #24), type: bug, area: vision / identify flow.

Symptom: Photo adds return raw model strings — platform `"PC DVD"` should normalize to `"PC"` (and similar aliases), and ALL-CAPS titles (`"MAFIA THE OLD COUNTRY"`) should become Title Case.

Root cause: `vision.ts:131-134` returns `title`/`platform` verbatim; `identify.ts` passes them straight to grounding + save with no normalization step.

Fix sketch: Add a normalization step pre-grounding — platform alias map (extend `lib/platforms.ts`), and a title-case helper that only normalizes all-caps reads. Bonus: better platform grounding (ties into S-09's alias work).
