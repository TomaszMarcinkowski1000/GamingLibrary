---
change_id: post-login-library-landing
title: Reach the library directly after login (no dashboard hop)
status: archived
created: 2026-06-17
updated: 2026-06-17
archived_at: 2026-06-17T19:33:02Z
---

## Notes

Roadmap slice **S-08** (◇ optional UX polish). After signing in the user lands on their library (or reaches it in a single, obvious step) rather than the current dashboard → library two-hop, and a persistent way back to the library exists.

PRD refs: US-04 (browsing the library is the primary post-login action); general navigation/usability.

Prerequisites (done): S-01. Gates no other slice; current navigation works — this is polish surfaced during S-01 manual verification (2026-06-11), an inconvenience, not a defect.

Open design decision to settle in planning:
- Should login redirect straight to `/library`, or should the dashboard be reframed as a library-first landing (keeping sign-out etc.)?
