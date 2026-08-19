---
title: "Gaming Library — destylacja domeny (DDD)"
created: 2026-08-19
type: domain-distillation
---

# Gaming Library — destylacja domeny

Mapa domeny, nie kod. Wszystkie pojęcia, niezmienniki i rozjazdy poniżej pochodzą
z realnie przeczytanych plików; każda pozycja niesie cytat `plik:linia`. Tam gdzie
pojęcie żyje tylko w dokumencie albo tylko w kodzie, jest to jawnie odnotowane.

---

## KROK 0 — Kontekst projektu

### Znalezione dokumenty źródłowe

| Dokument | Ścieżka | Rola w destylacji |
|---|---|---|
| PRD | `context/foundation/prd.md` (206 linii) | **Główne źródło prawdy** — wizja, persona, success criteria, US-01…US-05, FR-001…FR-020, NFR, Business Logic, Access Control, Non-Goals |
| Shape notes | `context/foundation/shape-notes.md` | Materiał wejściowy do PRD (te same non-goals, `shape-notes.md:227`) |
| Roadmapa | `context/foundation/roadmap.md` (39 KB) | Narracja zmian: F-01…F-03, S-01…S-09, hardening H-01…H-05 — każdy slice z `PRD refs` i statusem |
| Test plan | `context/foundation/test-plan.md` (94 KB) | Mapa ryzyk #1–#6 (`test-plan.md:57-64`) + rejestr rozjazdów już wykrytych przez testy |
| Tech stack | `context/foundation/tech-stack.md` | Wybór startera/stacku |
| Infrastructure | `context/foundation/infrastructure.md` | Wybór platformy (Cloudflare) |
| README / CLAUDE.md | korzeń repo | Komendy, konwencje, warstwy |
| Archiwum zmian | `context/archive/**` (22 katalogi zmian, każdy z `change.md`/`plan.md`/`reviews/impl-review.md`) | Rozszerzona historia zmian — czytana jako materiał źródłowy (m.in. `enrichment-match-precision`, `photo-to-library`, `play-next-recommendation`) |

**Brak ograniczeń materiałowych** — projekt ma pełny komplet dokumentów wymagań,
więc destylacja nie musi się opierać wyłącznie na kodzie.

### Stack i struktura repo

Astro 6 SSR (`output: "server"`) + React 19 islands + Tailwind 4 + Supabase
(Postgres + auth) + Cloudflare Workers (`CLAUDE.md`, `astro.config.mjs`).

Gdzie żyje logika biznesowa:

| Warstwa | Katalog | Co tu jest naprawdę |
|---|---|---|
| **Persystencja + izolacja** | `supabase/migrations/` (5 migracji) | Tabela `library_entries`, CHECK-i wartościowe, RLS + 4 granularne polityki, 2 RPC (`list_used_platforms`, `library_facets`) |
| **Domena / reguły** | `src/lib/services/` | `recommendation.ts` (silnik rankingu, czysta funkcja), `igdb.ts` (grounding, collapse edycji, gate wiarygodności), `library.ts` (CRUD + wzbogacanie), `vision.ts` (odczyt zdjęcia), `recommendationCopy.ts` (copy pustego stanu) |
| **Kontrakty wejścia** | `src/lib/validation/library.ts` | Schematy zod: `updateEntrySchema`, `patchEntrySchema`, `lookupRequestSchema`, `parseRecommendationParams` |
| **Słownik typów** | `src/types.ts` (235 linii) | Encje, DTO, wszystkie vocabulary domenowe (statusy, kubełki długości, tryby nowości) |
| **API** | `src/pages/api/**` | `library/index.ts` (POST), `library/[id].ts` (PUT/PATCH/DELETE), `library/lookup.ts`, `identify.ts` (GET/POST) |
| **UI / prezentacja** | `src/pages/**/*.astro`, `src/components/library/*.tsx` | SSR strony `/library`, `/play-next`; wyspy React na interakcję |
| **Cross-cutting** | `src/middleware.ts`, `src/lib/logger.ts` | Rozpoznanie użytkownika, `PROTECTED_ROUTES`, Sentry |

Warstwa domenowa **nie jest** wydzielona jako osobny model — nie ma encji, agregatów
ani obiektów wartości. Są funkcje na anemicznym typie wierszowym: `LibraryEntry`
jest wprost `Database["public"]["Tables"]["library_entries"]["Row"]` z dwoma polami
zawężonymi do unii (`src/types.ts:13-19`). To jest punkt wyjścia dla KROKU 3 i 5.

---

## KROK 1 — Ubiquitous Language

Legenda statusu: **D** = pojęcie w dokumencie, **K** = pojęcie w kodzie.

### 1.1 Byty i pojęcia nośne (D + K)

