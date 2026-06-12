# Photo-identification spike — library / service docs

Reference docs gathered for the `photo-identification-spike` (roadmap F-03). Collected
2026-06-11 via Context7 MCP (primary) + official docs (WebFetch). Scoped to our stack:
**Astro 6 SSR on Cloudflare Workers, React 19**.

| File | Covers | Where it runs |
| --- | --- | --- |
| [openrouter.md](./openrouter.md) | OpenRouter chat-completions API: auth (Bearer key), image/multimodal input (base64 data URL + remote URL), structured JSON output (`response_format` / `json_schema` / `strict`), Gemini Flash model IDs, full image→JSON `fetch` example, latency/accuracy notes. | **Server** — Astro API route on the Worker (`prerender = false`), raw `fetch`. |
| [opencv-js.md](./opencv-js.md) | opencv.js (WASM): loading the runtime, contour detection (`findContours` + `approxPolyDP` → 4 corners), 4-point perspective transform (`getPerspectiveTransform` + `warpPerspective`), Mat memory cleanup, corner-ordering caveat. | **Client** — React island in the browser (not workerd). |

## Pipeline at a glance

1. **(optional, client)** opencv.js detects the box contour and rectifies the photo to a
   clean head-on image — see `opencv-js.md`. Falls back to the original photo if no clean
   quad is found.
2. **(server)** The image is sent to OpenRouter (Gemini Flash) and returns
   `{ title, platform, confidence }` as validated JSON — see `openrouter.md`.
3. A thin accuracy harness runs this against the collector's shelf to test the **≥90%**
   guardrail (FR-005) and measure latency (10s p95).

## Open items / verify before coding

- Confirm the exact Gemini Flash slug + its vision/structured-output support live at
  https://openrouter.ai/models?q=gemini+flash (newer previews appear over time).
- `OPENROUTER_API_KEY` must be plumbed as a server-only secret (`env.schema`, `.dev.vars`,
  `wrangler secret put`) — owner: user (per `change.md`).
- opencv.js is optional; only adopt if rectification measurably helps accuracy (it adds a
  multi-MB WASM download to the client).
