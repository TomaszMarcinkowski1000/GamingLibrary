# External research — photo-identification-spike

**Date:** 2026-06-11
**Goal:** Given a single front-of-box photo of a video game, return a proposed **game title + platform** at **≥90% accuracy** (the binding guardrail for FR-005), within **10s p95**. This doc surveys the solution space — *not just AI* — and weighs each option on **effectiveness** and **cost**.

> Method note: external/web research (Exa). This is the `external-research.md` companion to any future `/10x-research` codebase pass.

---

## 1. Framing the actual problem

The task decomposes into **two sub-problems with very different difficulty**, and that split drives the whole analysis:

| Sub-problem | Difficulty | Why |
| --- | --- | --- |
| **Platform identification** | **Easy** | Photos are taken from the front. The platform logo (PS5, Xbox, Switch…) sits in a **consistent location** with a **consistent, trademarked appearance** — a near-ideal target for template/logo matching *or* a trivial read for any vision model. |
| **Title identification** | **Hard** | Titles are set in **stylized / custom display fonts** (the user flagged this explicitly). Classic OCR is trained on standard fonts at ~300 DPI black-on-white and **fails badly** on decorative game lettering. This is where the 90% guardrail will be won or lost. |

**Consequence:** any approach that is only good at one half won't clear 90%. The platform half is cheap to nail with several techniques; the **title half is the real risk** and should drive the choice.

A second, cross-cutting finding (see §4): whatever reads the title, the proposed title+platform should be **verified against a real game database** before being trusted. Ungrounded models invent plausible-but-wrong entertainment titles ~20% of the time — grounding is the cheapest way to convert "good guess" into "≥90% correct."

---

## 2. Solution families

### A. Multimodal LLM vision (Gemini Flash / GPT-4o / Claude) — *recommended core*

**How:** Send the photo + a structured prompt ("return JSON: {title, platform, confidence}") to a vision-capable LLM. The model **reads stylized text in context** and reasons about it (e.g. recognizes a logo + art style even when the lettering is decorative) — exactly the weakness that defeats classic OCR.

**Effectiveness:**
- General vision/OCR benchmarks put frontier models at **~90–95%+ on clean OCR**, and crucially they degrade *gracefully* on stylized text because they use visual + world-knowledge priors, not glyph templates.
- Gemini leads recognition/OCR tasks; GPT-4o/Claude close behind. For *our* task (recognizable commercial cover art + logo), models should do well — **but this must be measured on the collector's own shelf**, because benchmark accuracy drops 10–20% on real-world photos (angle, glare, low res).
- Risk: **hallucinated titles** (see §4). Mitigated by grounding against a game DB.

**Cost (per image, input only — the dominant cost here):**
- **Gemini 2.x Flash / Flash-Lite: ~$0.00003–0.0001** (258 tokens/image, flat across sizes) — *10–100× cheaper than GPT-4o/Claude*.
- GPT-4o: ~$0.0019; GPT-4o mini: ~$0.0001.
- Claude Sonnet 4.6: ~$0.004 (highest token-per-image count → most expensive, though strong on document structure).
- At a hobbyist collector's volume (hundreds, not millions of photos), **all of these are effectively free**; Flash makes even large re-runs of the accuracy harness cost cents.

**Latency:** Gemini Flash ~0.8–1.5s; GPT-4o/Claude ~1.5–4s typical, with **p99 spikes to 10s+**. Comfortably inside the 10s p95 budget for a single call, but worth measuring under load.

**Access:** The spike's `change.md` names **OpenRouter** — its catalog exposes Gemini Flash, GPT-4o, Claude etc. behind one key/API, which is ideal for the experiment because you can **A/B several models against the same shelf** by swapping a model string. (OpenRouter prices mirror provider list prices; e.g. Gemini 2.0 Flash ≈ $0.10/M input vs GPT-4o $2.50/M.)

**Verdict:** **Best single bet to clear 90% on the hard (title) half.** Start with **Gemini Flash** for cost, keep GPT-4o as the quality fallback, route only hard cases up if Flash underperforms.

---

### B. Managed cloud vision APIs — OCR + logo detection (Google Cloud Vision / Azure / AWS Rekognition)

**How:** Two specialized calls — **Logo Detection** for the platform, **Document Text Detection (OCR)** for the title — then fuzzy-match the OCR string against a game DB.

**Effectiveness:**
- **Platform:** Logo detection is well-suited to trademarked console logos in a fixed spot. Solid.
- **Title:** These OCR engines are tuned for documents/printed text. On **stylized display fonts they degrade** the same way Tesseract does (less catastrophically, but not reliably). You'd lean on fuzzy matching against the game catalog to recover — workable for distinctive titles, shaky for short/ambiguous ones. **Unlikely to clear 90% on the title half alone.**

