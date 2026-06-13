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

## Truth-set cleaning (do this before an acceptance re-measure)

`labels.csv` is local-only and was seeded from a collector's spreadsheet that carries a few
rows the harness can't score fairly. Clean it once before the S-09 (`enrichment-match-precision`)
re-measure so the accuracy number reflects grounding quality, not data noise. These are manual
edits to your gitignored `labels.csv` — there is no committed cleaning script.

1. **Drop junk rows** that aren't a single identifiable game box:
   - `rozne-wersje-demonstracyjne` (demo-disc compilation)
   - `pierdo-ki-do-fifa-06` (not a game)
2. **Pin `true_igdb_id` for Polish-edition titles** that don't ground from their Polish names —
   set the column to the **base-game** IGDB id so the row scores deterministically against the
   id grounding now returns. The 8 known cases include, for example:
   - `God of War: Duch Sparty` → the base *God of War: Ghost of Sparta* id
   - `Star Wars Jedi Ocalały` → the *Star Wars Jedi: Survivor* id

   To find an id, use the grounding shortcut against the English title, e.g.
   `GET /api/identify?title=Star+Wars+Jedi+Survivor&platform=PlayStation+5` (signed-in), and copy
   the returned `igdbId` into `true_igdb_id`.
3. **Correct cross-gen platform labels** to the console the box actually names. Some shelf rows
   were labelled with the newest console in a family when the physical box is the previous-gen
   release IGDB indexes it under — e.g. the Yakuza boxes (`Yakuza 0`, `Yakuza 6`, `Yakuza 3/5
   Remastered`) say **Xbox One** on the box, not Xbox Series X, so the truth title only grounds
   on the Xbox One filter. Set `true_platform` to what the box names.

After cleaning, every remaining row either grounds cleanly from its title or carries a pinned
`true_igdb_id`, so a `✗ wrong` in the harness output is a real grounding miss rather than a
truth-set artifact.

## Running the harness

With `npm run dev` up (so the route has real `astro:env/server` secrets + the IGDB KV
binding) and a signed-in dev account exported as `HARNESS_EMAIL` / `HARNESS_PASSWORD`:

```bash
npm run harness
```

The harness downscales each photo, posts it to `/api/identify`, resolves the truth id,
scores accuracy-when-answered / abstain rate / latency p50/p95 and the angled breakdown,
and writes `report.json` here (also gitignored). See `scripts/identify-harness.mjs`.
