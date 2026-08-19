---
title: "Gaming Library — agregat-strażnik pochodzenia metadanych (plan refaktoru)"
created: 2026-08-19
type: refactor-plan
---

# Agregat-strażnik: spójność pochodzenia metadanych `LibraryEntry`

Plan refaktoru, nie implementacja. Żaden plik produkcyjny nie został zmieniony.
Każdy cytat `plik:linia` został zweryfikowany przez odczyt pliku w tej sesji.

Dokument siostrzany: `context/domain/01-domain-distillation.md` (destylacja domeny,
Ubiquitous Language, mapa rozjazdów MODEL↔KOD). Ten dokument **zawęża** wybór #1
z tamtego rankingu do jednego niezmiennika i projektuje dla niego strażnika.

---

## KROK 0 — Kontekst

### Dokumenty wymagań (znalezione i przeczytane)

| Dokument | Ścieżka | Co z niego bierzemy |
|---|---|---|
| PRD | `context/foundation/prd.md` (206 linii) | §Business Logic (`:178-186`), §Success Criteria (`:38-45`), US-01…US-05, FR-001…FR-020, §NFR (`:169-175`) |
| Test plan | `context/foundation/test-plan.md` (1128 linii) | Mapa ryzyk #1–#6 (`:57-64`), stan warstw testowych (§4), gate'y CI (§5) |
| Roadmapa | `context/foundation/roadmap.md` | Narracja slice'ów F-01…F-03, S-01…S-09, hardening H-01…H-05 |
| Lessons | `context/foundation/lessons.md` | Rejestr reguł powracających (2 wpisy) |
| CLAUDE.md / README | korzeń | Warstwy, komendy, konwencje |

Sekcja **Business Logic** jest rozstrzygająca dla oceny „rdzeniowości":

> „The rule is not empty CRUD. **The recommendation IS the product's reason to exist**"
> — `prd.md:184`

> „Top result respects the length constraint — the game's reported overall length
> **(from the external metadata source)** fits the chosen bucket" — `prd.md:81`

Drugie zdanie jest kluczowe dla całego tego dokumentu: PRD nie mówi „długość gry",
tylko „długość **z zewnętrznego źródła metadanych**". Pochodzenie danych jest częścią
kryterium akceptacji rdzeniowej reguły, nie detalem implementacyjnym.

### Stack i warstwy, w których żyje logika biznesowa

Astro 6 SSR (`output: "server"`) + React 19 islands + Tailwind 4 + Supabase (Postgres/auth)
+ Cloudflare Workers.

| Warstwa | Katalog / plik | Co tu naprawdę żyje |
|---|---|---|
| Persystencja + polityki | `supabase/migrations/**` | Tabela `library_entries`, CHECK-i wartościowe, RLS (4 polityki), 2 RPC (`list_used_platforms`, `library_facets`) |
| Serwisy (de facto domena) | `src/lib/services/{library,recommendation,igdb,vision,recommendationCopy}.ts` | Wzbogacanie przy zapisie, grounding IGDB, silnik rekomendacji, copy stanów pustych |
| Walidacja brzegowa | `src/lib/validation/library.ts` | Schematy zod dla PUT/PATCH/lookup + parser parametrów `/play-next` |
| API | `src/pages/api/**` | Bramka auth, parse JSON/multipart, zod, mapowanie błędów na statusy |
| Strony SSR | `src/pages/{library,play-next}/index.astro` | Odczyt, paginacja, filtry, stany puste |
| UI (wyspy React) | `src/components/library/**` | Dialog add/edit, inline status, capture zdjęcia, re-fetch metadanych |

**Nie ma warstwy domenowej.** Nie istnieje `src/lib/domain/`; nie ma ani jednej klasy
ani obiektu wartości niosącego niezmiennik. Reguły biznesowe żyją jako: (a) CHECK-i
w SQL, (b) funkcje w `src/lib/services/`, (c) schematy zod, (d) komentarze JSDoc,
(e) handlery w komponentach React. Ta piąta lokalizacja jest źródłem problemu wybranego niżej.

---

## KROK 1 — Zidentyfikowane niezmienniki

Reguły, które w tej domenie **muszą** być zawsze prawdziwe. Wyciągnięte z PRD **oraz**
z kodu. Kolumna „Źródło" cytuje dokument, kolumna „Gdzie żyje" — kod.

Legenda egzekucji: **E** = fizycznie niemożliwe do naruszenia · **D** = zadeklarowane
(komentarz / typ / schemat), obchodzialne · **I** = brak jakiejkolwiek egzekucji.