**Cost (per 1,000 images, after free tier):**
- Google Cloud Vision: **$1.50** per feature (Logo *and* Text are billed separately → ~$3.00 if you run both). Free: 1,000 units/mo, forever.
- Azure AI Vision: **$1.00**/1,000 (cheapest managed OCR). Free: 5,000 transactions/mo, forever. Has a **Brand** detector too.
- AWS Rekognition: ~**$1.00**/1,000 ($0.001/image), Group-2 DetectText/DetectLabels. Free: 5,000 images/mo for 12 months only.
- → roughly **$0.001–0.003 per photo**. Cheap, but you're paying for two calls and still stuck with the stylized-font ceiling.

**Latency:** Single-digit hundreds of ms per call; two calls still well under budget.

**Verdict:** **Good, cheap platform detector; weak standalone title reader.** Viable as a *component* (logo detection) feeding the LLM or as a cheaper fallback — but not the primary path for hitting the guardrail.

---

### C. Open-source / on-device computer vision (OpenCV + Tesseract) — *the "is a plain vision library enough?" answer*

This directly addresses the user's hypothesis: *maybe a plain vision library is good enough.* Verdict: **for the platform — yes; for the stylized title — no, not without heavy per-font work.**

**C1. OpenCV template / feature matching (ORB, SIFT, FLANN) — for the platform logo.**
- The platform logo is a *fixed, known graphic in a consistent position* — the textbook case for `cv.matchTemplate` (with multi-scale) or **ORB/SIFT feature matching** against a small library of reference logos. Robust to scale/rotation/lighting with SIFT + ratio test + homography.
- **Effectiveness:** high for a closed set of ~10–15 console logos. **Cost: $0** (runs locally / in a Worker-adjacent service). No API, no per-image fee.
- **Limitation:** it identifies *which logo*, not the title. It does **not** generalize to recognizing thousands of arbitrary game titles.

**C2. Tesseract OCR — for the title.**
- **This is where the plain-CV path breaks.** Tesseract is trained on standard fonts; on stylized game lettering it produces garbage. Documented real-world results: **~99% word-error-rate out-of-the-box** on a custom game font (Diablo 2 "Exocet"); a Pokémon-font reader needed a **custom-trained model** to reach usable accuracy; community reports show heavy OpenCV preprocessing (grayscale, threshold, upscale) is mandatory and *still* misreads characters.
- Reaching acceptable accuracy means **fine-tuning a model per font family** — infeasible across the whole games catalog where every title can use bespoke lettering.
- **Cost:** software is free; the real cost is **engineering time** (preprocessing + per-font training) and compute, plus an accuracy ceiling that likely **won't reach 90%** generically.

**Optional middle tier — Florence-2 (local ONNX):** an open vision model that handles stylized/decorative text far better than Tesseract (~200ms, free, runs locally), escalating to a vision LLM only when it's unsure. Relevant if you later want to **cut per-call cost** by handling easy cases on-device — but it's added complexity the spike doesn't need yet.

**Verdict:** Use **OpenCV logo matching for the platform** (free, deterministic, accurate). Do **not** rely on Tesseract for stylized titles. A pure open-source stack cannot be confidently expected to clear the 90% title guardrail without per-font training investment.

---

### D. Reverse image search (Google Lens via SerpApi / Apify, Bing Visual Search)

**How:** Send the whole photo to a visual-match engine that returns the matching product/cover and a title.

**Effectiveness:** Commercial game covers are **widely indexed** (retailers, wikis, IGDB/MobyGames cover art), so Lens-style visual match can directly return the right product for popular titles — sidestepping OCR entirely. Weaker on obscure/regional editions, loose discs, or poor photos. Returns noisy web titles that still need normalization against a game DB.

**Cost:**
- SerpApi Google Lens: plans start ~$75/mo (≈ thousands of searches) — pricier per call at low volume.
- Apify Google Lens actor: **$7.99 per 1,000 image searches** (~$0.008/photo), flat, OCR included.
- → ~**$0.008–0.01 per photo** — an order of magnitude more than Gemini Flash, plus an extra network hop.

**Latency:** Adds a full external round-trip (often 1–3s+); fine for p95 but slower than a direct Flash call.

**Verdict:** **Strong accuracy for popular covers, but more expensive and less controllable** than an LLM call, and ToS/stability of scraped-Lens APIs is a soft risk. Keep as a **fallback for low-confidence LLM results**, not the primary engine.