| Pojęcie | Definicja domenowa | Cytat źródłowy | Gdzie żyje w kodzie |
|---|---|---|---|
| **Collector** (kolekcjoner) | Jedyny użytkownik v1: hobbysta z 50+ tytułami na 3+ konsolach, który ma więcej niż zdąży ograć | `prd.md:28` — „A hobbyist gamer with a sizable physical library (50+ titles, 3+ consoles)" | `src/middleware.ts:13` (`context.locals.user`), `auth.users` przez FK w `supabase/migrations/20260606150950_create_library_entries.sql:9` |
| **Library** (biblioteka) | Zbiór posiadanych fizycznie gier jednego kolekcjonera; jednostka izolacji | `prd.md:190` — „an account, one user, one library" | tabela `public.library_entries` (`…create_library_entries.sql:7`), strona `src/pages/library/index.astro` |
| **Library Entry** (wpis) | Pojedyncza posiadana gra: tytuł + platforma + status + metadane | `prd.md:52` — „the entry is auto-saved to the library with external metadata attached" | `src/types.ts:13-21`, `src/lib/services/library.ts:55` |
| **Platform** (konsola) | Konsola, na którą wydana jest gra; free-text, ale z kuratorowaną listą | `prd.md:56` — „names a specific game title and platform" | kolumna `platform text not null` (`…create_library_entries.sql:11`), `src/lib/platforms.ts:14` (`KNOWN_PLATFORMS`) |
| **Play Status** (status ogrania) | Stan relacji kolekcjonera z grą; sygnał dla rekomendera | `prd.md:68` — „Available statuses: 'Playing now', 'Played', 'Completed', '100% completed'" | `src/types.ts:25` (`PLAY_STATUSES`), CHECK w `…create_library_entries.sql:12-13`, kontrolka `src/components/library/PlayStatusControl.tsx:47` |
| **Play Time** (czas gry) | Opcjonalne godziny zapisane przy wpisie, nieujemna liczba całkowita | `prd.md:70` — „Optional play time field (hours) accepts a non-negative integer" | `play_time_hours integer check (play_time_hours >= 0)` (`…create_library_entries.sql:14`), `src/lib/validation/library.ts:36` |
| **Metadata Enrichment** (wzbogacanie) | Automatyczne dociągnięcie gatunku/długości/roku/dewelopera/daty w chwili zapisu | `prd.md:134` (FR-008) — „automatically enriched with external metadata … at save time" | `src/lib/services/library.ts:96` (`metadataFromGrounding`), `:55`, `:136` |
| **Metadata Status** | Flaga „udało się dopasować metadane / brak dopasowania" | `prd.md:95` — „a flag indicating 'no metadata match'" | `src/types.ts:92` (`METADATA_STATUSES`), CHECK `…create_library_entries.sql:22`, badge `src/pages/library/index.astro:137` |
| **External metadata source / IGDB** | Zewnętrzne, autorytatywne źródło metadanych o grach | `prd.md:205` — „The input notes name IGDB (igdb.com) as the data source" | `src/lib/services/igdb.ts:437` (`lookupGameMetadata`) |
| **Overall game length** (długość gry) | Całkowity czas potrzebny na przejście gry — oś ograniczenia rekomendacji | `prd.md:161` — „reframed from 'session length tonight' to 'overall game length commitment'" | `length_hours numeric` (`…create_library_entries.sql:17`), `src/lib/services/igdb.ts:163` (`lengthHoursFromSeconds`) |
| **Length Bucket** (kubełek długości) | Dyskretyzacja długości gry na potrzeby dialu rekomendacji | `prd.md:80` — „short < 10h / medium 10–30h / long 30h+" | `src/types.ts:104` (`LENGTH_BUCKETS`), `:113` (`LENGTH_BUCKET_BOUNDS`) — **rozbieżne, zob. R-01** |
| **Novelty Mode** (tryb nowości) | Trzy jawne nastawienia: świeże w świecie / świeże w kolekcji / powrót do znanego | `prd.md:164` (FR-018) — „'new releases' … 'newly bought' … 'comfort'" | `src/types.ts:134` (`NOVELTY_MODES`), `src/lib/services/recommendation.ts:125` |
| **Recommendation** (rekomendacja) | Zdeterminowana, uszeregowana lista gier z własnej biblioteki pod zadane ograniczenia | `prd.md:178` — „decides … which already-owned game best matches the time the collector wants to commit and the novelty mode" | `src/lib/services/recommendation.ts:180` (`recommend`), strona `src/pages/play-next/index.astro:33` |
| **Determinism** (determinizm) | Te same wejścia → to samo wyjście; brak losowości w v1 | `prd.md:84` — „Ranking is deterministic — identical inputs produce identical outputs" | `src/lib/services/recommendation.ts:196-207` (sort + tie-break `created_at` → `id`) |
| **Explanatory empty state** | Zamiast pustej listy — zdanie nazywające ograniczenie, które wszystko wykluczyło | `prd.md:182` — „an empty state that names which constraint excluded everything, not an empty list" | `src/types.ts:157-170` (`EmptyReason`, `RecommendationResult`), `src/lib/services/recommendationCopy.ts:18` |
| **Photo identification** (rozpoznanie ze zdjęcia) | Odczyt tytułu + platformy z fotografii pudełka — differentiator produktu | `prd.md:125` — „photo identification is the core differentiator; without it, the product loses its identity" | `src/lib/services/vision.ts:62` (prompt), `src/pages/api/identify.ts:119` |
| **Confidence / abstain (`unsure`)** | Samoocena modelu i jawne „nie wiem" zamiast zgadywania | `prd.md:58` — „If the system cannot identify the game … the user is offered the manual-entry flow rather than an auto-saved guess" | `src/lib/services/vision.ts:29` (`CONFIDENCE_THRESHOLD = 0.6`), `src/types.ts:211-213` |
| **Accuracy guardrail (≥ 90%)** | Twardy próg jakości rozpoznania; poniżej niego produkt nie istnieje | `prd.md:43` — „reaches ≥ 90% correct on the user's own shelf"; `prd.md:174` — „the system either meets it or v1 is considered not-shipped" | **BRAK w kodzie produkcyjnym** — mierzone wyłącznie przez dev-harness `scripts/identify-harness.mjs`; żaden runtime nie zna tego progu |
| **Genre** (gatunek) | Wielowartościowy gatunek z IGDB; wymiar filtrowania | `prd.md:146` (FR-019) — „filter and sort the library view by status, platform, and genre" | `genre text[]` (`…enrich_library_entries_metadata.sql:16`), filtr `src/lib/services/library.ts:276` |
| **Search (duplicate check)** | Wyszukiwanie po fragmencie tytułu — obsługa pytania „czy już to mam?" przed zakupem | `prd.md:40` — „can search their library to check whether they already own a given title before buying it" | `src/lib/services/library.ts:267` (`ilike '%term%'`), escapowanie `:204` |
| **Pagination / Browse** | Stronicowany przegląd biblioteki, skalujący się powyżej 50 pozycji | `prd.md:138` (FR-009) — „browse their library via a paginated view" | `src/pages/library/index.astro:16` (`PAGE_SIZE = 20`), `src/lib/services/library.ts:237` |
| **Per-user isolation** | Żaden odczyt ani zapis nie może przekroczyć granicy użytkownika | `prd.md:171` — „no view, search, recommendation, or filter ever returns an entry the requesting user does not own" | RLS + 4 polityki (`…create_library_entries.sql:30-44`), granty (`…grant_library_entries_privileges.sql:42-43`), `src/middleware.ts:4` |
| **Confirm-on-delete** | Usunięcie wymaga potwierdzenia; brak soft-delete/archiwum | `prd.md:148` (FR-020) — „User must confirm a delete action before the entry is removed" | `src/components/library/DeleteEntryDialog.tsx`, twardy DELETE `src/lib/services/library.ts:186` |

### 1.2 Pojęcia żyjące TYLKO w kodzie (K, brak w PRD)

To jest najcenniejsza warstwa wiedzy domenowej, której dokument wizji nie zna.
Wszystkie mają uzasadnienie w roadmapie/archiwum, ale **żadne nie jest pojęciem PRD**.