| # | Niezmiennik | Źródło (dokument) | Gdzie żyje (kod) | Egz. |
|---|---|---|---|---|
| **N-01** | Wpis należy do dokładnie jednego użytkownika i nigdy nie jest widoczny ani mutowalny przez innego | `prd.md:171`, `prd.md:188` | `20260606150950_create_library_entries.sql:30` (`enable row level security`), `:34-44` (4 polityki `auth.uid() = user_id`), `:9` (`default auth.uid()`); `src/lib/services/library.ts:33-34` (komentarz: trasy świadomie nie filtrują po `user_id`) | **E** |
| **N-02** | Tytuł i platforma są wymagane i niepuste | `prd.md:94` | zod: `src/pages/api/library/index.ts:15-18`, `src/lib/validation/library.ts:33-34`; baza: tylko `not null` (`…create_library_entries.sql:10-11`) — pusty string przechodzi | **D** |
| **N-03** | `play_status` należy do zamkniętego pięcioelementowego słownika | `prd.md:68` (4 statusy) + `not_played` z kodu | CHECK `…create_library_entries.sql:12-13`; `src/types.ts:25`; zod `src/lib/validation/library.ts:35`, `:65` | **E** |
| **N-04** | `play_time_hours` jest nieujemną liczbą całkowitą; puste = nieustawione | `prd.md:70` | CHECK `…create_library_entries.sql:14`; zod `src/lib/validation/library.ts:36`, `:66` | **E** |
| **N-05** | **Pochodzenie metadanych jest prawdziwe i atomowe**: `metadata_status='matched'` ⟺ osiem kolumn metadanych pochodzi z **jednego** rozstrzygniętego lookupu IGDB o identyfikatorze `igdb_id` | `prd.md:95` („a flag indicating 'no metadata match'"), `prd.md:134` (FR-008), `prd.md:81` („from the external metadata source") | Tor tworzenia: `src/lib/services/library.ts:96-124` (`metadataFromGrounding` — jedna funkcja ustawia wszystkie 8 kolumn), użyta w `:79` i `:144`. Tor edycji: **rozłożona na 8 niezależnych pól** w `src/lib/validation/library.ts:38-45` i zapisana verbatim w `library.ts:168`. Baza: **brak CHECK-a wiążącego** (`…create_library_entries.sql:21-22`) | **D na zapisie / I na edycji** |
| **N-06** | „Nie wiemy" ≠ „nie ma": awaria transportu do IGDB nie może być raportowana jako brak dopasowania tam, gdzie lookup jest całym wynikiem | brak w PRD — reguła wyłącznie z kodu | `src/pages/api/library/lookup.ts:213-220` (9-liniowe uzasadnienie) + `:242-249` (502 zamiast `no_match`); odwrotnie i świadomie na torze create: `src/lib/services/library.ts:65-73` | **E na `lookup`, świadomie złamana na `create`** |
| **N-07** | Awaria wzbogacania nigdy nie kosztuje użytkownika jego danych — wpis i tak zostaje zapisany | `prd.md:172` (NFR trwałości), `prd.md:95` | `src/lib/services/library.ts:65-73` (`try/catch` + `logError`), `:82` (insert zawsze) | **E** |
| **N-08** | Nierozpoznane zdjęcie nie zapisuje zgadywanki — kieruje do wpisu ręcznego | `prd.md:58` (US-01 AC), `prd.md:130` (FR-007) | `src/pages/api/identify.ts:163-165` (`unsure` → wczesny return, przed blokiem persist `:183-213`); `PhotoCapture.tsx:44` | **E dla vision-`unsure`** (napięcie z FR-006 opisane w 01-domain-distillation R-06) |
| **N-09** | Odczyt poniżej progu pewności to jawne „nie wiem" | `prd.md:58` (intencja) | `src/lib/services/vision.ts:29` (`CONFIDENCE_THRESHOLD = 0.6`), `:213-214` | **E** |
| **N-10** | Grounding rozstrzyga na **grę bazową**, nie na wariant edycji, i nigdy nie przekracza bramki platformowej | `roadmap.md` (S-09); `prd.md:199` jako non-goal | `src/lib/services/igdb.ts:314-330` (`collapseToBaseGame`), `:289-299` (bramka platformowa), `:403-424` (`isConfidentMatch`) | **E** |
| **N-11** | Ranking jest deterministyczny — te same wejścia dają to samo wyjście | `prd.md:84` | `src/lib/services/recommendation.ts:180` (czysta funkcja, bez I/O i bez zegara), `:196-207` (pełny porządek score → `created_at` → `id`) | **E** |
| **N-12** | Rekomendacja pochodzi wyłącznie z biblioteki wnioskującego użytkownika | `prd.md:180` | `src/lib/services/library.ts:343-352` (brak filtra `user_id` — izolacja przez N-01) | **E** (dziedziczy z N-01) |
| **N-13** | Nigdy pusta lista — zawsze ranking albo stan pusty nazywający ograniczenie | `prd.md:85` | Unia dyskryminowana `RecommendationResult` (`src/types.ts:168-170`) czyni pustą listę niereprezentowalną; `src/lib/services/recommendation.ts:181-188` | **E** |
| **N-14** | Wynik #1 respektuje wybrane ograniczenie długości, mierzone **długością z zewnętrznego źródła** | `prd.md:81` | Długość jest miękką karą stopniowaną, nie filtrem: `recommendation.ts:73-80`, `:45` (`NULL_DISTANCE = 4`); dominuje wagą `W_LEN = 1000` (`:35`) | **I co do twardości filtra** (świadome przedefiniowanie, `src/types.ts:99-102`) · **I co do pochodzenia** (patrz N-05) |
| **N-15** | Gry ukończone w 100% są de-priorytetyzowane poza trybem comfort | `prd.md:83` | `recommendation.ts:88-93` (`isEligible` — twarde wykluczenie, surowsze niż spec), `:102-116` | **E, ale surowiej niż spec** |
| **N-16** | `date_bought` jest ustawiona serwerowo przy tworzeniu i stanowi oś „newly bought" | `prd.md:164` (FR-018) | `src/lib/services/library.ts:40-42` (`today()`), `:78`, `:143`; oś: `recommendation.ts:126-130` | **D** — kolumna nullowalna (`…create_library_entries.sql:15`), a `PUT` przyjmuje dowolną datę, także przyszłą (`src/lib/validation/library.ts:25-30`, `:37`) |
| **N-17** | Usunięcie wymaga potwierdzenia użytkownika | `prd.md:148` (FR-020) | wyłącznie UI: `src/components/library/DeleteEntryDialog.tsx`; `DELETE /api/library/[id]` (`[id].ts:170-196`) nie zna pojęcia potwierdzenia | **D (tylko klient)** — ale to niezmiennik warstwy prezentacji, nie agregatu; API nie ma jak go egzekwować |
| **N-18** | Wpis raz zapisany nie ginie (twarde usunięcie na życzenie, brak soft-delete) | `prd.md:172`, `prd.md:143` | `src/lib/services/library.ts:186-194` | **E** |

---

## KROK 2 — Klasyfikacja i wybór #1

Trzy osie, zgodnie z poleceniem: **(a) rdzeniowość** wobec celu produktu z `prd.md:178-186`,
**(b) rozsmarowanie** — w ilu plikach/warstwach reguła fizycznie żyje, **(c) egzekucja**.

| # | (a) Rdzeniowość | (b) Rozsmarowanie | (c) Egzekucja | Wypadkowa |
|---|---|---|---|---|
| N-01 | **Wysoka** — twardy NFR, otwarta rejestracja | 1 warstwa (baza), świadomie skoncentrowana | **E**, 18 asercji pgTAP | Nie ruszać. Ryzyko jest skoncentrowane, nie nieobsłużone |
| N-02 | Średnia | 3 warstwy (zod ×2, `not null`) | **D** | Domyka się przy okazji |
| N-03 / N-04 | Średnia | 3 warstwy, zgodne | **E** | Zdrowe |
| **N-05** | **Najwyższa pośrednio** — karmi dominujący człon rekomendera (`W_LEN=1000`) i jest **jedynym** sygnałem zaufania pokazywanym użytkownikowi; FR-006 (auto-save) jest akceptowalne tylko dlatego, że ten sygnał istnieje | **Największe w repo: 8 plików / 5 warstw** — baza, serwis (2 tory tworzenia), serwis (tor edycji), schemat zod, trasa PUT, trasa PATCH, trasa `identify`, dialog React, strona SSR | **D na tworzeniu, I na edycji** — jedynym strażnikiem sprzężenia na torze edycji jest handler React (`GameDialog.tsx:293-303`) | **← wybór #1** |
| N-06 | Średnia | 2 warstwy, celowo rozbieżne | częściowa | Wiedza domenowa żyjąca w komentarzu — dług dokumentacyjny, nie luka egzekucji |
| N-07 / N-08 / N-09 / N-10 | Wysoka (differentiator) | skoncentrowana w `services/` | **E** | Najlepiej zamodelowany fragment repo (testy integracyjne S-09) |
| N-11 / N-12 / N-13 | **Najwyższa bezpośrednio** | 1 plik, czysta funkcja | **E** | Nie ma czego strzec — nie ma jak się zepsuć |
| N-14 | Najwyższa | 1 plik | **I** co do twardości | Rozjazd **semantyczny**, nie luka egzekucji: naprawa to aktualizacja PRD albo zmiana reguły, nie agregat |
| N-15 | Wysoka | 1 plik | **E**, surowiej niż spec | jw. — dług dokumentacyjny |
| N-16 | Średnia | 3 warstwy | **D** | Rider N-05 — ta sama trasa `PUT`, ten sam mechanizm |
| N-17 | Średnia | 1 warstwa (UI) | **D** | Niezmiennik prezentacji — agregat go nie obejmie i nie powinien |
| N-18 | Wysoka | 1 plik | **E** | Zdrowe |

### Wybór: **N-05 — spójność i prawdziwość pochodzenia metadanych**

Uzasadnienie, dlaczego to, a nie rekomender (który jest przecież literalnie rdzeniem, `prd.md:184`):

1. **Rekomender nie ma jak się zepsuć — jego wejścia mają.** `recommend()` (`recommendation.ts:180`)
   jest czystą funkcją bez I/O i bez zegara, z pełnym porządkiem sortowania (`:196-207`) i
   625 liniami testów. Rozjazdy N-14/N-15 są semantyczne (kod realizuje surowszą regułę niż
   PRD), a nie egzekucyjne — nie naprawia się ich agregatem, tylko decyzją produktową i
   aktualizacją PRD. Natomiast **dominujący człon punktacji** to `lengthDistance` z wagą
   `W_LEN = 1000` (`recommendation.ts:35`, `:167-169`), liczony z `length_hours` — kolumny,
   którą tor edycji pozwala nadpisać ręcznie, nie zmieniając przy tym flagi mówiącej, że
   dane są „z zewnętrznego źródła". `prd.md:81` czyni pochodzenie tej liczby **częścią
   kryterium akceptacji**, a nie metadanymi o metadanych.

