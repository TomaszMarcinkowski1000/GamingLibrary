# OpenRouter API — Vision (Gemini Flash) + Structured Output

> Sources (fetched 2026-06-11 via Context7 + official docs):
> - Quickstart / auth: https://openrouter.ai/docs/quickstart
> - Image input: https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
> - Structured outputs: https://openrouter.ai/docs/guides/features/structured-outputs
> - Chat completions API: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
> - Models: https://openrouter.ai/models (verify live IDs before coding)

## Scope for this spike

A **server-side** call from a Cloudflare Worker (Astro API route, `prerender = false`):
single box photo in → proposed `{ title, platform }` out as validated JSON. OpenRouter
is an OpenAI-compatible REST endpoint, so we hit it with plain `fetch` (no SDK / no Node
`fs` — those don't exist in workerd). The `@openrouter/sdk` examples below are for reference
only; **prefer raw `fetch`** in the Worker.

---

## 1. Endpoint & Authentication

- **Endpoint:** `POST https://openrouter.ai/api/v1/chat/completions`
- **Required header:** `Authorization: Bearer <OPENROUTER_API_KEY>`
- **Optional headers** (attribution / rankings only, not required):
  - `HTTP-Referer: <YOUR_SITE_URL>`
  - `X-OpenRouter-Title: <YOUR_SITE_NAME>` (older docs/snippets call this `X-Title`)

API key is created in the OpenRouter dashboard. In our stack the key is a **server-only
secret**:
- Declare in `astro.config.mjs` `env.schema` (e.g. `OPENROUTER_API_KEY`, access via `astro:env/server`).
- Local Node dev: `.env`. Cloudflare local dev: `.dev.vars`. Production: `wrangler secret put OPENROUTER_API_KEY`.

Minimal request (curl):

```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{
    "model": "google/gemini-2.5-flash",
    "messages": [{ "role": "user", "content": "What is the meaning of life?" }]
  }'
```

---

## 2. Sending an image (multimodal input)

Images go in the `content` **array** of a `user` message, alongside text parts. Docs
recommend **text first, then the image**.

Content-part shape:

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Your prompt here" },
    { "type": "image_url", "image_url": { "url": "image_source_here" } }
  ]
}
```

Two ways to supply the image in `image_url.url`:

- **Remote URL** — any publicly reachable image URL (no encoding needed).
- **Base64 data URL** — for uploaded / private images:
  `data:image/<format>;base64,<encoded_data>`

**Supported formats:** `image/png`, `image/jpeg`, `image/webp`, `image/gif`.
Max images per request varies by provider/model.

### Worker-friendly base64 (no Node `fs`)

In workerd, build the data URL from the uploaded `File`/`ArrayBuffer` using Web APIs:

```ts
// inside an Astro API route (prerender = false), running on the Worker
const file = (await request.formData()).get("photo") as File;
const bytes = new Uint8Array(await file.arrayBuffer());
let binary = "";
for (const b of bytes) binary += String.fromCharCode(b);
const dataUrl = `data:${file.type};base64,${btoa(binary)}`;
```

> For large images prefer chunked base64 or `Buffer`-free helpers; `btoa(String.fromCharCode(...))`
> on a huge spread can blow the stack — encode in chunks if needed.

---

## 3. Structured / JSON output

Add `response_format` with `type: "json_schema"` and `strict: true`. The model is forced to
return JSON matching the schema — no prose, no fences to strip.

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "game_identification",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "title":      { "type": "string", "description": "Game title printed on the box" },
          "platform":   { "type": "string", "description": "Console / platform, e.g. PlayStation 5" },
          "confidence": { "type": "number", "description": "0..1 model confidence" }
        },
        "required": ["title", "platform", "confidence"],
        "additionalProperties": false
      }
    }
  }
}
```

Key flags:
- `type: "json_schema"` — enables structured mode.
- `strict: true` — model follows the schema exactly.
- `required` — fields that must be present.
- `additionalProperties: false` — no extra keys beyond the schema.

**Support:** OpenAI (GPT-4o+), **Google Gemini**, Anthropic (Sonnet 4.5 / Opus 4.1+), most
open-source + Fireworks-hosted models. (Gemini Flash supports it — good for this spike.)

The JSON arrives as a **string** in `choices[0].message.content`; `JSON.parse` it, then
validate with **zod** (project convention) before trusting it.

---

## 4. Full example — image → structured JSON (raw fetch)

This is the shape to use in the Worker:

```ts
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Identify the video game and its platform from this box photo.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "game_identification",
        strict: true,
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            platform: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["title", "platform", "confidence"],
          additionalProperties: false,
        },
      },
    },
  }),
});

const data = await response.json();
const raw = data.choices[0].message.content; // JSON string
const parsed = JSON.parse(raw);
// then validate with zod -> { title, platform, confidence }
```

---

## 5. Model IDs — Gemini Flash family

Confirmed live ID for the spike:

- **`google/gemini-2.5-flash`** — vision-capable, 1M-token context, supports structured
  outputs, built-in reasoning. Good default for cheap+fast image ID.

Other Flash variants in the family (verify exact slugs on the models page before use — the
listing changes and newer previews appear, e.g. a `google/gemini-3-flash-preview` surfaced in
Context7 snippets):

- `google/gemini-2.5-flash-lite` — cheaper/faster, lower capability.
- `google/gemini-2.0-flash-001` — previous generation.

> Always confirm the slug and its vision/structured-output support at
> https://openrouter.ai/models?q=gemini+flash before wiring it in. Pricing and availability
> per model are shown there too — relevant to the latency (10s p95) and cost notes in the spike.

---

## 6. Notes for the spike

- **Latency guardrail (10s p95):** Flash models are the fast tier; measure real round-trip
  including base64 upload size. Consider downscaling the photo client-side before sending.
- **Accuracy guardrail (≥90%):** prompt should ask for both title *and* platform; consider
  adding a `confidence` field (above) and an "unsure" path so the harness can distinguish
  wrong vs. abstained.
- **Errors:** non-2xx returns an OpenRouter error body; handle rate limits / model-unavailable
  and surface a clean failure to the accuracy harness.