---

### E. Barcode / EAN scan — *noted and ruled out for this spike*

The classic cheap, deterministic ID path is scanning the **EAN/UPC barcode** → exact lookup. **But barcodes are on the back/spine**, and the spike's photos are **front-only**. So barcode is **not available** in this flow. Worth remembering as a near-100%-accuracy option *if* the capture UX ever allows a second (back) photo — it would be the cheapest, most reliable identifier of all.

---

## 3. Cost comparison at a glance

Per-photo, after free tiers. Hobbyist volume = hundreds/month → most options round to "free."

| Approach | Platform half | Title half | ~Cost / photo | Hits 90% on titles? |
| --- | --- | --- | --- | --- |
| **Gemini Flash (LLM)** | ✅ reads logo | ✅ reads stylized text in context | **~$0.00004–0.0001** | **Likely (measure)** |
| GPT-4o / Claude (LLM) | ✅ | ✅ (slightly stronger, pricier) | ~$0.002–0.004 | Likely (measure) |
| Cloud Vision OCR+Logo | ✅ logo detect | ⚠️ stylized-font ceiling | ~$0.001–0.003 | Risky alone |
| OpenCV template/feature match | ✅ free, deterministic | ❌ N/A | **$0** | Platform only |
| Tesseract OCR | ❌ | ❌ unless per-font trained | $0 (+ big eng cost) | No (generic) |
| Reverse image search (Lens) | ✅ | ✅ for popular covers | ~$0.008–0.01 | Likely for popular |
| Barcode/EAN | ✅ exact | ✅ exact | ~$0 | **N/A — back of box** |
| **Game DB grounding (IGDB)** | normalizes | validates/corrects | **$0 (free API)** | **Boosts all of the above** |

---

## 4. Cross-cutting: ground the answer against a free game database

This is the highest-leverage, lowest-cost finding, independent of which reader you pick.

- A **2026-06-11 Gracenote/Nielsen study** found an **ungrounded LLM hallucinated 100% of metadata for 19.5% of entertainment titles** tested, and frequently **conflated similar titles** (e.g. *Heel* vs *Heels*, same-name remakes across years). Newer and non-English titles are hit hardest. The fix that worked: **grounding the model against a verified data source** (MCP/RAG). The academic literature agrees — visual-grounding + a **catalog-lookup "negative rejection"** step is the standard hallucination control.
- **Practical pipeline:** vision reader proposes `{title, platform, confidence}` → **search IGDB/MobyGames** → snap to the nearest real catalog entry on that platform → if no confident match, return "unsure" instead of a guess. This both **raises accuracy** (corrects near-misses) and **gives an auditable confidence signal** for the accuracy harness.
- **Databases (both fit a hobby app):**
  - **IGDB** (Twitch-owned): **free for commercial and non-commercial use**; rich search by title + platform, returns cover art, alt/international titles. Auth via Twitch dev credentials. **Recommended.**
  - **MobyGames:** freemium; deep historical catalog; good as a secondary/cross-check source.

---

## 5. Recommendation for the spike

**Primary path to validate first (cheapest experiment that answers the guardrail):**

1. **Reader:** **Gemini Flash via OpenRouter**, structured-JSON prompt asking for `{title, platform, confidence}`. (One key, easy to A/B against GPT-4o if Flash underperforms.)
2. **Grounding:** post-process every result through the **IGDB** free API — match `title`+`platform` to the nearest catalog entry; emit `unsure` below a confidence threshold rather than guessing.
3. **Platform belt-and-suspenders (optional, free):** if the LLM is shaky on platform, add **OpenCV logo template/feature matching** over a small reference set — deterministic, $0, and the logo is in a consistent front-of-box location.
4. **Accuracy harness:** run the above over a labeled sample of the collector's **own shelf**; score title-correct AND platform-correct against the ≥90% bar. Log latency for the 10s p95 check.

**Fallbacks if Flash misses 90%:** (a) route low-confidence cases to **GPT-4o**; (b) add **reverse-image-search (Apify Lens, ~$0.008/img)** for popular covers the model fumbles.

**What we are NOT betting on:** a pure **Tesseract** title reader (fails on stylized fonts without per-font training) or **cloud-OCR-only** (same font ceiling). Plain CV is the right tool for the *platform logo*, not the *title*.

**Bottom line:** A grounded **Gemini-Flash-first** approach is the cheapest credible route to the ≥90% guardrail; per-photo cost at collector volume is negligible (cents per full re-run of the harness). The decisive unknown is **real-shelf title accuracy on stylized fonts** — which is exactly what the harness in this spike exists to measure.