2. **To jedyny niezmiennik, którego jedynym strażnikiem jest klient.** Sprzężenie
   „metadane ↔ `igdb_id` ↔ `metadata_status`" jest ustanawiane w dokładnie jednym miejscu
   na torze edycji: w handlerze `handleRefetch` w komponencie React
   (`src/components/library/GameDialog.tsx:293-303` — jedyne miejsce w repo, gdzie
   `metadata_status: "matched"` jest przypisywane razem z `igdb_id: result.igdbId`).
   Serwer nie sprawdza tego sprzężenia nigdy.

3. **Nielegalny stan jest dziś reprezentowalny.** `updateEntrySchema`
   (`src/lib/validation/library.ts:32-46`) traktuje `igdb_id` (`:44`) i `metadata_status`
   (`:45`) jako **niezależne pola skalarne**, a `updateLibraryEntry` (`library.ts:163-177`)
   zapisuje otrzymany patch verbatim. Nie ma też CHECK-a w bazie
   (`…create_library_entries.sql:21-22` deklaruje tylko słownik dwóch wartości). Wpis
   `{ metadata_status: "matched", igdb_id: null }` przechodzi przez wszystkie trzy warstwy.

4. **Agregat, który pilnuje reguły przy tworzeniu i nie pilnuje jej przy edycji, nie jest
   agregatem — jest funkcją fabrykującą.** `metadataFromGrounding` (`library.ts:96-124`)
   robi rzecz właściwą: atomowo ustawia osiem kolumn z jednego rozstrzygnięcia i jest
   współdzielona przez oba tory tworzenia (`:79` ręczny, `:144` zdjęciowy). `PUT` tę
   atomowość demontuje. Brakuje jednego miejsca, przez które przechodzi **każda** zmiana stanu.

To spełnia oba warunki polecenia jednocześnie: najbardziej rdzeniowy z niezmienników,
które **nie są** egzekwowane, i najsłabiej egzekwowany z tych, które **są** rdzeniowe.

---

## KROK 3 — Diagnoza N-05

### 3.1 Gdzie reguła dziś żyje — wszystkie warstwy

