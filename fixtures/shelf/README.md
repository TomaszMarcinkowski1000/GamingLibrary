# Shelf fixtures (F-03 accuracy harness)

This directory holds the collector's own game-box photos and their ground-truth labels
for the photo-identification spike. **Only this README and `labels.example.csv` are
committed** — the photos and the real `labels.csv` are gitignored and stay on the local
machine (see the `fixtures/shelf/*` rule in the repo `.gitignore`).

## What to put here

1. **~30–50 front-of-box photos** of single games from your shelf, with an **angled
   subset** (shot at a skew, not straight-on) flagged in the labels — the harness reports
   angled-vs-straight accuracy so we know whether deferred image rectification is needed.
2. **`labels.csv`** — the ground-truth file the harness scores against (copy
   `labels.example.csv` and fill it in).

## `labels.csv` format

Header row required. Columns:

| column          | required | meaning                                                              |
| --------------- | -------- | -------------------------------------------------------------------- |
| `filename`      | yes      | photo file name as it sits in this directory (e.g. `god-of-war.jpg`) |
| `true_title`    | yes      | the game's real title                                                |
| `true_platform` | yes      | the real platform, e.g. `PlayStation 5`, `Nintendo Switch`           |
| `angled`        | yes      | `1` if the shot is angled/skewed, `0` if straight-on                 |
| `true_igdb_id`  | no       | pin the IGDB id when title+platform is ambiguous; else the harness   |
|                 |          | resolves it via the grounding shortcut                               |

Fields containing commas must be wrapped in double quotes (e.g. `"Hitman 2, The"`).

## Running the harness

With `npm run dev` up (so the route has real `astro:env/server` secrets + the IGDB KV
binding) and a signed-in dev account exported as `HARNESS_EMAIL` / `HARNESS_PASSWORD`:

```bash
npm run harness
```

The harness downscales each photo, posts it to `/api/identify`, resolves the truth id,
scores accuracy-when-answered / abstain rate / latency p50/p95 and the angled breakdown,
and writes `report.json` here (also gitignored). See `scripts/identify-harness.mjs`.