---

## 6. Pre-step: rectify / crop the box before recognition (skew & angle correction)

**Yes — this is a solved vision problem, and it should be step 0 of the pipeline.** A crooked or angled photo of a *flat box front* is a planar surface, so the correct, cheap fix is a **homography (4-point perspective transform)**, not full 3D dewarping. Two tiers, by robustness need:

### Tier 1 — classic OpenCV "document scanner" (free, deterministic, ~tens of ms)
The canonical, battle-tested pipeline (dozens of repos + the PyImageSearch reference):
1. grayscale → Gaussian blur → **Canny edge detection**
2. `findContours` → keep the **largest 4-point convex polygon** (`approxPolyDP`) — assumed to be the box face
3. **order the 4 corners** (TL/TR/BR/BL) → `getPerspectiveTransform` → `warpPerspective` → flat, top-down crop

**Works well when:** the box is the dominant object, there's decent contrast vs. background, and the front face is roughly rectangular — i.e. our normal case. **Robustness add-ons** (from real-world repos, e.g. `juanpcomella/document_scanner`): morphological dilation/closing to repair broken edges, convex-hull merge of fragmented contours, and a **`minAreaRect` fallback** when no clean quadrilateral is found (handles shadow, similar-colored background, partially occluded edges).

### Tier 2 — lightweight ML corner detection (for hard cases / non-rectangular fronts)
When edge-based contour detection fails (clutter, partial boundaries, low contrast, or — your future topic — **non-rectangular boxes**), swap step 2 for a learned corner detector, then still finish with the same perspective warp:
- **DocCornerNet (SimCC corner detection):** ~500K params, **<1 MB model, ~4 ms on CPU**, mean corner error < 1 px, IoU > 0.98. Exports to **TFLite / XNNPACK / WASM** → can run client-side in the browser or in a Worker-adjacent runtime. This is the sweet spot: robustness of ML, cost of a rounding error.
- **DocTr / DocTr++ / DocAttentionRect (transformer dewarping):** handle *partial or absent boundaries* and *curved* surfaces (full displacement-field unwarping). **Overkill for a flat box front**, but this is the family to revisit for the "boxes that aren't rectangles / curved/embossed" problem you parked for later.

### How much does it actually help — and where it matters
- The **LLM-vision path (§2A) is already fairly robust to mild skew** — it reasons over the whole image. So rectification's biggest payoff is for the **OpenCV logo-match**, **OCR**, and **reverse-image / embedding** paths, which are sensitive to crop and orientation. Sources on reverse image search explicitly note that **tight crops around the logo/title dramatically improve match accuracy** — so even for the LLM path, a clean cropped front face likely nudges accuracy up. **Measure it in the harness** (same shelf, with vs. without the pre-step).
- A clean crop also **removes background distractors** (shelf, other boxes) → fewer wrong-object identifications.

### ⚠️ Runtime constraint for *this* app (Astro + Cloudflare Workers)
Native OpenCV (python/`cv2`) **does not run in a Worker**. Realistic placements:
- **(a) Client-side before upload** — `opencv.js` (WASM) *or* the DocCornerNet WASM/TFLite model in the browser. Bonus: smaller uploads, no server compute. **Recommended default.**
- **(b) Cloudflare Workers AI / a tiny separate service / container** for the corner model if you must do it server-side.
- **(c) Skip CV entirely and lean on the LLM's skew tolerance** for v1 — only add rectification if the harness shows angled shots dragging accuracy below 90%. Cheapest to ship; validate the need first.

**Verdict:** Make rectification an **optional, measured pre-step**. Start with classic OpenCV-4-point (client-side `opencv.js`); escalate to DocCornerNet (WASM) if contour detection proves flaky on real shelves. Reserve transformer dewarping for the future non-rectangular-box work.

---

## 7. Reverse-image path + how to combine it with OpenRouter (fallback / parallel-compare)

You asked specifically about (a) the reverse-image route, (b) falling back to OpenRouter when it fails, and (c) possibly running **both in parallel and comparing**. The key enabler for *all three* is that **both paths resolve to the same IGDB game id** (§4) — that's what makes "compare the results" a well-defined, automatable check.

### 7.1 Reverse-image options (two sub-families)