| # | Warstwa | Plik:linia | Co robi z regułą |
|---|---|---|---|
| 1 | Persystencja | `supabase/migrations/20260606150950_create_library_entries.sql:16-22` | Zna **tylko słownik** (`check (metadata_status in ('matched','no_match'))`, `:22`). `igdb_id bigint` (`:21`) jest kolumną całkowicie niezależną. Zero sprzężenia |
| 2 | Serwis, tor tworzenia (wspólny) | `src/lib/services/library.ts:96-124` | **Jedyna prawdziwa egzekucja.** Jedna funkcja zwraca `Pick<…, 8 kolumn>`; gałąź `matched` (`:102-113`) i gałąź „wszystko null + `no_match`" (`:114-123`) są rozłączne i kompletne |
| 3 | Serwis, tor ręczny | `src/lib/services/library.ts:55-87` | Konsumuje (2) w `:79`. Poprawnie |
| 4 | Serwis, tor zdjęciowy | `src/lib/services/library.ts:136-152` | Konsumuje (2) w `:144`. Poprawnie |
| 5 | Serwis, tor edycji | `src/lib/services/library.ts:163-177` | **Nie zna reguły.** `.update(patch)` (`:168`) — komentarz `:156` mówi wprost: „the caller sends the complete editable set and we write it verbatim" |
| 6 | Walidacja | `src/lib/validation/library.ts:32-46` | Waliduje **typy**, nie sprzężenie: `igdb_id: z.number().nullable()` (`:44`), `metadata_status: z.enum(METADATA_STATUSES).nullable()` (`:45`). Komentarz `:12-13` deklaruje regułę („enrichment-owned — carried through unchanged on a plain save, mutated only by a successful re-fetch") — deklaruje, nie egzekwuje |
| 7 | Trasa `PUT` | `src/pages/api/library/[id].ts:96-102` | `safeParse` → `updateLibraryEntry(supabase, id, parsed.data)`. Przekazuje 14 pól dalej bez żadnej reguły domenowej |
| 8 | Trasa `identify` (persist) | `src/pages/api/identify.ts:191-195` | Konsumuje (4). Poprawnie — ale trzyma **drugą** kopię decyzji „co znaczy matched" w kształcie odpowiedzi (`:208-210`) |
| 9 | Klient — dialog | `src/components/library/GameDialog.tsx:293-303` | **Jedyny strażnik sprzężenia na torze edycji.** Ustawia 7 pól metadanych + `metadata_status: "matched"` + `igdb_id` w jednym `patchValues` |
| 10 | Klient — wysyłka | `src/components/library/GameDialog.tsx:82-98` | `mapValuesToBody` **zawsze** dokleja `igdb_id` (`:95`) i `metadata_status` (`:96`) do body `PUT`, także gdy użytkownik ich nie dotykał |
| 11 | Klient — formularz | `src/components/library/GameFormFields.tsx:12-16` | Komentarz: „`igdb_id`/`metadata_status` are carried but never rendered — they're enrichment-owned and mutated only by a successful re-fetch". **Pola metadanych obok nich są w pełni edytowalne**: `length_hours` (`:204-215`), `release_year` (`:216-226`), `release_date` (`:229-239`), plus `genre`/`developer`/`series` przez `TagInput` |
| 12 | Odczyt SSR | `src/pages/library/index.astro:136-138` | `metadataLabel()` — flaga jest **jedynym** sygnałem zaufania w liście („No metadata") |
| 13 | Odczyt w dialogu | `src/components/library/GameDialog.tsx:379-381` | Ta sama flaga jako badge „No metadata" |
| 14 | Konsument | `src/lib/services/recommendation.ts:73-80`, `:167-169` | Czyta `length_hours` **nie patrząc na pochodzenie** — i skaluje je wagą `W_LEN = 1000` (`:35`), czyli dominującym członem rankingu |

### 3.2 Które warstwy jej nie egzekwują

- **Baza (1)** — zna słownik, nie zna sprzężenia. Wiersz `matched` + `igdb_id IS NULL` jest legalny.
- **Serwis edycji (5)** — świadomie „last-write-wins", bez reguły domenowej.
- **Walidacja (6)** — waliduje typ pola, nie relację między polami. `.refine()` istnieje w tym
  samym pliku (`:68-70`, dla `patchEntrySchema`), więc mechanizm jest znany i po prostu tu nie użyty.
- **Trasa `PUT` (7)** — czysty przewód.

### 3.3 Gdzie reguła jest egzekwowana niespójnie

Dwa tory zapisu, jedna kolumna, dwie semantyki:

- **Tworzenie**: osiem kolumn to jedna, nierozerwalna decyzja (`library.ts:96-124`).
- **Edycja**: te same osiem kolumn to osiem niezależnych pól formularza
  (`validation/library.ts:38-45`).

Do tego **trzecia** semantyka: `metadata_status` na torze tworzenia nigdy nie jest `null`
(`library.ts:111`, `:122` — zawsze `matched` albo `no_match`), ale typ dopuszcza `null`
(`src/types.ts:18-19`, `validation/library.ts:45`), a formularz startuje z `null`
(`GameDialog.tsx:59`). Trzy wartości w typie, dwie produkowane, jedna nieosiągalna z serwera.

### 3.4 Gdzie klient jest jedynym strażnikiem

`GameDialog.tsx:293-303`. To jedyne miejsce w całym repo, w którym na torze edycji
`metadata_status='matched'` powstaje razem z odpowiadającym mu `igdb_id`. Konsekwencje:

**Naruszenie A — codzienne, przez zwykłe UI, bez żadnego „hackowania".**
Użytkownik otwiera dialog edycji wpisu z `metadata_status='matched'`, poprawia
`Length (hours)` z 42 na 12 (`GameFormFields.tsx:204-215`) i zapisuje.
`mapValuesToBody` (`GameDialog.tsx:82-98`) wysyła nową długość **razem z niezmienionym**
`igdb_id` i `metadata_status: "matched"`. Efekt: wiersz twierdzi, że jego długość pochodzi
z IGDB gry #`igdb_id`, choć została wpisana ręcznie. Rekomender mnoży tę liczbę przez
`W_LEN = 1000` (`recommendation.ts:35`, `:167`), a lista pokazuje wpis bez ostrzeżenia
(`library/index.astro:137`). `prd.md:81` obiecuje w tym miejscu coś, co przestało być prawdą.

**Naruszenie B — zmiana tytułu odpina identyfikator od gry.**
Użytkownik poprawia błędnie rozpoznany tytuł (dokładnie ten scenariusz, dla którego
`prd.md:141` **wymusił** pełną edytowalność: „required by FR-006's auto-save decision so
users can correct mis-identified entries") i zapisuje bez naciśnięcia „Re-fetch metadata".
`igdb_id` zostaje przy starej grze, `metadata_status` dalej mówi `matched`, a wszystkie
metadane opisują grę, której wpis już nie dotyczy. Wpis wygląda na w pełni wzbogacony i jest
w całości fałszywy. **To jest ten sam ruch, który PRD nazywa główną ścieżką naprawy
złych auto-zapisów.**

**Naruszenie C — cofnięcie wzbogacenia przez nieświeżą zakładkę.**
`mapEntryToValues` (`GameDialog.tsx:63-79`) robi snapshot wiersza w momencie otwarcia dialogu.
Jeśli w międzyczasie inny kontekst wykonał udany re-fetch, zapis z tej zakładki nadpisze
`igdb_id`/`metadata_status` starymi wartościami — pól, których użytkownik nie widzi
(`GameFormFields.tsx:14`) i nie mógł świadomie wybrać. „Last-write-wins" (`library.ts:156`)
obejmuje tu dane, których użytkownik nigdy nie edytował.

**Naruszenie D — żądanie z pominięciem UI.**
`PUT /api/library/{id}` z body `{ …, igdb_id: null, metadata_status: "matched" }` przechodzi
zod (`validation/library.ts:44-45`), serwis (`library.ts:168`) i bazę
(`…create_library_entries.sql:22`). Powstaje wiersz twierdzący „dopasowano", bez czegokolwiek,
do czego dopasowanie miałoby się odnosić. Ten sam trik w drugą stronę (`metadata_status: null`)
tworzy stan, którego żaden tor serwerowy nie produkuje.

### 3.5 Gdzie błąd jest „połykany" zamiast zatrzymywać operację

- **`library.ts:65-73`** — `try/catch` wokół lookupu IGDB składa awarię transportu do
  `no_match`. To jest **świadome i słuszne** (N-07 / `prd.md:172`: wpis nie może przepaść),
  z jawnym `logError` i czteroliniowym uzasadnieniem (`:69-72`). Ale koszt jest realny i
  nienazwany w modelu: **„IGDB odpowiedziało: nie ma" i „nie udało się zapytać" lądują w tej
  samej wartości kolumny.** Ta sama warstwa gdzie indziej ten koszt odrzuca — `lookup.ts:213-220`
  ma dziewięć linii tłumaczące, dlaczego tam odpowiedź brzmi 502, a nie `no_match`. Domena zna
  różnicę, schemat kolumny jej nie zna.
- **`identify.ts:172-177`** — analogiczne połknięcie na torze zdjęciowym: `grounding` zostaje
  `null`, a `createLibraryEntryFromGrounding` zamienia `null` na `no_match` (`library.ts:114-123`).
- **`updateLibraryEntry` (`library.ts:163-177`)** — nie połyka błędu, ale **nie ma czego wykryć**:
  nie istnieje warunek, który mógłby zwrócić „ta operacja jest nielegalna". Każdy syntaktycznie
  poprawny patch jest legalny.

### 3.6 Podsumowanie diagnozy

Reguła jest rozsmarowana na 14 miejsc w 5 warstwach. Jest **egzekwowana w jednym**
(`library.ts:96-124`, tylko tworzenie), **deklarowana w trzech komentarzach**
(`validation/library.ts:12-13`, `GameFormFields.tsx:14-15`, `library.ts:90-95`),
**pilnowana przez jeden handler React** (`GameDialog.tsx:293-303`) i **nieznana bazie**.
Cztery różne, realne sekwencje operacji utrwalają wiersz, który kłamie o pochodzeniu
swoich danych — a te dane karmią dominujący człon rdzeniowej reguły produktu.

---

## KROK 4 — Projekt agregatu-strażnika

### 4.1 Zasada projektowa

Agregat `LibraryEntry` staje się **jedynym miejscem**, w którym powstaje jakikolwiek
zapisywalny stan wiersza `library_entries`. Nie ma settera na `metadata_status` ani
`igdb_id` — obie kolumny są **wyprowadzane** z obiektu wartości `EntryMetadata`.
Stan nielegalny (`matched` bez identyfikatora) przestaje być reprezentowalny w typie,
a nie tylko zabroniony walidacją.

Napięcie do rozwiązania: **FR-008** (`prd.md:134`) żąda prawdziwej flagi pochodzenia,
a **FR-010** (`prd.md:140-141`) żąda edytowalności **każdego** pola — i to nie na zasadzie
kompromisu, tylko jako warunek konieczny FR-006. Zakaz edycji metadanych złamałby FR-010;
milczące utrzymanie `matched` po edycji łamie FR-008. Rozwiązaniem jest **trzeci stan
pochodzenia**, nazwany jawnie: ręczna edycja pola metadanych jest legalną operacją domenową,
która **przenosi wpis do `user_edited`**, zachowując `igdb_id` jako źródło poprzedniego
dopasowania (żeby re-fetch dalej miał od czego zacząć).

### 4.2 Obiekt wartości `EntryMetadata`

`src/lib/domain/entry-metadata.ts` (nowy plik)

```ts
/** Pola metadanych, które zawsze podróżują razem. Jedno źródło prawdy dla ósemki kolumn. */
export interface MetadataFields {
  readonly genre: string[] | null;
  readonly developer: string[] | null;
  readonly series: string[] | null;
  readonly releaseYear: number | null;
  readonly releaseDate: string | null;   // YYYY-MM-DD
  readonly lengthHours: number | null;
}

/**
 * Pochodzenie metadanych wpisu. Unia dyskryminowana — jedyny nośnik N-05.
 * Nie da się skonstruować `igdb_matched` bez `igdbId`: to jest cała pointa.
 */
export type EntryMetadata =
  | { readonly provenance: "igdb_matched";  readonly igdbId: number;             readonly fields: MetadataFields }
  | { readonly provenance: "igdb_no_match";                                      readonly fields: EmptyFields }
  | { readonly provenance: "user_edited";   readonly sourceIgdbId: number | null; readonly fields: MetadataFields };

export const EntryMetadata = {
  /** Z rozstrzygniętego lookupu. Jedyne wejście do `igdb_matched`. */
  fromLookup(result: IgdbLookupResult): EntryMetadata,

  /** Lookup się nie odbył (transport/auth/KV). Osobne wejście, żeby N-06 miało nazwę. */
  unavailable(): EntryMetadata,

  /**
   * Ręczna zmiana pól metadanych. Precondition: `patch` faktycznie różni się od
   * `current.fields` — identyczny patch zwraca `current` bez zmiany pochodzenia
   * (zapis bez edycji nie może zdegradować `matched`).
   * Zawsze zwraca `user_edited`, przenosząc `igdbId` → `sourceIgdbId`.
   */
  withUserFields(current: EntryMetadata, patch: Partial<MetadataFields>): EntryMetadata,

  /** Odtworzenie z wiersza bazy. Rzuca `MetadataProvenanceViolation` na niespójnym wierszu. */
  fromRow(row: LibraryEntryRow): EntryMetadata,

  /** Jedyne miejsce, gdzie powstają kolumny `metadata_status` i `igdb_id`. */
  toColumns(metadata: EntryMetadata): MetadataColumns,
};
```

### 4.3 Korzeń agregatu `LibraryEntry`

`src/lib/domain/library-entry.ts` (nowy plik)

```ts
export class LibraryEntry {
  private constructor(private state: LibraryEntryState) {}

  // --- Fabryki (jedyne wejścia do istnienia) ---

  /** Tor ręczny i zdjęciowy: jedna fabryka, lookup już rozstrzygnięty przez wołającego. */
  static create(input: { title: string; platform: string },
                metadata: EntryMetadata,
                acquiredOn: IsoDate): LibraryEntry;
     // precondition: title.trim() !== ""      else InvalidEntryFieldError("title")
     // precondition: platform.trim() !== ""   else InvalidEntryFieldError("platform")
     // precondition: acquiredOn <= today      else FutureAcquisitionDateError

  /** Tylko dla repozytorium. Rzuca, jeśli wiersz z bazy łamie N-05 (fail-fast na odczycie). */
  static rehydrate(row: LibraryEntryRow): LibraryEntry;
     // precondition: row.metadata_status !== "matched" || row.igdb_id !== null
     //               else MetadataProvenanceViolation(row.id)

  // --- Operacje domenowe ---

  /** FR-010. Zmiana tytułu NIE zostawia po sobie fałszywej pieczątki IGDB. */
  rename(title: string): void;
     // precondition: title.trim() !== "" else InvalidEntryFieldError("title")
     // effect: jeśli metadata.provenance === "igdb_matched" i znormalizowany tytuł
     //         różni się od poprzedniego → metadata := user_edited(sourceIgdbId = igdbId)
     //         (naruszenie B z §3.4 przestaje być możliwe)

  changePlatform(platform: string): void;
     // precondition: platform.trim() !== "" else InvalidEntryFieldError("platform")
     // effect: jak wyżej — zmiana platformy unieważnia dopasowanie IGDB jako "matched"

  /** Re-fetch. Jedyne wejście do (ponownego) `igdb_matched`. */
  applyLookup(result: IgdbLookupResult): "matched" | "no_match";
     // matched  → metadata := EntryMetadata.fromLookup(result)   (nadpisuje pola)
     // no_match → stan bez zmian, zwraca "no_match" (zachowanie z GameDialog.tsx:304-306)
     // UWAGA: awaria transportu NIE wchodzi tutaj — trasa odpowiada 502 (N-06,
     //        zachowanie lookup.ts:242-249 utrzymane)

  /** FR-010 dla pól metadanych. Legalna operacja, która zmienia pochodzenie. */
  editMetadata(patch: Partial<MetadataFields>): void;
     // precondition: lengthHours === null || lengthHours >= 0 else InvalidEntryFieldError("length_hours")
     // effect: metadata := EntryMetadata.withUserFields(metadata, patch)

  setPlayStatus(status: PlayStatus): void;
     // precondition: PLAY_STATUSES.includes(status) else InvalidEntryFieldError("play_status")

  recordPlayTime(hours: number | null): void;
     // precondition: hours === null || (Number.isInteger(hours) && hours >= 0)
     //               else InvalidPlayTimeError(hours)

  setDateBought(date: IsoDate | null): void;
     // precondition: date === null || date <= today else FutureAcquisitionDateError(date)
     // (domyka N-16: dziś przyszła data przechodzi i zatruwa oś `newly_bought`)

  // --- Wyjścia ---

  toRow(): LibraryEntryRow;          // tylko repozytorium; woła EntryMetadata.toColumns
  get provenance(): MetadataProvenance;
  get id(): string;
}
```

**Czego w agregacie celowo NIE ma:**

- `setMetadataStatus()`, `setIgdbId()` — nie istnieją. `metadata_status` i `igdb_id`
  są wyprowadzane w `EntryMetadata.toColumns` i nigdzie indziej.
- Wywołania IGDB. Lookup jest **portem poza agregatem** (`MetadataLookupPort`); agregat
  przyjmuje **wynik** jako wartość. Dzięki temu cały agregat jest czysty i synchroniczny —
  testowalny na najtańszej warstwie, tak jak `recommend()` (`recommendation.ts:180`).
- Sprawdzania własności wpisu. N-01 zostaje **wyłącznie** w RLS — decyzja ratyfikowana
  w H-04 i udokumentowana w `test-plan.md:61`. Agregat jej nie duplikuje.

### 4.4 Nazwane błędy domenowe

`src/lib/domain/errors.ts` (nowy plik)

```ts
export abstract class DomainError extends Error { abstract readonly code: string; }

export class InvalidEntryFieldError      extends DomainError { code = "invalid_field"; }        // → 400
export class InvalidPlayTimeError        extends DomainError { code = "invalid_play_time"; }    // → 400
export class FutureAcquisitionDateError  extends DomainError { code = "future_date_bought"; }   // → 422
export class EntryNotFoundError          extends DomainError { code = "entry_not_found"; }      // → 404
export class MetadataProvenanceViolation extends DomainError { code = "provenance_violation"; } // → 500 + logError
```

`EntryNotFoundError` przenosi się z `src/lib/services/library.ts:21-26` bez zmiany semantyki
(trasy dalej mapują go na 404 — `[id].ts:107-108`, `:156-157`, `:190-191`).

`MetadataProvenanceViolation` jest **nieosiągalny po zakończeniu refaktoru** — rzuca się tylko
wtedy, gdy w bazie leży wiersz zapisany z pominięciem agregatu. Fail-fast: taki wiersz
**zatrzymuje operację**, zamiast po cichu wejść do rekomendera.

### 4.5 Repozytorium

`src/lib/repositories/library-entry-repository.ts` (nowy plik)

```ts
export interface LibraryEntryRepository {
  load(id: string): Promise<LibraryEntry>;            // rzuca EntryNotFoundError (PGRST116)
  insert(entry: LibraryEntry): Promise<LibraryEntry>;
  save(entry: LibraryEntry): Promise<LibraryEntry>;   // JEDEN update … returning *
}

export function createSupabaseLibraryEntryRepository(
  supabase: SupabaseClient<Database>,
): LibraryEntryRepository;
```

**Atomowość.** Agregat to dokładnie jeden wiersz, więc `insert … returning *` i
`update … eq(id) … returning *` są atomowe same z siebie — nie trzeba transakcji i nie
wolno jej udawać po stronie Workera. Co się zmienia: dziś nic nie broni dopisania **drugiego**
zapisu w tor edycji (np. „najpierw zapisz pola, potem flagę"), który rozerwałby ósemkę na
dwie instrukcje. Po refaktorze `toRow()` jest jedynym producentem ładunku, a repozytorium
jedynym wykonawcą zapisu — częściowy zapis metadanych przestaje mieć skąd powstać.

Lookup IGDB **pozostaje poza** granicą zapisu, jak dziś (`library.ts:66-73` przed insertem,
`identify.ts:171` przed persistem). To jest właściwe: zewnętrzne I/O nigdy nie powinno
siedzieć wewnątrz jednostki spójności.

**Zapytania odczytowe** (`listLibraryEntries`, `listAllEntries`, `getLibraryFacets`,
`listUsedPlatforms`) zostają w `src/lib/services/library.ts` bez zmian. To są projekcje,
nie ładowanie agregatu — zamiana ich na `repo.load()` po jednym wpisie byłaby regresją
wydajności bez zysku dla niezmiennika.

### 4.6 Cienkie trasy API

**`PUT /api/library/[id]`** — po refaktorze:

```ts
export const PUT: APIRoute = async ({ request, params, cookies, locals }) => {
  // ... niezmienione: createClient, bramka locals.user, params.id, request.json()

  const parsed = updateEntrySchema.safeParse(body);     // schemat BEZ igdb_id i metadata_status
  if (!parsed.success) return Response.json({ error: … }, { status: 400 });

  const repo = createSupabaseLibraryEntryRepository(supabase);
  try {
    const entry = await repo.load(id);                  // EntryNotFoundError → 404

    entry.rename(parsed.data.title);
    entry.changePlatform(parsed.data.platform);
    entry.setPlayStatus(parsed.data.play_status);
    entry.recordPlayTime(parsed.data.play_time_hours);
    entry.setDateBought(parsed.data.date_bought);
    entry.editMetadata({                                // → user_edited, jeśli cokolwiek się zmieniło
      genre: parsed.data.genre, developer: parsed.data.developer, series: parsed.data.series,
      releaseYear: parsed.data.release_year, releaseDate: parsed.data.release_date,
      lengthHours: parsed.data.length_hours,
    });

    return Response.json({ entry: (await repo.save(entry)).toRow() }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error, { entryId: id, userId: locals.user.id });
  }
};
```

**Mapowanie błędu domenowego na odpowiedź** — jedna funkcja, `src/lib/api/domain-errors.ts`:

| Błąd | Status | Logowany? |
|---|---|---|
| `EntryNotFoundError` | 404 | nie (oczekiwany skutek klienta — zachowanie `[id].ts:105-106`) |
| `InvalidEntryFieldError`, `InvalidPlayTimeError` | 400 | nie |
| `FutureAcquisitionDateError` | 422 | nie |
| `MetadataProvenanceViolation` | 500 | **tak**, `logError` (uszkodzony wiersz w bazie = incydent) |
| pozostałe | 500 | tak, jak dziś (`[id].ts:110`) |

**Przeniesienie egzekucji z klienta na serwer.** `GameDialog.mapValuesToBody`
(`GameDialog.tsx:82-98`) **przestaje wysyłać** `igdb_id` (`:95`) i `metadata_status` (`:96`).
`handleRefetch` (`:276-314`) **przestaje ustawiać** `metadata_status: "matched"` (`:302`) —
zamiast tego woła nową trasę `POST /api/library/{id}/refetch`, która na serwerze robi
`entry.applyLookup(result)` i zwraca zaktualizowany wiersz. Klient zostaje wyłącznie
prezentacją: pokazuje badge z `entry.metadata_status`, nigdy go nie wytwarza.

### 4.7 Backstop w bazie (obrona w głąb)

Nowa migracja `supabase/migrations/<YYYYMMDDHHmmss>_metadata_provenance_constraints.sql`:

```sql
-- 1. Trzeci stan pochodzenia (FR-008 × FR-010): ręczna edycja metadanych jest legalna
--    i jawnie oznaczona, zamiast po cichu podszywać się pod dopasowanie IGDB.
alter table public.library_entries
  drop constraint library_entries_metadata_status_check,
  add  constraint library_entries_metadata_status_check
       check (metadata_status in ('matched', 'no_match', 'user_edited'));

-- 2. Rdzeń N-05: "matched" bez identyfikatora przestaje być stanem reprezentowalnym.
alter table public.library_entries
  add constraint metadata_matched_requires_igdb_id
       check (metadata_status <> 'matched' or igdb_id is not null);

-- 3. Domknięcie N-02 na poziomie bazy (dziś broni tylko zod).
alter table public.library_entries
  add constraint title_platform_not_blank
       check (btrim(title) <> '' and btrim(platform) <> '');
```

Migracja poprzedzona zapytaniem preflight (Faza 0): jeśli istnieją wiersze
`metadata_status='matched' and igdb_id is null`, backfill ustawia je na `'user_edited'`
zamiast wywalać migrację. Po migracji: `npm run db:types` (regeneracja
`src/db/database.types.ts`) i rozszerzenie `METADATA_STATUSES` (`src/types.ts:90`).

---

## KROK 5 — Before/after, plan faz, testy

### 5.1 Before/after dla każdego dzisiejszego miejsca reguły

| # | Miejsce | Before | After |
|---|---|---|---|
| 1 | `…create_library_entries.sql:22` | `check (metadata_status in ('matched','no_match'))`; `igdb_id` niezależny | +`user_edited` w słowniku, +`metadata_matched_requires_igdb_id`, +`title_platform_not_blank` |
| 2 | `library.ts:96-124` `metadataFromGrounding` | Prywatna funkcja mapująca 8 kolumn; poprawna, ale współdzielona tylko przez 2 z 3 torów zapisu | Zastąpiona przez `EntryMetadata.fromLookup` / `.unavailable()` / `.toColumns()` w `src/lib/domain/entry-metadata.ts`; obsługuje **wszystkie** tory |
| 3 | `library.ts:55-87` `createLibraryEntry` | Lookup + `metadataFromGrounding` + insert w jednej funkcji | Lookup zostaje (port), po nim `LibraryEntry.create(input, EntryMetadata.fromLookup(g), today())` + `repo.insert()` |
| 4 | `library.ts:136-152` `createLibraryEntryFromGrounding` | Bliźniak (3) różniący się tylko brakiem lookupu | **Usunięty.** Tor zdjęciowy woła tę samą fabrykę co ręczny — jeden konstruktor, zero bliźniaków |
| 5 | `library.ts:163-177` `updateLibraryEntry` | `.update(patch)` verbatim, „last-write-wins" po 14 polach | **Usunięty z toru PUT/PATCH.** Zastąpiony przez `repo.load()` → metody domenowe → `repo.save()` |
| 6 | `validation/library.ts:44-45` | `igdb_id: z.number().nullable()`, `metadata_status: z.enum(…).nullable()` | **Oba pola usunięte ze schematu.** Klient nie ma jak ich przysłać; asercja `_assignable` (`:51`) celuje w nowy typ wejściowy agregatu |
| 7 | `[id].ts:96-102` (PUT) | `safeParse` → `updateLibraryEntry(…, parsed.data)` | `safeParse` → `repo.load` → 6 wywołań metod domenowych → `repo.save`; `catch` przez `toErrorResponse` |
| 8 | `[id].ts:145-151` (PATCH) | `patchEntrySchema` → `updateLibraryEntry` | `repo.load` → `setPlayStatus` / `recordPlayTime` → `repo.save` (schemat PATCH bez zmian — nie dotyka metadanych) |
| 9 | `identify.ts:191-195` | `createLibraryEntryFromGrounding(supabase, {title, platform, grounding})` | `LibraryEntry.create(…, grounding ? EntryMetadata.fromLookup(grounding) : EntryMetadata.unavailable(), today())` + `repo.insert()` |
| 10 | `identify.ts:208-210` | Druga kopia decyzji „co znaczy matched" w kształcie odpowiedzi | Czyta z zapisanego agregatu (`entry.provenance`), zero powtórzonej logiki |
| 11 | `GameDialog.tsx:293-303` `handleRefetch` | Klient ustawia `metadata_status:"matched"` + 7 pól | Woła `POST /api/library/{id}/refetch`; serwer robi `entry.applyLookup()`; klient wyświetla zwrócony wiersz |
| 12 | `GameDialog.tsx:95-96` `mapValuesToBody` | Zawsze dokleja `igdb_id` i `metadata_status` | Oba pola usunięte z body (naruszenia A/B/C/D z §3.4 znikają razem z nimi) |
| 13 | `GameFormFields.tsx:12-16` + `:29-30` | `GameFormValues` niesie `igdb_id`/`metadata_status` jako pola formularza z komentarzem-ostrzeżeniem | Pola usunięte z `GameFormValues`; badge czyta je z `entry`, nie z `values` |
| 14 | `library/index.astro:136-138`, `GameDialog.tsx:379-381` | Binarnie: `matched` albo „No metadata" | Trzy stany: bez badge (`matched`), „No metadata" (`no_match`), **„Edited by you"** (`user_edited`) — użytkownik widzi, że jego własna zmiana zdjęła pieczątkę IGDB |
| 15 | `recommendation.ts:73-80`, `:167-169` | Czyta `length_hours` bez pojęcia o pochodzeniu | **Bez zmian w tej fazie.** Silnik zostaje nietknięty; zmienia się tylko to, że kolumna, którą czyta, ma odtąd prawdziwą metrykę pochodzenia. Ewentualne wykorzystanie `provenance` w punktacji to osobna decyzja produktowa (patrz §5.5) |

### 5.2 Plan faz

Repo ma dyscyplinę test-first (`/10x-tdd`, `test-plan.md` §3 z pięcioma zamkniętymi fazami)
oraz komplet runnerów: `npm test` (Vitest, 12 plików / 238 testów), `npm run test:db`
(pgTAP, 18 asercji), `npm run test:e2e` (Playwright, 3 speci), `npm run test:mutation` (Stryker).

| Faza | Zakres | Test-first? | Gate |
|---|---|---|---|
| **0. Preflight** | Zapytanie diagnostyczne: ile wierszy łamie dziś N-05 (`matched` + `igdb_id is null`) i N-02 (`btrim(title)=''`). Bez zmian w kodzie. Wynik decyduje o backfillu w Fazie 4 | — | ręcznie, lokalnie |
| **1. Domena** | `src/lib/domain/{errors,entry-metadata,library-entry}.ts`. Zero I/O, zero Supabase, zero React | **TAK — czysto test-first.** Ten sam kształt co `recommend()`: czysta funkcja/klasa bez zegara i bez sieci, czyli najtańsza i najmocniejsza warstwa w tym repo | `npm test` + `npm run test:mutation --mutate "src/lib/domain/**"` (CLAUDE.md dopuszcza Stryker dla modułów krytycznych ryzykiem; N-05 nim jest) |
| **2. Repozytorium** | `src/lib/repositories/library-entry-repository.ts`; przepięcie obu torów tworzenia na `LibraryEntry.create` + `repo.insert`. **Kontrakt API bez zmian** | częściowo (testy kontraktu przed przepięciem) | `npm test` — istniejące suity `api/library/index.test.ts` i `api/identify.test.ts` muszą przejść **bez modyfikacji** |
| **3. Tor edycji** | `updateEntrySchema` traci `igdb_id`/`metadata_status`; PUT/PATCH przez agregat; nowa trasa `POST /api/library/{id}/refetch`; `GameDialog`/`GameFormFields` przestają nieść te pola | **TAK** — najpierw czerwone testy kontraktu trasy (wzorzec `test-plan.md` §6.4: bezpośrednie wywołanie handlera) | `npm test`; ręczna weryfikacja re-fetch w dialogu |
| **4. Baza** | Migracja z §4.7 (+ backfill wg Fazy 0), `npm run db:types`, `METADATA_STATUSES` +`user_edited`, trzeci badge | **TAK** — asercje pgTAP przed migracją | `npm run test:db` (wymaga `npx supabase start`); CI job `e2e` egzekwuje to blokująco |
| **5. Sprzątanie** | Usunięcie `createLibraryEntryFromGrounding` i `updateLibraryEntry`; `EntryNotFoundError` przenosi się do `domain/errors.ts`; `identify.ts:208-210` czyta z agregatu | nie (refactor pod zieloną tarczą) | `npm test`, `npm run typecheck`, `npm run lint` |
| **6. Poza zakresem, świadomie** | Optymistyczna blokada (`updated_at` + `.eq()` przy zapisie) na naruszenie C z §3.4 | — | — |

**Dlaczego Faza 6 jest poza zakresem.** Naruszenie C (nieświeża zakładka cofa wzbogacenie)
po Fazie 3 traci swój najgorszy skutek: klient przestaje wysyłać `igdb_id`/`metadata_status`,
więc stary snapshot nie może już nadpisać pochodzenia. Zostaje zwykłe „last-write-wins" na
polach, które użytkownik **widzi i świadomie edytuje** — to jest udokumentowana decyzja
(`library.ts:155-156`), nie luka niezmiennika. Blokada optymistyczna wymaga nowej kolumny,
migracji i zmiany kontraktu wszystkich trzech pisarzy; nie należy jej wciskać do tego refaktoru.

### 5.3 Przypadki testowe dla N-05

**Warstwa 1 — domena (Vitest, czyste, bez I/O). Faza 1, test-first.**

Operacje legalne:

| # | Scenariusz | Oczekiwanie |
|---|---|---|
| L-01 | `create` z `EntryMetadata.fromLookup({status:"matched", igdbId:7346, …})` | `provenance === "igdb_matched"`, `toRow().igdb_id === 7346`, `metadata_status === "matched"`, wszystkie 6 pól z lookupu |
| L-02 | `create` z `fromLookup({status:"no_match"})` | `metadata_status === "no_match"`, wszystkie 6 pól `null`, `igdb_id === null` |
| L-03 | `create` z `EntryMetadata.unavailable()` | jak L-02 (dzisiejsze zachowanie `library.ts:114-123` utrzymane), ale **przez inne wejście** — różnica jest nazwana w modelu |
| L-04 | `editMetadata({ lengthHours: 12 })` na wpisie `igdb_matched` (`igdbId: 7346`) | `provenance === "user_edited"`, `sourceIgdbId === 7346`, `toRow().igdb_id === 7346`, `metadata_status === "user_edited"`, `length_hours === 12` |
| L-05 | `editMetadata` patchem **identycznym** z bieżącymi polami | `provenance` bez zmian (`igdb_matched`) — zapis bez edycji nie degraduje pochodzenia |
| L-06 | `rename("Portal 2")` na wpisie `igdb_matched` o tytule „Portal" | `provenance === "user_edited"`, `sourceIgdbId` zachowany — **naruszenie B z §3.4 nie może się powtórzyć** |
| L-07 | `rename` na ten sam tytuł (whitespace/normalizacja) | `provenance` bez zmian |
| L-08 | `applyLookup({status:"matched", igdbId:1234, …})` na wpisie `user_edited` | `provenance === "igdb_matched"`, `igdbId === 1234`, pola nadpisane — re-fetch przywraca pieczątkę |
| L-09 | `applyLookup({status:"no_match"})` na wpisie `user_edited` | zwraca `"no_match"`, stan **bez zmian** (zachowanie `GameDialog.tsx:304-306`: „No match found — your values were kept") |
| L-10 | `editMetadata({ lengthHours: 12 })` na wpisie `igdb_no_match` | `provenance === "user_edited"`, `sourceIgdbId === null` |
| L-11 | `recordPlayTime(0)` / `recordPlayTime(null)` | przechodzi (`prd.md:70`: „non-negative integer; empty means unset") |
| L-12 | `setDateBought` z datą dzisiejszą i przeszłą | przechodzi |

Operacje nielegalne (każda **rzuca**, nie loguje-i-jedzie dalej):

| # | Scenariusz | Oczekiwany błąd |
|---|---|---|
| I-01 | `rename("   ")` | `InvalidEntryFieldError("title")` — stan agregatu **niezmieniony** po rzucie |
| I-02 | `changePlatform("")` | `InvalidEntryFieldError("platform")` |
| I-03 | `create` z pustym tytułem | `InvalidEntryFieldError` — wpis nie powstaje |
| I-04 | `recordPlayTime(-1)`, `recordPlayTime(2.5)` | `InvalidPlayTimeError` |
| I-05 | `editMetadata({ lengthHours: -3 })` | `InvalidEntryFieldError("length_hours")` |
| I-06 | `setDateBought(jutro)` | `FutureAcquisitionDateError` (domyka N-16) |
| I-07 | `rehydrate({ metadata_status:"matched", igdb_id:null, … })` | `MetadataProvenanceViolation` — **uszkodzony wiersz zatrzymuje operację**, nie wchodzi do rekomendera |
| I-08 | Próba skonstruowania `igdb_matched` bez `igdbId` | **błąd kompilacji**, nie test runtime — asercja typu w `entry-metadata.test-d.ts` |

**Warstwa 2 — kontrakt trasy (Vitest, bezpośrednie wywołanie handlera; wzorzec `test-plan.md` §6.4). Faza 3.**

| # | Scenariusz | Oczekiwanie |
|---|---|---|
| R-01 | `PUT` z body zawierającym `igdb_id` i `metadata_status` | **400** (nieznane pola odrzucone) albo pola zignorowane — do rozstrzygnięcia jedną decyzją; test pilnuje, że **nie trafiają do bazy** |
| R-02 | `PUT` zmieniający wyłącznie `length_hours` na wpisie `matched` | 200, zwrócony wiersz ma `metadata_status === "user_edited"`, `igdb_id` zachowany |
| R-03 | `PUT` bez żadnej zmiany | 200, `metadata_status` bez zmian |
| R-04 | `PUT` z pustym tytułem | 400, treść błędu bez szczegółów Postgresa |
| R-05 | `PUT` z `date_bought` w przyszłości | 422 |
| R-06 | `PUT`/`PATCH`/`DELETE` na cudzy/nieistniejący id | 404 (zachowanie `[id].ts:107`, `:156`, `:190` niezmienione) |
| R-07 | `POST /api/library/{id}/refetch`, IGDB odpowiada `matched` | 200, `metadata_status === "matched"`, `igdb_id` z lookupu |
| R-08 | `POST …/refetch`, IGDB niedostępne (rzut) | **502**, wiersz **niezmieniony** (N-06 utrzymane — „nie wiemy" ≠ „nie ma"; dziś `lookup.ts:242-249`) |
| R-09 | `POST /api/library` (tor ręczny), IGDB rzuca | 201, `metadata_status === "no_match"`, wpis zapisany (N-07 utrzymane — regresja tutaj złamałaby `prd.md:172`) |
| R-10 | `POST /api/identify` z `persist=true`, vision pewny, IGDB `no_match` | zapisany wpis `no_match` — zachowanie `identify.ts:183-213` **niezmienione** (napięcie FR-006 × US-01 jest osobną decyzją produktową, nie tym refaktorem) |

**Warstwa 3 — polityka bazy (pgTAP, `supabase/tests/database/`). Faza 4.**

| # | Scenariusz | Oczekiwanie |
|---|---|---|
| D-01 | `insert … (metadata_status:'matched', igdb_id:null)` jako `authenticated` | naruszenie `metadata_matched_requires_igdb_id` (23514) |
| D-02 | `update … set metadata_status='matched', igdb_id=null` | j.w. |
| D-03 | `insert … (metadata_status:'user_edited')` | przechodzi (nowa wartość w słowniku) |
| D-04 | `insert … (title:'   ')` | naruszenie `title_platform_not_blank` (domyka N-02) |
| D-05 | Wszystkie 18 istniejących asercji RLS | przechodzą bez zmian — refaktor **nie dotyka** N-01 |

**Czego świadomie NIE testujemy** (zgodnie z `test-plan.md` §1 „cost × signal"): nowego
e2e. Ryzyko N-05 jest w całości widoczne na warstwie domeny i kontraktu trasy; przeglądarka
nie dodaje tu sygnału, a jest najdroższą warstwą w repo (`test-plan.md` §4).

### 5.4 Nowe nazwy nośne (load-bearing) do zarejestrowania

Repo **nie prowadzi formalnego rejestru kontraktów**. Rolę rejestru pełnią dwa miejsca:
`CLAUDE.md` (§Key conventions) i `context/foundation/lessons.md` (append-only rejestr reguł).
Poniższe wpisy tam trafiają:

**Nowe pojęcia Ubiquitous Language** (do §1.1 w `01-domain-distillation.md`):

| Nazwa | Znaczenie | Dlaczego nośna |
|---|---|---|
| `EntryMetadata` | Obiekt wartości: sześć pól metadanych **plus** ich pochodzenie, jako jedna niepodzielna wartość | Nośnik N-05. Rozerwanie go = powrót do stanu sprzed refaktoru |
| `MetadataProvenance` | `igdb_matched` \| `igdb_no_match` \| `user_edited` | Trzeci stan jest jedynym sposobem, by FR-008 i FR-010 były jednocześnie prawdziwe |
| `user_edited` | Metadane dotknięte ręcznie; pieczątka IGDB zdjęta, `sourceIgdbId` zachowany | Wartość w bazie, w typie i w UI — zmiana jej znaczenia to zmiana kontraktu wszystkich trzech |
| `sourceIgdbId` | Identyfikator ostatniego udanego dopasowania, **niebędący** twierdzeniem o pochodzeniu bieżących pól | Nazwa jest ostrzeżeniem: to nie to samo co `igdbId` |
| `LibraryEntry` (agregat) | Korzeń agregatu — jedyne wejście do zapisywalnego stanu wiersza | Odtąd nie wolno pisać do `library_entries` z pominięciem tej klasy |
| `LibraryEntryRepository` | `load` / `insert` / `save`; jedyny wykonawca zapisu | j.w. |
| `MetadataLookupPort` | Port do IGDB, wołany **poza** agregatem | Wciągnięcie I/O do agregatu zabiłoby jego testowalność |
| `MetadataProvenanceViolation` | Wiersz w bazie łamiący N-05 wykryty przy odczycie | Fail-fast; jego wystąpienie w produkcji = ktoś ominął agregat |

**Nowe konwencje do `CLAUDE.md` §Key conventions:**

- „**Domain**: invariant-bearing types live in `src/lib/domain/`; `src/lib/services/` keeps
  I/O orchestration and read projections. Never write to `library_entries` outside
  `LibraryEntryRepository`."
- „**Provenance**: `metadata_status` and `igdb_id` are derived from `EntryMetadata`, never
  accepted from a client payload."

**Nowy wpis do `context/foundation/lessons.md`:**

- *„Flaga pochodzenia musi być wyprowadzana, nie przyjmowana"* — kontekst: `PUT /api/library/[id]`;
  problem: schemat brzegowy przyjmował `metadata_status` i `igdb_id` jako niezależne pola, więc
  jedynym strażnikiem sprzężenia był handler React; reguła: pole opisujące **pochodzenie** innych
  pól nigdy nie jest polem wejściowym API — jest funkcją stanu agregatu; dotyczy: plan, implement,
  impl-review, każda przyszła kolumna typu `*_status` / `*_source`.

### 5.5 Świadome nie-cele tego refaktoru

- **Rekomender zostaje nietknięty.** Rozjazdy N-14 (długość jako miękka kara) i N-15
  (`completed_100` wykluczane, nie de-priorytetyzowane) są **semantyczne** — naprawia się je
  decyzją produktową i aktualizacją PRD, nie agregatem. `01-domain-distillation.md` §KROK 4
  (R-01, R-02, R-03) już je wylicza.
- **Punktacja nie zaczyna czytać `provenance`.** Kuszące jest karanie w rankingu wpisów
  `user_edited`. To byłaby nowa reguła produktowa bez pokrycia w PRD — i wprost sprzeczna z
  intencją FR-010 (`prd.md:141`: użytkownik poprawia błędne rozpoznania). Refaktor daje tylko
  **prawdziwą metrykę**; co z nią zrobić, to osobna decyzja z osobnym oracle.
- **N-01 (izolacja) nie jest dublowana w agregacie.** Zostaje wyłącznie w RLS, zgodnie z
  ratyfikowaną decyzją (`test-plan.md:61`). Dodanie sprawdzenia własności w kodzie dałoby
  fałszywe poczucie drugiej warstwy, a testy stubowane „udowadniałyby" izolację tautologicznie —
  dokładnie ten antywzorzec, który `test-plan.md` §2 (wiersz Ryzyka #5) nazywa „worse than no test".
- **N-17 (potwierdzenie usunięcia) zostaje w UI.** To niezmiennik warstwy prezentacji; API nie ma
  sensownego sposobu, by go egzekwować, a próba (np. nagłówek `X-Confirmed`) byłaby teatrem.