| Pojęcie | Definicja | Gdzie w kodzie | Ślad w dokumentach |
|---|---|---|---|
| **Grounding** | Zakotwiczenie surowego odczytu (z modelu albo z formularza) w konkretnym `igdb_id` — moment, w którym „napis na pudełku" staje się „tą grą" | `src/lib/services/igdb.ts:437`, `src/pages/api/identify.ts:171` | **Termin nieobecny w `prd.md`**; pojawia się dopiero w `test-plan.md:59` i `roadmap.md:218` |
| **Edition variant / Base game / collapse** | Rozróżnienie wydania (Deluxe/GOTY/Complete) od gry bazowej i sprowadzenie pierwszego do drugiego | `src/lib/services/igdb.ts:233` (`normalizeBaseTitle`), `:256` (`isEditionEntry`), `:314` (`collapseToBaseGame`) — ~140 linii reguł | `roadmap.md:218` (S-09). **PRD mówi coś przeciwnego**: `prd.md:199` — „No edition-level precision in v1" |
| **Confident match / false-positive suppression** | Złożona bramka zaufania: próg informacyjności zapytania, podobieństwo Dice'a nazw, weto platformowe, próg popularności | `src/lib/services/igdb.ts:345-348` (stałe `MIN_QUERY_INFO_CHARS`, `NAME_SIM_FLOOR = 0.34`, `NAME_SIM_STRONG = 0.8`, `POP_FLOOR = 5`), `:403` (`isConfidentMatch`) | `roadmap.md:218`. Cztery liczby progowe **nie mają żadnego oracle w PRD** |
| **Recall floor** | Zasada projektowa: każda bramka może tylko zamienić dopasowanie na `no_match`, nigdy odwrotnie | `src/lib/services/igdb.ts:312`, `:401`, `:516` | brak |
| **Eligibility (twardy filtr trybu)** | Reguła, która *wyklucza* wpis z rankingu (w odróżnieniu od kary punktowej) | `src/lib/services/recommendation.ts:88` (`isEligible`) | brak — PRD zna tylko „de-prioritized" (`prd.md:83`) |
| **Strict-priority scoring** | Wagi `W_LEN=1000 ≫ W_COMP=100 ≫ W_NOV=1` czyniące ranking faktycznie leksykograficznym przy jednej liczbie | `src/lib/services/recommendation.ts:35-37` | brak — `prd.md:24` mówi tylko „hybrid scoring recommender" |
| **Novelty rank normalization** | Normalizacja osi nowości do `[0,1]` po *rangach* wartości, nie po wartościach surowych | `src/lib/services/recommendation.ts:145` (`noveltyRank`) | brak |
| **Facets** | Opcje filtrów zawężone do rzeczywiście posiadanych wartości, z licznikami | `src/types.ts:70` (`LibraryFacets`), RPC `…library_facets_rpc.sql:16` | brak |
| **Series (collection)** | Cykl/kolekcja z IGDB jako osobny wymiar filtrowania | `series text[]` (`…enrich_library_entries_metadata.sql:18`), filtr `src/lib/services/library.ts:279` | **PRD wprost tego zabrania**: `prd.md:198` — „No … series/collection grouping" |
| **Platform alias → canonical label** | Trzecia mapa platform: alias → etykieta wyświetlana | `src/lib/platforms.ts:50` (`PLATFORM_DISPLAY_BY_ALIAS`), `:94` | `roadmap.md:258` (H-03) |
| **Title casing normalization** | Dwutrybowa reguła odkrzykiwania tytułów z zachowaniem stylizacji (`inFAMOUS`, `Portal RTX`) | `src/lib/platforms.ts:150` (`normalizeTitleCasing`) | `roadmap.md:258` (H-03) |
| **E2E vision stub seam** | Klucz-bramkowany szew zastępujący wyłącznie hop do dostawcy vision | `src/lib/services/vision.ts:84-91`, `:103` (`constantTimeEquals`) | `test-plan.md:126` |
| **Cross-island entry sync** | Szyna zdarzeń synchronizująca kilka niezależnych wysp React opisujących ten sam wiersz | `src/components/library/entrySync.ts:21-36` | brak |
| **`EntryNotFoundError`** | Semantyczne rozróżnienie „nie ma takiego wiersza / należy do kogoś innego" od błędu bazy | `src/lib/services/library.ts:21` | brak |

### 1.3 Pojęcia żyjące TYLKO w dokumencie (D, brak w kodzie)

| Pojęcie | Cytat | Status w kodzie |
|---|---|---|
| **Mood / genre preference jako oś rekomendacji** (FR-017) | `prd.md:162` — „User can constrain the recommendation request by mood / genre preference. Priority: nice-to-have" | **BRAK** — `RecommendationRequest` (`src/types.ts:146-149`) ma wyłącznie `lengthBuckets` + `mode`; `/play-next` nie renderuje kontrolki gatunku |
| **Edition-level distinction jako wartość dla kolekcjonera** | `prd.md:24` — „no edition-level distinction (collectors care about the edition; trackers conflate them)" | **BRAK jako cecha** — kod robi dokładnie odwrotność: sprowadza edycje do gry bazowej (`igdb.ts:314`). Zgodne z non-goalem `prd.md:199`, sprzeczne z narracją wizji |
| **≥ 90% accuracy jako warunek shipowalności** | `prd.md:174` — „the system either meets it or v1 is considered not-shipped" | **BRAK w runtime** — tylko dev-harness `scripts/identify-harness.mjs`; żaden test CI ani gate produkcyjny tego nie pilnuje |
| **NFR: rekomendacja < 2 s p95, identyfikacja < 10 s p95** | `prd.md:169-170` | **BRAK pomiaru** — `test-plan.md:126` odnotowuje wprost, że „the 10 s p95 latency NFR" nie jest testowalne w obecnym harness |
| **Filter/sort state preserved within a browsing session** | `prd.md:109` | Zrealizowane pośrednio przez URL params (`src/pages/library/index.astro:28-35`) — działa, ale „session" nie jest pojęciem modelowanym |

---

## KROK 2 — Klasyfikacja subdomen

Kryterium rdzenia: to, co PRD nazywa powodem istnienia produktu i przewagą.
Cytat rozstrzygający: `prd.md:184` — *„The rule is not empty CRUD. The recommendation IS
the product's reason to exist … Photo identification (FR-005 onward) is the enabling
capability — but the recommendation is the rule."*