**Public-web visual search (someone else's index):**
| Option | Official API? | Fit for game covers | Cost | Notes |
| --- | --- | --- | --- | --- |
| **Google Lens** (via SerpApi / Apify) | No official Lens API | **Best** — independent 2026 OSINT test: exact make+model in top-3 for **6/7 product shots**, strongest on Western consumer goods | SerpApi ~$75/mo; **Apify ~$0.008/img** | Best raw product-ID accuracy; you're renting a scraped index (ToS/stability soft risk) |
| **Bing Visual Search** | **Yes (Microsoft)** | 2nd on product shots; strong shopping/Azure integration | Azure-tiered | The pragmatic "official API" alternative to Lens |
| **TinEye** (web + MatchEngine) | Yes | Exact/near-duplicate via perceptual hashing — weak on *semantic* similarity | API/plan | **MatchEngine against your own cover set** = exact-cover match; not for fuzzy/angle |
| Yandex | limited | Strong, but EU availability/ToS issues; best for RU/CN products | — | Not recommended for this use case |

**Private-catalog visual search (your own index — you control accuracy & cost):**
| Option | How | Cost | Notes |
| --- | --- | --- | --- |
| **CLIP embeddings + Supabase pgvector** | Embed IGDB cover art → store vectors → nearest-neighbor on the query photo | **~free** (reuses existing Supabase; compute only) | **Best architectural fit** — app already runs Supabase; official Supabase CLIP image-search example exists. CF **Workers AI** can host the CLIP-style embedding model. |
| **Google Cloud Vision Product Search** | Index your catalog (supports **"packaged goods"** category) → query returns ranked matches **with confidence score** | **$4.50/1k** queries + $0.10/1k storage; free 1k/mo | Turnkey, gives a confidence number (nice for the harness); GCP setup overhead |
| **Vertex AI Product Recognizer** | Google's product DB + visual embedding + OCR, resolves to **GTIN/UPC** | **$0.025/1k images** (very cheap) | Retail-oriented; heavier setup |
| AWS Titan Multimodal + OpenSearch | Same idea on AWS | PAYG | Only if you're on AWS |

**Take:** for *popular commercial covers*, **Google Lens (Apify)** gives the best off-the-shelf accuracy with zero index-building. For a **cheap, controllable, on-stack** option, **CLIP + Supabase pgvector over IGDB cover art** is the standout — near-zero marginal cost, reuses infra, and you own the ranking. These two are the natural "reverse-image" candidates to A/B.

### 7.2 Combining reverse-image with the OpenRouter LLM path

All three patterns below assume a final **snap-to-IGDB** step, so each path emits an `igdb_game_id` + confidence:

- **Cascade (cheapest — recommended default):** run the cheap/strong path first; escalate to the other **only on low confidence**.
  - e.g. *CLIP-vs-IGDB-covers (≈free)* → if top match weak/ambiguous → *Gemini Flash via OpenRouter*. Or the reverse if you prefer the LLM as primary. Minimizes cost & latency; only hard cases pay twice.
- **Parallel + reconcile (most accurate — what you described):** fire **OpenRouter** and **reverse-image** at the same time, then compare:
  - **same `igdb_game_id` → auto-accept (high confidence).**
  - **different ids → low confidence → tiebreak** (prefer higher per-path confidence, or ask the user to confirm). This agreement signal is itself a strong, free quality gate — and a great thing to log in the accuracy harness.
  - Latency = the slower of the two (~1–3s each), still inside the 10s p95 budget; cost = pennies, so running both is affordable.
- **Cross-verify:** use one path's proposed title to constrain the other (e.g. feed Lens's candidate titles to the LLM as "which of these matches the image?") — turns an open-ended guess into a multiple-choice pick, which models do more reliably.

### 7.3 Why "compare results" is clean here
Because **IGDB is the single source of truth**, both engines reduce to *"which catalog entry did you land on?"* Agreement = identical `igdb_game_id` on the right platform. That gives you: (1) an automatic confidence signal, (2) an apples-to-apples accuracy metric for the harness, and (3) a principled fallback/tiebreak rule. **Recommendation for the spike:** prototype **parallel Gemini-Flash + CLIP/pgvector-over-IGDB-covers**, log agreement rate and per-path accuracy on the real shelf; ship the cascade variant if parallel cost/latency ever matters.

---

## 8. Recommended end-to-end pipeline architecture

Capstone synthesis of §1–§7, fitted to **this app's stack** (Astro 6 SSR · React islands · Cloudflare Workers · Supabase · OpenRouter — the latter named in `change.md`). Design goals, in order: **clear the ≥90% guardrail**, stay within **10s p95**, keep per-photo cost negligible, and produce an **auditable confidence signal** so the UX can ask for confirmation instead of silently guessing wrong.

### 8.1 Flow

