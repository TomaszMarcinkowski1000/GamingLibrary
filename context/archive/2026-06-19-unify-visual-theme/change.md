---
change_id: unify-visual-theme
title: Unify visual theme across auth, library, and play-next to match landing
status: archived
created: 2026-06-19
updated: 2026-06-19
archived_at: 2026-06-19T21:29:12Z
---

## Notes

Roadmap v1 Hardening H-04 (GitHub #25), type: enhancement, area: pages + shared theme shell.

Outcome: Sign in, sign up, library, and "what to play next" share the landing page's emerald/neon theme instead of the current `bg-cosmic` blue/purple.

Root cause: The emerald theme is hardcoded inline in `Welcome.astro`; `Layout.astro` is structural only and carries no theme, so the four pages diverged.

Fix sketch: Extract the welcome theme (background, neon grid, glows, color tokens) into a reusable layout/shell, then apply it to the four pages and restyle the `Topbar`.