| Obszar / pojęcie | Kategoria | Uzasadnienie (odwołanie do celów produktu) |
|---|---|---|
| **Recommendation Engine** (scoring, kubełki, tryby, eligibility, empty-state) | **CORE** | `prd.md:184` nazywa to wprost regułą i powodem istnienia; `prd.md:159` (FR-015) — „the recommender IS the core value proposition; degrading it to a button-press kills the product". Success criterion primary (`prd.md:37`) kończy się na „ranked list whose top result is a defensible match" |
| **Photo Identification** (odczyt vision, confidence, abstain) | **CORE** | `prd.md:125` — „the core differentiator; without it, the product loses its identity"; guardrail `prd.md:43` jest warunkiem shipowalności. Formalnie *enabling capability* (`prd.md:184`), ale z twardym progiem jakości — więc rdzeń, nie wsparcie |
| **IGDB Grounding + edition collapse + confident match** | **CORE** | To warstwa, od której zależy guardrail ≥ 90%: `roadmap.md:221` — „F-03 measured the vision read at ~95% but the strict guardrail at 71.2% because first-match grounding lands on edition variants". Odczyt modelu był dobry; rdzeniowe ryzyko siedziało w groundingu. `test-plan.md:57` stawia to jako Ryzyko #1 (High × High) |
| **Play Status tracking** | **SUPPORTING** (rdzeniowo-zależne) | Samo w sobie to CRUD, ale `prd.md:153` uzasadnia czwarty status wprost potrzebą rekomendera: „The recommender's comfort bias and the 'what should I play next?' gap both depend on knowing what's in-progress vs. dropped vs. completed". Zasila rdzeń, nie jest rdzeniem |
| **Library Entry CRUD** (add/edit/delete + confirm) | **SUPPORTING** | Konieczne, by rdzeń miał na czym działać (`prd.md:141` — pełna edycja jest *wymuszona* decyzją o auto-save z FR-006), ale sama w sobie nie jest przewagą — spreadsheet też to potrafi (`prd.md:24`) |
| **Metadata enrichment (mapowanie na kolumny, `metadata_status`)** | **SUPPORTING** | `prd.md:135` — „length and genre data feed the recommender, so the data must be present when the user requests a suggestion". Istnieje po to, by rdzeń miał wejścia |
| **Search / Filter / Sort / Facets** | **SUPPORTING** | Search obsługuje *secondary* success criterion (`prd.md:40`), nie primary; FR-019 (`prd.md:146`) uzasadniony wyłącznie ergonomią przy 50+ pozycjach. Wartościowe, ale wymienne |
| **Platform vocabulary + normalizacja** | **SUPPORTING** | Nie jest wartością dla użytkownika, ale jest kluczem, po którym rdzeń działa: filtruje zapytanie IGDB (`igdb.ts:492-496`), wetuje dopasowanie (`igdb.ts:412-419`) i jest wymiarem filtra (`library.ts:273`) |
| **Auth (email+password, sesja, sign-out)** | **GENERIC** | `prd.md:115` — OAuth odrzucone, „email+password keeps the auth surface minimal and self-contained". Zero specyfiki domenowej; w całości delegowane do `@supabase/ssr` (`src/lib/supabase.ts:10`) |
| **Persystencja + RLS** | **GENERIC** (mechanizm) / **CORE constraint** (reguła) | Sam mechanizm to standardowy Postgres+RLS. Ale *reguła*, którą realizuje — `prd.md:171` — jest niepodlegającym negocjacji NFR, a `test-plan.md:61` (Ryzyko #5) odnotowuje, że opiera się na jednej warstwie |
| **Paginacja, theming, layout, dev toolbar** | **GENERIC** | Rozwiązania standardowe; `roadmap.md:265`/`:272` traktują je jako hardening UX |
| **Observability (Sentry, `logError`)** | **GENERIC** | `src/lib/logger.ts` jako jedyny punkt wpięcia; brak semantyki domenowej |
| **Image downscale** | **GENERIC** | `src/lib/image/downscale.ts` — czysto techniczne (limit 10 MB, `identify.ts:37`) |

**Wniosek klasyfikacyjny.** Rdzeń jest w trzech miejscach (`recommendation.ts`,
`igdb.ts`, `vision.ts`) — łącznie ~820 linii — i wszystkie trzy leżą płasko w
`src/lib/services/` obok czystego CRUD-u (`library.ts`). Kod nie odróżnia rdzenia od
wsparcia ani strukturą katalogów, ani typami.

---

## KROK 3 — Kandydaci na agregaty i ich niezmienniki

Legenda statusu: **EGZEKWUJE** = kod/baza fizycznie uniemożliwia naruszenie ·
**DEKLARUJE** = reguła spisana w komentarzu/typie/schemacie, ale obchodzialna ·
**IGNORUJE** = reguła z dokumentu nie ma odpowiednika w kodzie.

### A. `LibraryEntry` — agregat główny (korzeń: wiersz `library_entries`)

| # | Niezmiennik | Cytat źródłowy | Status | Dowód |
|---|---|---|---|---|
| A1 | Wpis należy do dokładnie jednego użytkownika i nigdy nie jest widoczny ani mutowalny przez innego | `prd.md:171` | **EGZEKWUJE** (baza) | `…create_library_entries.sql:30` (`enable row level security`), `:34-44` (4 polityki `auth.uid() = user_id`, INSERT/UPDATE z `with check`), `:9` (`default auth.uid()`). Trasy API świadomie *nie* sprawdzają własności — `test-plan.md:61` nazywa to decyzją ratyfikowaną |
| A2 | Tytuł i platforma są wymagane i niepuste | `prd.md:94` — „Title and platform are required" | **DEKLARUJE** | zod na brzegu: `src/pages/api/library/index.ts:15-18`, `src/lib/validation/library.ts:33-34` (`.trim().min(1)`). Baza ma tylko `not null` (`…create_library_entries.sql:10-11`) — pusty string przechodzi. Brak CHECK-a |
| A3 | `play_status` należy do zamkniętego słownika | `prd.md:68` | **EGZEKWUJE** (baza + typ) | CHECK `…create_library_entries.sql:12-13`; `src/types.ts:25`; zod `src/lib/validation/library.ts:35`, `:65` |
| A4 | `play_time_hours` to nieujemna liczba całkowita, pusta = nieustawiona | `prd.md:70` | **EGZEKWUJE** (baza + zod) | CHECK `…create_library_entries.sql:14`; `src/lib/validation/library.ts:36` (`.int().min(0).nullable()`) |
| A5 | **Spójność metadanych**: `metadata_status='matched'` ⟺ metadane pochodzą z jednego, konkretnego `igdb_id` | `prd.md:95` — „a flag indicating 'no metadata match'"; `prd.md:134` (FR-008) | **DEKLARUJE na zapisie / IGNORUJE na edycji** | Przy tworzeniu para jest nierozerwalna — jeden `metadataFromGrounding` (`src/lib/services/library.ts:96-124`) ustawia wszystkie 8 kolumn razem, używany przez oba tory (`:79`, `:144`). Ale `updateEntrySchema` przyjmuje `igdb_id` i `metadata_status` jako niezależne pola (`src/lib/validation/library.ts:44-45`), a `updateLibraryEntry` zapisuje patch verbatim (`library.ts:168`). Baza nie ma żadnego CHECK-a wiążącego te kolumny. `PUT` z `{igdb_id: null, metadata_status: "matched"}` przejdzie |
| A6 | `date_bought` jest ustawiona przy tworzeniu (oś „newly bought") | `prd.md:164` (FR-018) — „'newly bought' (date-added-to-library recency)" | **DEKLARUJE, z fallbackiem** | `src/lib/services/library.ts:40` (`today()`), `:78`, `:143`. Ale kolumna jest nullowalna (`…create_library_entries.sql:15`) i formularz pozwala ją wyczyścić (`GameFormFields.tsx:161`); silnik ma wtedy fallback na `created_at` (`recommendation.ts:128`) |
| A7 | Wpis raz zapisany nie ginie (brak soft-delete, brak archiwum) | `prd.md:172` — „no entry the user has confirmed … is lost"; `prd.md:143` — „kept hard delete" | **EGZEKWUJE** | Twardy `delete` (`src/lib/services/library.ts:186-194`) z 404 przy zerowym zbiorze, bez ścieżki „soft" |
| A8 | Usunięcie wymaga potwierdzenia | `prd.md:148` (FR-020) | **DEKLARUJE (tylko UI)** | `src/components/library/DeleteEntryDialog.tsx`; `DELETE /api/library/[id]` (`[id].ts:225`) nie zna pojęcia potwierdzenia — to niezmiennik warstwy prezentacji, nie agregatu |
| A9 | Platforma zapisana we wpisie ma postać kanoniczną (żeby filtr, faseta i grounding mówiły o tej samej konsoli) | **BRAK w dokumencie** — reguła wyprowadzalna z `prd.md:106` (kombinowalność filtrów) i `prd.md:146` | **IGNORUJE** | `normalizePlatformLabel` (`src/lib/platforms.ts:94`) jest wywoływana **wyłącznie** w torze zdjęciowym (`src/lib/services/vision.ts:150`, `:224`). Tor ręczny (`src/pages/api/library/index.ts:15`) zapisuje free-text bez normalizacji. Filtr platformy używa dokładnego `.in()` (`library.ts:273`), więc „PS5" i „PlayStation 5" to dwie osobne fasety |

### B. `Recommendation` — agregat obliczeniowy / polityka (bez tożsamości, czysta funkcja)

| # | Niezmiennik | Cytat źródłowy | Status | Dowód |
|---|---|---|---|---|
| B1 | Ranking jest deterministyczny — te same wejścia dają to samo wyjście | `prd.md:84` | **EGZEKWUJE** | `recommend()` jest czystą funkcją bez I/O i bez zegara (`src/lib/services/recommendation.ts:180`); sort ma pełny porządek: score → `created_at` → `id` (`:196-207`). Testy: `recommendation.test.ts` (625 linii) |
| B2 | Rekomendacja pochodzi wyłącznie z własnej biblioteki użytkownika | `prd.md:180` — „a ranked list of games from the collector's own library" | **EGZEKWUJE** | `listAllEntries` bez filtra `user_id`, izolacja przez RLS (`src/lib/services/library.ts:343-352`) |
| B3 | Nigdy pusta lista — zawsze albo ranking, albo stan pusty nazywający ograniczenie | `prd.md:85`, `prd.md:182` | **EGZEKWUJE (typem) + DEKLARUJE (copy)** | Unia dyskryminowana `RecommendationResult` (`src/types.ts:168-170`) czyni „pustą listę" niereprezentowalną; zdanie dla człowieka w `src/lib/services/recommendationCopy.ts:18-26`. Ale `EmptyReason` ma tylko 2 wartości (`src/types.ts:162`), a `mode_eligibility` konflatuje dwa różne ograniczenia — rozplątuje je dopiero warstwa copy |
| B4 | Wynik #1 respektuje wybrane ograniczenie długości | `prd.md:81` — „Top result respects the length constraint" | **IGNORUJE (świadomie przedefiniowane)** | Długość jest **miękką, stopniowaną karą**, nie filtrem: `lengthDistance` (`recommendation.ts:73-80`) liczy dystans kubełkowy, `NULL_DISTANCE = 4` (`:45`) dla braku danych. Komentarz `src/types.ts:99-102` mówi to wprost: „the engine measures bucket *distance* so out-of-bucket games degrade gracefully rather than disappearing". Konsekwencja: przy pustym trafieniu w kubełku #1 będzie grą spoza niego |
| B5 | Gry ukończone w 100% są **de-priorytetyzowane**, poza trybem comfort | `prd.md:83` | **IGNORUJE (surowsze niż spec, w obie strony)** | Poza comfort `completed_100` jest **twardo wykluczone** (`recommendation.ts:88-93`, `isEligible`) — nie de-priorytetyzowane. Wewnątrz comfort dostaje **najgorszą** karę `1` (`:102-113`), choć PRD (`prd.md:180`) mówi, że w comfort „previously-played titles are exactly what's wanted". `test-plan.md:64` niezależnie to wychwycił: „the spec says 100%-complete games are *de-prioritized*, the code *excludes* them" |
| B6 | Priorytet osi: długość ≫ ukończenie ≫ nowość | **BRAK w dokumencie** | **EGZEKWUJE (arytmetyką)** | `W_LEN=1000`, `W_COMP=100`, `W_NOV=1` (`recommendation.ts:35-37`) z komentarzem dowodzącym rozłączności zakresów (`:28-34`). To najbardziej rdzeniowa reguła produktu i **nie ma jej w żadnym dokumencie** |
| B7 | Tryb wyznacza jeden twardy filtr, który jako jedyny może wyzerować zbiór | **BRAK w dokumencie** | **EGZEKWUJE** | `isEligible` (`:88`) + komentarz `src/types.ts:159-161`: „length never empties the set — it's a graded soft penalty — so it is never the binding constraint" |

### C. `PhotoIdentification` — agregat procesowy (przepływ `identify`)

| # | Niezmiennik | Cytat źródłowy | Status | Dowód |
|---|---|---|---|---|
| C1 | Nieudane rozpoznanie **nie** zapisuje zgadywanki — kieruje do wpisu ręcznego | `prd.md:58` | **CZĘŚCIOWO / SPRZECZNIE** | `unsure` z vision faktycznie nie zapisuje niczego (`src/pages/api/identify.ts:163-165`) i otwiera dialog ręczny (`PhotoCapture.tsx:44`). Ale gdy vision jest pewny, a **IGDB zwraca `no_match`**, tor `persist` mimo to zapisuje wiersz z pustymi metadanymi (`identify.ts:183-213`) — podczas gdy tor harnessu na tym samym wejściu zwija się do `unsure` (`:219-221`). Napięcie jest realne i udokumentowane: FR-006 (`prd.md:126`) nakazuje auto-save, US-01 AC (`prd.md:58`) nakazuje fallback; `test-plan.md:58` odnotowuje sprostowanie cytatu dokładnie w tym miejscu |
| C2 | Odczyt poniżej progu pewności to jawne „nie wiem" | `prd.md:58` (intencja) | **EGZEKWUJE** | `CONFIDENCE_THRESHOLD = 0.6` (`src/lib/services/vision.ts:29`), jedno miejsce strojenia |
| C3 | Grounding rozstrzyga na **grę bazową**, nie na wariant edycji | `roadmap.md:218` (S-09) — **brak w PRD** | **EGZEKWUJE** | `collapseToBaseGame` (`src/lib/services/igdb.ts:314-330`): najpierw relacje `version_parent`/`parent_game` z bramką platformową (`:317-320`), potem dopasowanie tytułu bazowego (`:322-327`), w ostateczności kandydat #1 (`:329`) |
| C4 | Cienki/niejednoznaczny odczyt degraduje do `no_match`, nigdy nie przykleja błędnych metadanych | `roadmap.md:218` | **EGZEKWUJE** | `isConfidentMatch` (`igdb.ts:403-424`): 4 bramki (informacyjność, podobieństwo Dice'a, weto platformowe, próg popularności); wywołane w `:517-519` |
| C5 | Metadane czytane są z gry bazowej, nie z edycji, po collapse | `roadmap.md:218` (intencja) | **EGZEKWUJE + strzeżone testem** | `igdb.ts:509-512` przypisuje `game` = base, a `:529-549` czyta pola z `game`; test regresyjny „reads metadata off the collapsed base, not the edition" (`igdb.integration.test.ts:82`) |
| C6 | Awaria wzbogacania nigdy nie kosztuje użytkownika jego danych | `prd.md:172` (NFR trwałości) | **EGZEKWUJE** | `try/catch` wokół lookupu z degradacją do `no_match` (`src/lib/services/library.ts:65-73`) — z jawnym `logError`, żeby awaria IGDB nie była nieodróżnialna od biblioteki gier niszowych (`:70-72`) |
| C7 | Awaria wzbogacania **nie** degraduje do `no_match` tam, gdzie lookup jest całym wynikiem | **BRAK w dokumencie** | **EGZEKWUJE** | `POST /api/library/lookup` zwraca 502 zamiast `no_match` (`src/pages/api/library/lookup.ts:105-112`), z 9-liniowym uzasadnieniem różnicy wobec toru create (`:76-83`) — to jest wiedza domenowa („nie wiemy" ≠ „nie ma") żyjąca wyłącznie w komentarzu |
| C8 | Jedno zdjęcie = jedna gra | `prd.md:201` — „One game per photo" | **EGZEKWUJE (kontraktem)** | `uploadSchema` przyjmuje pojedynczy `File` pod polem `photo` (`identify.ts:43-48`) |
| C9 | Trafność ≥ 90% na własnej półce | `prd.md:43`, `prd.md:174` | **IGNORUJE (brak gate'u)** | Mierzone wyłącznie przez `scripts/identify-harness.mjs` uruchamiane ręcznie; brak progu w CI, brak alertu, brak metryki runtime |

### D. `Collector` / `Account` — agregat generyczny

| # | Niezmiennik | Cytat źródłowy | Status | Dowód |
|---|---|---|---|---|
| D1 | Jedno konto = jedna biblioteka; brak ról, workspace'ów, gości | `prd.md:188` — „The model is flat — one user, no roles, no shared workspaces" | **EGZEKWUJE** | Brak jakiejkolwiek tabeli ról; jedyna relacja to `user_id` FK (`…create_library_entries.sql:9`) |
| D2 | Nieuwierzytelnione żądanie do trasy bibliotecznej jest odrzucane | `prd.md:188` — „unauthenticated requests to any library route are rejected" | **EGZEKWUJE (dwuwarstwowo)** | `PROTECTED_ROUTES` + redirect (`src/middleware.ts:4`, `:24-28`) dla stron; `if (!locals.user) → 401` w każdej trasie API (`api/library/index.ts:33`, `[id].ts:135`, `:186`, `:232`, `identify.ts:121`, `lookup.ts:86`) |
| D3 | Usunięcie konta kaskaduje na bibliotekę | **BRAK w dokumencie** | **EGZEKWUJE** | `on delete cascade` (`…create_library_entries.sql:9`) |

### E. `PlatformVocabulary` — kandydat na obiekt wartości (dziś nie istnieje)

| # | Niezmiennik | Cytat źródłowy | Status | Dowód |
|---|---|---|---|---|
| E1 | Jedna konsola ma jedną tożsamość w całym systemie | wyprowadzalny z `prd.md:106` i `prd.md:146`; **niespisany** | **IGNORUJE** | Pojęcie „platforma" jest rozsypane na **cztery** niezależne reprezentacje: `KNOWN_PLATFORMS` (picklista, `platforms.ts:14`), `PLATFORM_DISPLAY_BY_ALIAS` (alias → etykieta, `platforms.ts:50`), `PLATFORM_IDS_BY_NAME` (alias → id IGDB, `igdb.ts:62`) i **ręczna kopia tej ostatniej** poza systemem typów (`scripts/identify-harness.mjs:42`). Kod sam ostrzega przed dryfem: `igdb.ts:59-61` — „DUPLICATED: … If you grow this map, mirror the change there too — otherwise harness scoring drifts silently from real grounding" |

---

## KROK 4 — Rozjazdy MODEL vs KOD

Uporządkowane malejąco wg wpływu na rdzeń.

| # | Dokument mówi X | Kod robi Y | Dowód (plik:linia) | Ocena |
|---|---|---|---|---|
| **R-01** | Trzy kubełki długości: „short (< 10h), medium (10–30h), long (30h+)" | Cztery kubełki: `short / medium / long (30–60h) / very_long (60h+)`; etykieta „Long" znaczy co innego niż w PRD | `prd.md:80`, `prd.md:160` (FR-016), `roadmap.md:192` (S-07) **vs** `src/types.ts:104`, `:113-118`, `:121-126` | **Rozszerzenie bez aktualizacji dokumentu.** Użytkownik widzi cztery kontrolki tam, gdzie spec obiecuje trzy. Wtórnie: `test-plan.md:64` odnotowuje, że „30h is spec-ambiguous" — kod rozstrzyga granicę (30 → `long`) bez oracle w PRD |
| **R-02** | „100%-completed games are de-prioritized except under the 'comfort' mode" | Poza comfort: **twarde wykluczenie** z rankingu. W comfort: najgorsza możliwa kara (`1`), choć PRD mówi, że to właśnie tam są pożądane | `prd.md:83`, `prd.md:180` **vs** `src/lib/services/recommendation.ts:88-93` (`isEligible`), `:102-113` (`statusPenalty`) | **Semantyczny rozjazd w rdzeniu.** Reguła jest surowsza niż spec w obie strony. Testy asertują zachowanie kodu, nie reguły — `test-plan.md:64` nazywa to wprost: „asserting absence tests the stricter code, not the rule" |
| **R-03** | „Top result respects the length constraint — the game's reported overall length … fits the chosen bucket" | Długość jest miękką karą stopniowaną; gra spoza kubełka może być #1, gdy w kubełku nic nie ma | `prd.md:81` **vs** `src/lib/services/recommendation.ts:73-80`, `:45` (`NULL_DISTANCE`), komentarz projektowy `src/types.ts:99-102` | **Świadome przedefiniowanie reguły w kodzie.** Uzasadnienie („degrade gracefully") jest sensowne i spisane — ale w komentarzu do typu, nie w PRD. Dokument nadal obiecuje twardą gwarancję |
| **R-04** | Non-goal: „No wishlists, no deal tracking, **no series/collection grouping**" | `series text[]` jako pełnoprawna kolumna, faseta z licznikami i wymiar filtra `.overlaps()` | `prd.md:198`, `shape-notes.md:227`, `roadmap.md:307` (zaparkowane) **vs** `…enrich_library_entries_metadata.sql:8`, `:18`; `…library_facets_rpc.sql:47-58`; `src/lib/services/library.ts:279`; `src/types.ts:74`, `:86` | **Zbudowany non-goal.** Nikt nie zaktualizował listy zakazów; funkcja jest w produkcji, ma migrację, RPC, typ i filtr |
| **R-05** | Non-goal: „No edition-level precision in v1 … deferred to v2"; jednocześnie wizja (`prd.md:24`) liczy rozróżnianie edycji jako lukę rynkową | ~140 linii dedykowanej wiedzy o edycjach: normalizacja tytułu bazowego, wykrywanie wpisu-edycji, collapse przez relacje IGDB z bramką platformową, tie-break po długości nazwy | `prd.md:24`, `prd.md:199` **vs** `src/lib/services/igdb.ts:192-330` (`EDITION_TOKENS`, `PUBLISHER_PREFIXES`, `normalizeBaseTitle`, `isEditionEntry`, `pickBaseCandidate`, `collapseToBaseGame`) | **Nie sprzeczność funkcjonalna, ale luka wiedzy.** Kod *realizuje* non-goal (sprowadza edycje do bazy), lecz robi to najbogatszym modelem domenowym w repo — którego PRD w ogóle nie zna. Cała wiedza „czym jest edycja" żyje w kodzie i w archiwum S-09 |
| **R-06** | „If the system cannot identify the game from the photo, the user is offered the manual-entry flow rather than an auto-saved guess" | Vision-`unsure` → tak. Ale vision-pewny + IGDB `no_match` → **wiersz jest zapisywany** z pustymi metadanymi; ten sam warunek na torze harnessu zwija się do `unsure` | `prd.md:58` (US-01 AC) vs `prd.md:126` (FR-006, nakazuje auto-save) **vs** `src/pages/api/identify.ts:163-165`, `:183-213`, `:219-221` | **Sprzeczność wewnątrz samego PRD, rozstrzygnięta w kodzie.** Ta sama trasa ma dwie różne semantyki zależnie od flagi `persist` — udokumentowane w komentarzu `:179-182` („This INVERTS the harness's no_match→unsure fold"). `test-plan.md:58` sprostował cytat Ryzyka #2 dokładnie tutaj |
| **R-07** | Cztery statusy ogrania (`prd.md:68`) | Pięć: dochodzi `not_played` jako wartość domyślna | `prd.md:68`, `prd.md:152` (FR-013) **vs** `src/types.ts:25`, `…create_library_entries.sql:12-13` | **Uzasadnione rozszerzenie, niespisane.** `not_played` nie jest kosmetyczne — to *twardy filtr* trybu comfort (`recommendation.ts:89-90`), więc piąty status uczestniczy w rdzeniowej regule |
| **R-08** | FR-019: filtrowanie po „status, platform, and genre" (trzy wymiary) | Cztery wymiary — dochodzi `series` (zob. R-04) | `prd.md:146` **vs** `src/types.ts:83-88`, `src/lib/services/library.ts:269-280` | Konsekwencja R-04 |
| **R-09** | FR-017 (nice-to-have): ograniczanie rekomendacji nastrojem / gatunkiem | Brak — `RecommendationRequest` ma wyłącznie `lengthBuckets` i `mode`; strona `/play-next` nie renderuje żadnej kontrolki gatunku | `prd.md:162` **vs** `src/types.ts:146-149`, `src/lib/validation/library.ts:100-119`, `src/pages/play-next/index.astro:81-90` | **Nie-rozjazd, świadome odłożenie** — priorytet `nice-to-have`, `prd.md:163` mówi „revisit in v2". Odnotowane dla kompletności |
| **R-10** | „a flag indicating 'no metadata match'" — flaga opisuje stan dopasowania | `metadata_status` i `igdb_id` są na torze edycji polami niezależnymi; żaden CHECK ani schemat nie wiąże ich razem | `prd.md:95` **vs** `src/lib/validation/library.ts:44-45`, `src/lib/services/library.ts:168`, brak constraintu w `…create_library_entries.sql:21-22` | **Niezmiennik A5 obchodzialny.** Przy tworzeniu para jest atomowa (`library.ts:96-124`), przy `PUT` — nie |
| **R-11** | „no view, search, recommendation, or filter ever returns an entry the requesting user does not own" | Egzekwowane, ale **wyłącznie** w jednej warstwie (RLS); trasy API świadomie nie sprawdzają własności | `prd.md:171` **vs** `…create_library_entries.sql:34-44`; `test-plan.md:61` — „Isolation rests on a single database policy layer, so one policy edit or credential swap breaches it with no application code change" | **Nie rozjazd — koncentracja ryzyka.** Zaadresowana: 18 asercji pgTAP (`test-plan.md:125`) to jedyna warstwa, która to widzi. Migracja `…grant_library_entries_privileges.sql:24-40` dokumentuje nawet, co ta obrona *przestała* wykrywać |
| **R-12** | Guardrail ≥ 90% jest „the binding success threshold for FR-005; the system either meets it or v1 is considered not-shipped" | Żaden test, gate CI ani metryka runtime nie zna tej liczby; mierzy ją ręcznie uruchamiany `scripts/identify-harness.mjs` | `prd.md:43`, `prd.md:174` **vs** brak wystąpień progu w `src/`; `test-plan.md:126` przyznaje, że NFR-y latencji też nie są egzekwowalne w obecnym harness | **Twardy warunek shipowalności bez egzekucji.** Regresja jakości groundingu przejdzie zieloną tarczą CI |
| **R-13** | Filtry mają być kombinowalne, a wpis ma jedną platformę (`prd.md:106`, `prd.md:56`) | Ta sama konsola trafia do bazy pod różnymi etykietami: tor zdjęciowy normalizuje, tor ręczny nie | `prd.md:106` **vs** `src/lib/services/vision.ts:150`, `:224` (jedyne wywołania `normalizePlatformLabel`) wobec `src/pages/api/library/index.ts:15-18` (brak normalizacji); filtr używa dokładnego `.in()` (`library.ts:273`) | **Cichy rozjazd danych.** „PS5" wpisane ręcznie i „PlayStation 5" ze zdjęcia to dwie fasety, dwa filtry i dwa różne wyniki groundingu. `test-plan.md:65` odnotowuje, że H-03 celowo wyłączył normalizację z toru ręcznego — decyzja jest świadoma, jej konsekwencja dla modelu nie jest spisana |
| **R-14** | Jedno pojęcie „platforma" | Cztery reprezentacje, jedna z nich poza systemem typów | `src/lib/platforms.ts:14`, `:50`; `src/lib/services/igdb.ts:62`; `scripts/identify-harness.mjs:42` — z komentarzem-ostrzeżeniem `igdb.ts:59-61` | **Rozproszony obiekt wartości.** Kod sam wie, że to problem, i rozwiązuje go komentarzem |

---

## KROK 5 — Ranking refaktoru

Oś **wartości**: jak rdzeniowy jest niezmiennik (wg klasyfikacji z KROKU 2).
Oś **ryzyka**: jak słabo jest dziś egzekwowany (wg statusów z KROKU 3).

| Poz. | Kandydat | Wartość | Ryzyko | Uzasadnienie |
|---|---|---|---|---|
| **#1** | **`LibraryEntry` — z `Platform` wydzieloną jako obiekt wartości** | **Wysoka** (substrat rdzenia) | **Wysokie** | Trzy niezmienniki bez egzekucji: A9/E1 (kanoniczność platformy — **IGNORUJE**), A5 (spójność metadanych na edycji — **IGNORUJE**), A2 (niepustość na poziomie bazy — **DEKLARUJE**). Blast radius jest największy w repo, bo `platform` nie jest polem opisowym, tylko **kluczem trzech podsystemów naraz**: filtruje zapytanie do IGDB (`igdb.ts:492-496`), wetuje dopasowanie (`igdb.ts:412-419`) i jest wymiarem filtra/fasety (`library.ts:273`) |
| **#2** | **`Recommendation` — uzgodnienie reguły ze specyfikacją** | **Najwyższa** (`prd.md:184` — „the recommendation IS the rule") | **Średnie** | Technicznie to najlepiej zabezpieczony kod w repo: czysta funkcja, pełny porządek, 625 linii testów. Ryzykiem nie jest awaria, lecz **cichy dryf semantyczny**: R-01, R-02, R-03 znaczą, że produkcja realizuje inną regułę niż ta w PRD, a testy asertują kod, nie regułę. Naprawa jest w większości dokumentacyjna (zaktualizować PRD albo cofnąć kod) — dlatego nie #1 |
| **#3** | **`PhotoIdentification` — rozstrzygnięcie C1 i przywrócenie guardrailu** | **Wysoka** (differentiator + warunek shipowalności) | **Średnie** | Sam grounding jest wzorowo modelowany (C3–C5 **EGZEKWUJE**, ze strzegącymi testami integracyjnymi). Otwarte są dwie rzeczy: sprzeczność auto-save vs fallback (R-06, wynikająca ze sprzeczności *wewnątrz PRD*) oraz brak jakiegokolwiek gate'u dla progu ≥ 90% (R-12). Ta druga to jedyne miejsce, gdzie dokument formułuje warunek „not-shipped" bez mechanizmu |
| **#4** | **`Collector` / izolacja** | **Wysoka** (twardy NFR) | **Niskie** | R-11 to koncentracja, nie luka. Broniona najlepiej ze wszystkich: 18 asercji pgTAP w jedynej warstwie, która widzi awarię, plus migracja dokumentująca granice tej obrony (`…grant_library_entries_privileges.sql:24-40`). Nie ruszać |
| **#5** | **Kontrakty walidacji (A2/A4, trzy warstwy)** | Średnia | Średnie | `test-plan.md:65` (Ryzyko #6) już to mapuje i stwierdza, że część rozbieżności ma oracle w PRD, a część to udokumentowane zachowanie bez specyfikacji. Domyka się przy okazji #1 |

### Do refaktoru: **#1 — `LibraryEntry` z wydzieloną `Platform` jako obiektem wartości**

Dlaczego to, a nie rekomender (który jest przecież rdzeniem):

1. **Rekomender jest zdrowy, jego wejścia nie są.** `recommend()` nie ma jak się
   pomylić — nie ma I/O, ma pełny porządek i domknięte testy. Ale karmi się polami
   `LibraryEntry`, których nikt nie broni: `length_hours` bierze się z groundingu,
   grounding filtruje po `platform`, a `platform` to nieznormalizowany free-text
   (R-13). Wpis ręczny „PS5" trafia do `resolvePlatformIds` (`igdb.ts:124`) — tam
   akurat alias jest znany — ale zapisuje się w bazie jako „PS5", więc rozjeżdża
   fasety i filtry względem wpisów zdjęciowych zapisanych jako „PlayStation 5".
   Zła metadana to zły `length_hours`, a zły `length_hours` to zły ranking na
   dominującym członie wagi (`W_LEN = 1000`, `recommendation.ts:35`).

2. **Wartość ma dziś cztery reprezentacje, jedną poza systemem typów.** `KNOWN_PLATFORMS`,
   `PLATFORM_DISPLAY_BY_ALIAS`, `PLATFORM_IDS_BY_NAME` i ręczna kopia w
   `scripts/identify-harness.mjs:42`. Kod *wie*, że to problem, i broni się komentarzem
   (`igdb.ts:59-61`: „otherwise harness scoring drifts silently from real grounding").
   Komentarz nie jest niezmiennikiem — a to jest dokładnie definicja obiektu wartości,
   który nie został wydzielony.

3. **Niezmienniki agregatu są dziś egzekwowane tylko na jednym z dwóch torów zapisu.**
   `metadataFromGrounding` (`library.ts:96-124`) robi rzecz właściwą — atomowo ustawia
   ośmiokolumnową parę „skąd te metadane". `PUT /api/library/[id]` tę atomowość
   rozbiera na osiem niezależnych pól (`validation/library.ts:32-46`). Agregat, który
   pilnuje niezmiennika przy tworzeniu i nie pilnuje go przy edycji, nie jest agregatem
   — jest funkcją fabrykującą.

4. **Koszt jest najniższy w stosunku do zasięgu.** Trzy ruchy, żaden nie dotyka rdzenia
   rekomendera: (a) jeden kanoniczny `Platform` jako obiekt wartości, z którego pochodzą
   wszystkie cztery obecne mapy, i wywoływany na **obu** torach zapisu; (b) `metadata_status`
   i `igdb_id` związane w jeden typ sumaryczny w schemacie edycji, żeby stan „matched
   bez id" był niereprezentowalny; (c) CHECK-i wartościowe dosunięte do bazy tam, gdzie
   dziś broni tylko zod. Wszystkie trzy są testowalne na najtańszej warstwie (unit + pgTAP),
   której repo już używa.

---

## Załącznik: dług dokumentacyjny (nie kodu)

Osobno, bo naprawa nie polega na zmianie kodu, tylko na dopisaniu do PRD reguł,
które produkcja już realizuje:

| Reguła żyjąca tylko w kodzie | Gdzie | Dlaczego to dług |
|---|---|---|
| Priorytet osi rankingu (`1000 : 100 : 1`) | `recommendation.ts:28-37` | Najbardziej rdzeniowa reguła produktu, nieopisana w żadnym dokumencie |
| Cztery progi bramki wiarygodności (`0.34 / 0.8 / 5 / 2 znaki`) | `igdb.ts:345-348` | Liczby decydujące o guardrailu ≥ 90%, bez oracle w specyfikacji |
| `NULL_DISTANCE = 4` — gry bez znanej długości nigdy nie znikają, tylko spadają | `recommendation.ts:45` | Reguła widoczna dla użytkownika, nieopisana |
| „nie wiemy" ≠ „nie ma" — asymetria degradacji create vs lookup | `lookup.ts:76-83` | Świetnie uargumentowana wiedza domenowa, żyjąca w komentarzu |
| Recall floor jako zasada projektowa groundingu | `igdb.ts:312`, `:401`, `:516` | Wyznacza, w którą stronę wolno pomylić się każdej bramce |