```
[0] CAPTURE                client        single front-of-box photo (mobile camera)
        │
[1] RECTIFY + DOWNSCALE    client        OPTIONAL, measured. opencv.js 4-pt transform
        │                  (browser)     (→ DocCornerNet-WASM if flaky). Crop to box face,
        │                                downscale ~1024px. Skippable in v1.
        ▼
[2] UPLOAD                 Worker        POST image → Astro API route (prerender=false).
        │                                Optionally stash in Supabase Storage for the harness.
        ▼
[3] IDENTIFY (parallel) ───┬───────────────────────────────────────────────┐
        │                  │                                                │
   PATH A: LLM reader      │                       PATH B: reverse-image    │
   OpenRouter → Gemini     │                       Workers AI CLIP embed    │
   Flash, structured JSON  │                       → Supabase pgvector NN   │
   {title, platform, conf} │                       over IGDB cover index    │
        │                  │                       → {igdb_id, score}       │
        ▼                  │                                ▼                │
[4] GROUND each path → IGDB search/normalize → each emits {igdb_game_id, platform, conf}
        │                  └────────────────────────────┬──────────────────┘
        ▼                                                ▼
[5] RECONCILE
        ├─ same igdb_game_id ........... AUTO-ACCEPT (high confidence)
        ├─ disagree / one empty ........ LOW CONFIDENCE → user picks (show both candidates)
        └─ both empty / low ............ (optional) escalate Path A to GPT-4o; else "couldn't identify"
        ▼
[6] PERSIST + RETURN       Worker/Supabase   write entry to library; show result + confirm UI
```

### 8.2 Stage responsibilities, placement, cost & latency

| Stage | Runs on | Cost/photo | ~Latency | Notes |
| --- | --- | --- | --- | --- |
| 1 Rectify+downscale | **client** (WASM) | $0 | ~50–200 ms | Optional; keeps OpenCV off the Worker. Smaller upload too. |
| 3A LLM reader | OpenRouter → **Gemini Flash** | ~$0.00004–0.0001 | ~0.8–1.5 s | Structured-JSON prompt; GPT-4o reserved as escalation only. |
| 3B Reverse-image | **Workers AI** (CLIP) + **Supabase pgvector** | ~$0 (on-stack) | ~0.1–0.5 s | Reuses existing Supabase; NN over IGDB cover vectors. |
| 4 Ground → IGDB | Worker → **IGDB API** (free) | $0 | ~0.1–0.3 s | Single source of truth; kills hallucinations (§4). |
| 5 Reconcile | Worker | $0 | ~0 | Agreement on `igdb_game_id` = the confidence gate. |
| **Total (parallel)** | | **« $0.001** | **~1.5–3 s p50** | Comfortably inside 10s p95 even with a GPT-4o escalation. |

### 8.3 Why this shape
- **Parallel A+B, not A-then-B:** the two engines fail on *different* inputs (LLM weak on obscure/regional editions; cover-vector weak on damaged/atypical photos), so running both and **reconciling on `igdb_game_id`** buys accuracy *and* a free confidence signal — exactly what the ≥90% guardrail and the confirm-UX need. Latency is the slower path, still well under budget.
- **IGDB as the spine:** every path resolves to a catalog id, so "compare results" is deterministic, the harness metric is apples-to-apples, and ungrounded-LLM hallucination (~20% on entertainment titles, §4) is structurally prevented.
- **Stack-native cheap path:** CLIP + pgvector reuses Supabase you already run → the reverse-image leg is ~free at steady state, making "always run both" affordable.
- **Confidence over false precision:** disagreement routes to a **one-tap user confirmation** showing both candidates — turns the hard cases into a good UX instead of a wrong autofill, and every confirmation is labeled data for later tuning.

### 8.4 Prerequisite offline job — build the IGDB cover-art index
**Build once, then refresh by diff.** Pull game records (+ `cover.image_id`) from IGDB → fetch each cover from the CDN → CLIP-embed → upsert vectors into a Supabase `pgvector` collection keyed by `igdb_game_id`. This is what Path B searches against. Run it as a **standalone batch script / scheduled job (not inside a Worker request** — Worker CPU/time limits); Workers AI can serve the CLIP embedding inference.

**Catalog scale.** IGDB ≈ **600k entries total**, but **~46% are DLC / re-releases** (Wikipedia, Mar 2023: 428k total / 196.5k DLC), so **~330k base games**. You don't index all of it — filter to *base games, with a cover, on supported platforms* → realistically **~30–80k relevant entries**.

**Storage — you index embeddings, NOT images** (covers are fetched, embedded, discarded). CLIP ViT-B/32 = 512-dim:

