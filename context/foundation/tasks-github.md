---
project: "Gaming Library"
source: context/foundation/roadmap.md
repo: TomaszMarcinkowski1000/GamingLibrary
created: 2026-06-02
---

# GitHub Issues — Roadmap Backlog

GitHub issues created from `context/foundation/roadmap.md` (v1). One issue per roadmap
item (3 foundations + 7 slices), grouped into milestones by Stream.

Repo: <https://github.com/TomaszMarcinkowski1000/GamingLibrary>
Issues: <https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues>
Milestones: <https://github.com/TomaszMarcinkowski1000/GamingLibrary/milestones>

## Labels

| Label        | Color   | Meaning                                       |
| ------------ | ------- | --------------------------------------------- |
| `foundation` | #5319e7 | Bounded enabler foundation (roadmap)          |
| `slice`      | #0e8a16 | Vertical, user-visible slice (roadmap)        |
| `north-star` | #fbca04 | Validation milestone / north star             |
| `blocked`    | #b60205 | Blocked on a prerequisite or guardrail        |

## Milestones (by Stream)

| Milestone | Stream | Chain                                              | Issues                       |
| --------- | ------ | -------------------------------------------------- | ---------------------------- |
| Stream A — Library core (data + CRUD)   | A | F-01 → S-01 → S-02 / S-04 / S-05 → S-06 | #1, #4, #5, #7, #8, #9 |
| Stream B — Photo entry (killer feature) | B | F-03 → S-03                            | #3, #6                 |
| Stream C — Metadata & recommendation    | C | F-02 → S-07                            | #2, #10                |

## Issues

| # | Roadmap ID | Change ID                  | Title                                                       | Labels                       | Milestone | Status   |
| - | ---------- | -------------------------- | ----------------------------------------------------------- | ---------------------------- | --------- | -------- |
| [#1](https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues/1)  | F-01 | library-entry-store        | Library-entry store: table, RLS, shared entry type          | foundation                   | Stream A | ready    |
| [#2](https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues/2)  | F-02 | igdb-metadata-enrichment   | IGDB metadata enrichment (lookup by title + platform)       | foundation                   | Stream C | ready    |
| [#3](https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues/3)  | F-03 | photo-identification-spike | Vision photo-ID spike + >=90% accuracy validation           | foundation                   | Stream B | ready    |
| [#4](https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues/4)  | S-01 | manual-add-and-browse      | Manual add + enriched + paginated library browse            | slice                        | Stream A | proposed |
| [#5](https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues/5)  | S-02 | edit-and-delete-entry      | Edit any field; delete with confirm                         | slice                        | Stream A | proposed |
| [#6](https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues/6)  | S-03 | photo-to-library           | Photo capture → identified, auto-saved enriched entry       | slice, north-star, blocked   | Stream B | blocked  |
| [#7](https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues/7)  | S-04 | mark-play-status           | Mark play status (+ optional play time)                     | slice                        | Stream A | proposed |
| [#8](https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues/8)  | S-05 | search-library-by-title    | Search library by title (duplicate-purchase check)          | slice                        | Stream A | proposed |
| [#9](https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues/9)  | S-06 | filter-and-sort-library    | Filter & sort by status, platform, genre                    | slice                        | Stream A | proposed |
| [#10](https://github.com/TomaszMarcinkowski1000/GamingLibrary/issues/10) | S-07 | play-next-recommendation   | Deterministic "what should I play next?" recommender        | slice                        | Stream C | proposed |

## Dependency notes

Prerequisites are documented inside each issue body as `#n` cross-links (GitHub's
native sub-issue / "tracked by" relationships are not set):

- **#4 (S-01)** needs #1, #2
- **#5 (S-02)** needs #1, #4
- **#6 (S-03, north star)** needs #1, #2, #3, #4, #5 — **blocked** on F-03's >=90% guardrail
- **#7 (S-04)** needs #1, #4
- **#8 (S-05)** needs #1, #4
- **#9 (S-06)** needs #1, #4, #7
- **#10 (S-07)** needs #1, #2, #4, #7

**Recommended first move:** #3 (F-03) — resolves the binding >=90% vision-accuracy
guardrail that gates the north star (#6).