| Scope | ~entries | table (`halfvec`, ~1 KB/vec) | + HNSW index | **total** |
| --- | --- | --- | --- | --- |
| Full base catalog | ~330k | ~330 MB | ~400 MB | **~0.7 GB** (`halfvec`) / ~1.3 GB (`vector` f32) |
| Scoped (covers + platforms, no DLC) | ~30–80k | ~30–80 MB | ~40–100 MB | **~0.1–0.2 GB** |

Use `halfvec` (16-bit) for ~50% smaller storage/index at negligible recall loss. Even the full catalog is pgvector's "Small/Medium" tier — fits in RAM on a normal instance, no latency concern. *(Warehousing the JPEGs would be ~13 GB at full scale — avoid; not needed for vector search.)*

**Download cost & rate limits — two separate channels:**
- **(A) Metadata via API** (`api.igdb.com`): rate-limited to **4 req/s, max 8 concurrent**, but **no total request cap** (v4 removed it; free for commercial + non-commercial). Max **500 records/request** → full base catalog = ~660 requests ≈ **~3 min** of API calls; JSON payload is tiny (a few fields/game). IGDB **explicitly supports** this "page 500 at a time + store locally + webhooks for diffs" pattern, so ongoing refresh pulls only changed rows, not the whole catalog.
- **(B) Cover images via CDN** (`images.igdb.com`, Cloudinary-backed): **does NOT count against the API rate limit** — separate host. This is the real bandwidth. Use **`t_cover_big` (227×320, ~30–50 KB)** — closest to CLIP's 224px input. Volume: full ≈ **~13 GB** (~330k × 40 KB); scoped ≈ **~2 GB** (~50k). Download is bandwidth-bound (parallelize politely, ~10–30 concurrent, retry on 429/5xx), so wall-clock is minutes (scoped) to ~tens of minutes (full) — and **the real long pole is CLIP embedding throughput**, not IGDB.

**Bottom line:** the index is **~0.1–0.7 GB on disk**, the metadata pull is a **~3-minute, uncapped** API sweep, and the only sizable transfer is **~2–13 GB of cover JPEGs from a non-rate-limited CDN** — all a one-time batch, refreshed thereafter by webhook diffs.

### 8.5 Phased rollout (de-risk the spike first)
- **v1 (spike — answer the guardrail):** Stage 0/2/3A/4 only — **Gemini Flash + IGDB grounding**, *no* rectification, *no* Path B. Cheapest experiment that measures real-shelf accuracy. If Flash+IGDB alone clears 90%, ship that; everything below is optional accuracy headroom.
- **v1.1 (if v1 is short of 90% or borderline):** add **Path B (CLIP/pgvector)** in parallel + reconcile; add **client-side rectification** for angled shots; add **GPT-4o escalation** for low-confidence cases.
- **Later (parked):** transformer dewarping (§6 Tier 2) for **non-rectangular / curved boxes**; optional **barcode** capture (§2E) if the UX ever allows a back-of-box photo (near-100% exact ID).

### 8.6 What the accuracy harness must measure (binding deliverable)
Run the chosen pipeline over a labeled sample of the **collector's own shelf** and log, per photo:
1. **title-correct AND platform-correct** vs the ≥90% bar (the pass/fail for FR-005);
2. **end-to-end latency** → check 10s p95 (NFR);
3. **Path-A vs Path-B agreement rate** and **per-path accuracy** (tells you whether Path B / rectification are worth their complexity);
4. **rectification A/B** (with vs. without Stage 1) on the angled subset.

> **Decisive unknown remains real-shelf title accuracy on stylized fonts** — this architecture is built so the spike can measure it with the *minimum* v1 (Flash + IGDB) and only add machinery if the numbers demand it.

---

## 9. Sources

**Multimodal LLM vision — accuracy & cost**
- Multimodal Model Comparison (GPT-4o / Claude / Gemini), uatgpt.com — per-task accuracy + per-image cost tables.
- AI Vision API Pricing 2026, aicostcheck.com — per-image cost across Gemini/GPT/Claude/Llama.
- Vision API Comparison 2026, tokenmix.ai — 4-model accuracy + $/img, task-routing.
- Best LLM for Vision, deploybase.ai; Claude API vs GPT-4 benchmark, claudeguide.io; Claude Pro Image Analysis, aionx.co — OCR accuracy, latency, cost framing.
- OpenRouter model pages (GPT-4o, Gemini 2.0 Flash pricing); OpenAI dev-community thread on Gemini Flash being ~40–275× cheaper than GPT-4o(-mini) for image input.

**Managed cloud vision (OCR + logo)**
- Google Cloud Vision pricing (Logo $1.50/1k, Text $1.50/1k, free 1k/mo).
- Azure AI Vision pricing ($1.00/1k Read OCR, Brand detection, free 5k/mo).
- AWS Rekognition pricing (DetectText/DetectLabels, $0.001/img, free 5k/mo 12mo).
- Best OCR APIs 2026, apiscout.dev; AWS vs Google vs Azure vs Clarifai, techno-pulse.com.

**Open-source CV / OCR limits on stylized fonts**
- OpenCV docs: Template Matching, Feature Matching (ORB/SIFT/FLANN); prob1995 multi-scale-multi-object template matching (GitHub).
- Training OCR for Diablo 2 font (Exocet), tomwojcik.com — ~99% WER out-of-box, needs fine-tuning.
- Pokémon Card / Emerald OCR, explained.engineering — default Tesseract fails on game font, custom model needed.
- Tesseract OCR limitations, Qt knowledge base; StackOverflow Diablo 2 screenshot text extraction (preprocessing required).
- Constrained Fuzzy OCR three-tier pipeline, mostlylucid.net — Tesseract→Florence-2 (local, stylized fonts)→Vision LLM escalation.

**Reverse image search**
- SerpApi Google Lens / Google Reverse Image APIs + pricing; Apify Google Lens actor ($7.99/1,000 image searches, OCR included).

**Box rectification / perspective correction (§6)**
- PyImageSearch "mobile document scanner" (Canny → contours → 4-point `getPerspectiveTransform`/`warpPerspective`); Bret Hajek "Scanning Documents from Photos Using OpenCV".
- GitHub document-scanner repos: `juanpcomella/document_scanner` (robust contour repair + convex hull + minAreaRect fallback), `YegorCherov/document-scanner`, `ArashNasrEsfahani/Python-Document-Scanner-OpenCV`, `uzumstanley/Document-Scanner`.
- `mapo80/DocCornerNet-CoordClass` — SimCC corner detection, ~500K params, <1MB, ~4ms CPU, TFLite/XNNPACK/WASM.
- DocTr (arXiv 2110.12942), DocTr++ "Deep Unrestricted Document Image Rectification" (arXiv 2304.08796), DocAttentionRect (BMVC 2025), Cascaded Robust Rectification (arXiv 2511.23150) — transformer dewarping for partial/absent boundaries & curved surfaces.

**Reverse-image options & combining with LLM (§7)**
- "Reverse Image Search API: Developer's Guide 2026", dev.to/kencho; "Best Reverse Image Search APIs 2026", mixpeek.com; "8 Best AI Reverse Image Search", dev.to/writerz.
- "Reverse Image Search 2026: Yandex/Lens/TinEye/Bing tested on 50 OSINT cases", pressverified.com — Lens best on product shots (6/7 exact make+model in top-3).
- Google Cloud Vision **Product Search** pricing ($4.50/1k predictions + $0.10/1k storage, free 1k/mo) + docs (packaged-goods category, confidence scores); **Vertex AI Vision Product Recognizer** ($0.025/1k images, GTIN/UPC, OCR + visual embedding).
- Build-your-own: Supabase "Image Search with OpenAI CLIP" (pgvector); Qdrant + CLIP reverse-image engine (dev.to/niranjanakella); Manticore + TinyCLIP; AWS Titan Multimodal + OpenSearch.

**Grounding / hallucination control (game DB)**
- Gracenote/Nielsen "Plot Holes in AI" study (2026-06-11) — ungrounded LLMs hallucinate 100% metadata for 19.5% of titles; grounding fixes it.
- Hallucination Detection in LLM-enriched Product Listings (ACL ECNLP 2024); PostAlign multimodal grounding (arXiv 2506.17901); Google Cloud grounding overview.
- IGDB API docs (free, commercial+non-commercial, search by title/platform); MobyGames API docs (freemium).

**IGDB index sizing, download & limits (§8.4)**
- IGDB API docs — Rate Limits (4 req/s, max 8 concurrent, `limit` max 500/request); "IGDB API v4 is coming" (Medium) — removal of all total request caps.
- Twitch dev forum — IGDB supports paging 500-at-a-time + local store + webhooks for diffs; cover image_id → `images.igdb.com/igdb/image/upload/t_{size}/{hash}.jpg`.
- IGDB image size chart (`t_thumb` 90×90, `t_cover_small` 90×128, `t_cover_big` 227×320, `_2x` retina); Wikipedia IGDB (428k games / 196.5k DLC, Mar 2023).
- pgvector storage/index: timescale pgvector guide + pgvector#735/#769 (HNSW tuple = 72 + sizeof(vector); neighbor links); Neon "use halfvec, save 50%".
