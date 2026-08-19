---
title: "Gaming Library — warstwa antykorupcyjna dla zewnętrznego katalogu gier (plan refaktoru)"
created: 2026-08-19
type: refactor-plan
---

# ACL: odcięcie IGDB od domeny, kontraktów wire i UI

Plan refaktoru, nie implementacja. **Żaden plik produkcyjny nie został zmieniony.**
Każdy cytat `plik:linia` został zweryfikowany odczytem pliku w tej sesji.

Dokumenty siostrzane:

- `context/domain/01-domain-distillation.md` — destylacja domeny, Ubiquitous Language,
  rejestr rozjazdów MODEL↔KOD (R-01…R-14).
- `context/domain/02-invariant-aggregate-refactor.md` — agregat-strażnik `LibraryEntry`
  + obiekt wartości `EntryMetadata` dla niezmiennika N-05 (pochodzenie metadanych).

Ten dokument domyka trzecią oś tej samej analizy. Doc 01 wskazał, **czym** jest problem
(R-05, R-13, R-14, kandydat `PlatformVocabulary` z §E), doc 02 zaprojektował, **kto pilnuje
stanu** — i w §4.3 zostawił jawny haczyk: *„Lookup jest **portem poza agregatem**
(`MetadataLookupPort`)"*. Tutaj ten port zostaje zaprojektowany, a razem z nim adapter,
który jako **jedyny** w repo wie, że katalogiem gier jest IGDB.

---

## KROK 0 — Kontekst

### Dokumenty bazowe (znalezione i przeczytane)

| Dokument | Ścieżka | Co z niego bierzemy |
|---|---|---|
| PRD | `context/foundation/prd.md` (206 linii) | **§Open Questions `:205`** — jedyna w repo jawna deklaracja wymienialności komponentu; FR-005/FR-008, NFR |
| Tech stack | `context/foundation/tech-stack.md` | Uzasadnienie startera i stacku; `has_ai: true` (tor vision) |
| Roadmapa | `context/foundation/roadmap.md` | Narracja F-01…F-03, S-01…S-09, H-01…H-05 |
| Test plan | `context/foundation/test-plan.md` (1128 linii) | Mapa ryzyk, stan warstw testowych, gate'y CI |
| README / CLAUDE.md | korzeń repo | Warstwy, komendy, konwencje, ścieżka deployu |
| Archiwum F-02 | `context/archive/2026-06-07-igdb-metadata-enrichment/` | `external-research.md` (wybór biblioteki + spike workerd), `library-reference.md` (kontrakt wrappera), `plan.md` |

**Deklaracja wymienialności — cytat rozstrzygający dla KROKU 2:**

> `prd.md:205` — *„**External game-metadata source — final selection.** The input notes name IGDB
> (igdb.com) as the data source; the user has clearly committed to it as the v1 target. **The PRD
> describes this dependency abstractly as »external metadata source« because the specific provider
> is a stack-shaped concern.** Forward to the tech-stack-selection step; the only PRD-level
> requirement is that the chosen source supplies genre, overall game length, release year,
> developer, and release date for the titles in the user's library, and supports lookup by title +
> platform."*

PRD konsekwentnie utrzymuje tę abstrakcję we wszystkich wymaganiach funkcjonalnych:
`prd.md:81` („from the external metadata source"), `prd.md:164` (FR-018, „release-date recency
from the external metadata source"). Nazwa „IGDB" pada w PRD **wyłącznie** w komentarzu
uzasadniającym decyzję o kubełkach długości (`prd.md:161`) i w tym jednym punkcie Open
Questions — nigdy w treści wymagania.

To jest deklarowana intencja: **dostawca metadanych jest szczegółem stacku, nie pojęciem domeny.**
Kod tej deklaracji nie dotrzymuje — dowód w KROKU 3.

### Stack i warstwy

Astro 6 SSR (`output: "server"`) + React 19 (wyspy) + Supabase (Postgres/Auth/RLS) +
Cloudflare Workers (workerd). Warstwy, w których dziś żyje logika:

| Warstwa | Katalog | Uwagi |
|---|---|---|
| Baza | `supabase/migrations/` | RLS + CHECK-i; `library_entries` to jedyna tabela domenowa |
| Typy generowane | `src/db/database.types.ts` | `npm run db:types` |
| Kontrakty współdzielone | `src/types.ts` | Encje, DTO, unie wynikowe |
| Walidacja brzegowa | `src/lib/validation/` | zod |
| Serwisy | `src/lib/services/` | I/O + logika wydobyta z tras |
| Trasy API | `src/pages/api/` | `prerender = false`, zod na wejściu |
| Strony SSR | `src/pages/**/*.astro` | Czytają serwisy we frontmatterze |
| Wyspy React | `src/components/` | Tylko interaktywność |
| Narzędzia dev | `scripts/` | Node ESM, **poza systemem typów TS** |

**Nie ma dziś warstwy `src/lib/domain/`.** Doc 02 ją wprowadza; ten plan dokłada do niej
porty, a adaptery umieszcza w osobnym katalogu.

### Zależności zewnętrzne (manifest `package.json`)

Runtime, po odrzuceniu narzędzi buildu i UI-kitu:

| Pakiet | Rola | Gdzie żyje |
|---|---|---|
| `@api-wrappers/igdb-wrapper@^1.0.1` | Klient katalogu gier IGDB | serwis + testy + (pośrednio) DTO, API, UI, baza, tooling |
| `@supabase/supabase-js@^2.99` + `@supabase/ssr@^0.10` | Postgres + Auth + RLS | `lib/supabase.ts`, 2 serwisy, middleware, 6 tras, 2 strony |
| `@sentry/cloudflare@^10.68` | Telemetria błędów | `lib/logger.ts` + `sentry.server.config.ts` |
| `zod@^4.4` | Walidacja brzegowa | 5 modułów |
| `astro`, `@astrojs/cloudflare`, `react`, `radix-ui`, `lucide-react`, `cmdk`, `tailwindcss` | Framework / UI | warstwa prezentacji |

Dwie zależności **bez wpisu w manifeście**, ale zewnętrzne wobec domeny i istotne dla tej analizy:

- **OpenRouter / Gemini Flash** — surowy `fetch` do `https://openrouter.ai/api/v1/chat/completions`
  (`src/lib/services/vision.ts:18`, `:22`).
- **Cloudflare KV + `cloudflare:workers`** — binding `IGDB_TOKENS` (`wrangler.jsonc:29`),
  odczytywany bezpośrednio w trasach API.

---

## KROK 1 — Zidentyfikowane przecieki

Kryterium: zależność **przecieka**, gdy jej nazwa, typ, format danych albo protokół są znane
w więcej niż jednej warstwie — a szczególnie gdy trafiają do kontraktu wire (DTO/response),
do sygnatur domenowych albo do schematu bazy.

### P-1. IGDB — katalog gier (`@api-wrappers/igdb-wrapper` + Twitch OAuth + KV)

Wszystkie pliki produkcyjne, które **dziś** wiedzą o IGDB:

| # | Plik | Co dokładnie wie | Cytat |
|---|---|---|---|
| 1 | `src/lib/services/igdb.ts` | Import pakietu, typ `Game`, `IGDBClient`, sekrety Twitcha, składnia apicalypse, mapa id platform, kolejność dwóch zapytań | `:1`, `:2`, `:21`, `:31-35`, `:62-102`, `:444-499`, `:522-527` |
| 2 | `src/lib/services/igdb-token-cache.ts` | Endpoint OAuth Twitcha, kształt odpowiedzi tokenowej, TTL, klucz KV | `:19`, `:20`, `:33-37`, `:39-44` |
| 3 | `src/types.ts` | **Typ wire** `IgdbLookupResult` z polem `igdbId`; `IdentifyResponse.igdbId` | `:187-199`, `:224-235` |
| 4 | `src/lib/services/library.ts` | `IgdbLookupResult` w 4 sygnaturach; mapowanie na kolumnę `igdb_id` | `:4`, `:65`, `:97`, `:104`, `:138` |
| 5 | `src/lib/validation/library.ts` | `igdb_id` jako **przyjmowane pole wejściowe API** | `:12`, `:44` |
| 6 | `src/lib/platforms.ts` | Słownik aliasów zbudowany „pod" mapę id IGDB; własna kopia normalizatora | `:6-8`, `:10-12`, `:32-33`, `:40-45` |
| 7 | `src/pages/api/library/lookup.ts` | `IgdbLookupResult` w ciele odpowiedzi; `env.IGDB_TOKENS` | `:3`, `:43`, `:45`, `:54` |
| 8 | `src/pages/api/library/index.ts` | `env.IGDB_TOKENS` przekazywane do serwisu | `:2`, `:50` |
| 9 | `src/pages/api/identify.ts` | `IgdbLookupResult` ×2, `env.IGDB_TOKENS` ×2, `igdbId` w trzech odpowiedziach | `:9`, `:103`, `:105`, `:114`, `:169`, `:171`, `:208`, `:228` |
| 10 | `src/components/library/GameDialog.tsx` | **Wyspa React** czyta `IgdbLookupResult` i `result.igdbId`, sama ustawia `metadata_status:"matched"` | `:3`, `:291`, `:295-303`, `:95` |
| 11 | `src/components/library/GameFormFields.tsx` | `igdb_id` jako pole formularza | `:14`, `:29` |
| 12 | `src/db/database.types.ts` | Kolumna `igdb_id` (plik generowany) | `:44`, `:62`, `:80` |
| 13 | `src/env.d.ts` | Komentarz o bindingu `IGDB_TOKENS` | `:1` |
| 14 | `supabase/migrations/20260606150950_create_library_entries.sql` | `igdb_id bigint` — **nazwa dostawcy w schemacie bazy** | `:21` |
| 15 | `astro.config.mjs` | Sekrety `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | `:55-56` |
| 16 | `wrangler.jsonc` | Binding KV o nazwie `IGDB_TOKENS` | `:29` |
| 17 | `.dev.vars.example` | Te same sekrety | `:3-4` |
| 18 | `scripts/identify-harness.mjs` | **Ręczna kopia** mapy id platform + normalizatora + `platformsOverlap`, poza systemem typów | `:38-115` |

Plus warstwa testowa (9 plików): `src/lib/services/igdb.test.ts:1`,
`igdb.integration.test.ts:1`, `src/pages/api/identify.test.ts:1`, `:25`,
`src/pages/api/library/index.test.ts:1`, `:41`, `lookup.test.ts:1`, `:27`,
`src/lib/services/library.test.ts:10`, `test/helpers/fetch-mock.ts:17`,
`test/stubs/astro-env-server.ts:17-18`, `test/setup/no-network.ts:9`.

**Komplet sygnałów przecieku jest obecny:** ten sam pakiet znany w warstwie serwisu, tras,
kontraktu wire i (typowo) UI; ta sama wiedza zrekonstruowana w czterech miejscach; typ
biblioteki (`Game`) w **eksportowanych** sygnaturach (`igdb.ts:272-280`, `:314`, `:403`);
nazwa dostawcy w schemacie bazy i w nazwie bindingu infrastruktury.

### P-2. Supabase — Postgres + Auth + RLS

| Miejsce | Cytat |
|---|---|
| Fabryka klienta SSR | `src/lib/supabase.ts:1`, `:6` |
| `SupabaseClient<Database>` w 13 sygnaturach serwisów | `library.ts:1`, `:37`, `:56`, `:137`, `:164`, `:186`, `:238`, `:343`, `:362`, `:381`; `recommendation.ts:1`, `:214`, `:221` |
| Typ `User` w globalnym `App.Locals` | `src/env.d.ts:7` |
| `createClient` w middleware, 6 trasach i 2 stronach | `middleware.ts:7`, `auth/signin.ts:28`, `auth/signout.ts:5`, `auth/signup.ts:9`, `api/identify.ts:184`, `api/library/index.ts:28`, `api/library/[id].ts:16`, `:65`, `:112`, `library/index.astro:47`, `play-next/index.astro:24` |
| Kod błędu PostgREST w logice domenowej | `library.ts:171` (`PGRST116` → `EntryNotFoundError`) |

### P-3. OpenRouter / model wizyjny

| Miejsce | Cytat |
|---|---|
| Endpoint, slug modelu, koperta odpowiedzi, `response_format` | `src/lib/services/vision.ts:18`, `:22`, `:39-41`, `:44-60` |
| Sekret | `vision.ts:1`, `:166-168` |
| Import konkretnej funkcji (nie portu) w trasie | `src/pages/api/identify.ts:8`, `:151` |

Poza tymi punktami — **nic**. Wynik jest już oddany jako domenowa unia `VisionIdentifyResult`
(`types.ts:211-213`), a normalizacja odbywa się w jednym punkcie (`vision.ts:221-226`).

### P-4. Sentry

`src/lib/logger.ts:34` (jedyny punkt zaczepienia w kodzie aplikacji) + `sentry.server.config.ts:22`
(granica runtime, wymagana przez `@sentry/cloudflare`). Reszta repo woła `logError(...)`.

### P-5. Cloudflare (`cloudflare:workers` + KV)

| Miejsce | Cytat |
|---|---|
| `import { env } from "cloudflare:workers"` w trasach API | `api/identify.ts:2`, `api/library/index.ts:2`, `api/library/lookup.ts:2` |
| `KVNamespace` w sygnaturach serwisów | `igdb.ts:21`, `:437`; `library.ts:57`; `igdb-token-cache.ts:59` |

Ten przeciek **jedzie na barana** na P-1: `KVNamespace` jest w tych sygnaturach wyłącznie
dlatego, że wrapper IGDB nie ma hooka na token store (`external-research.md:184-185`).

### P-6. React / Radix / lucide / Tailwind / zod

Zamknięte w warstwie prezentacji (`src/components/**`) lub w warstwie walidacji brzegowej.
Żaden typ tych bibliotek nie występuje w sygnaturze serwisu ani w kontrakcie wire.
**Nie są kandydatem.**

---

## KROK 2 — Klasyfikacja i wybór #1

| # | Zależność | (a) Warstwy / pliki | (b) Ryzyko i koszt wymiany dziś | (c) Deklaracja wymienialności w dokumentach | Ocena |
|---|---|---|---|---|---|
| **P-1** | **IGDB** | **7 warstw** (baza → typy generowane → serwis → kontrakt wire → API ×3 → UI ×2 → tooling dev → konfiguracja), **18 plików produkcyjnych** + 9 testowych | **Najwyższe.** Biblioteka opisana we własnym researchu jako *„⚠️ Very new (Mar 2026, ~2 stars) … Feature-complete but **unproven**"* (`external-research.md:29`); wersja `1.0.1`. Dostawca jest z kolei zależny od Twitcha (OAuth, limit 25 aktywnych tokenów — `igdb-token-cache.ts:5`) | **TAK, wprost** — `prd.md:205`; abstrakcja utrzymana w FR (`prd.md:81`, `:164`) | **#1** |
| P-2 | Supabase | 5 warstw, 13 plików | Wysokie, ale **wymiana to nie podmiana biblioteki, tylko zmiana architektury**: Postgres + RLS niesie niezmiennik N-01 (`prd.md:171`, `test-plan.md:61`, 18 asercji pgTAP) | **NIE.** `tech-stack.md` wybiera Supabase jako *„three pre-wired concerns the budget can't afford to assemble by hand"* — commitment, nie abstrakcja | świadomie pominięte (§KROK 6, nie-cele) |
| P-3 | OpenRouter | 1 plik + 1 import w trasie | Realne (slug modelu — *„Confirm the live slug … before changing (the listing moves)"*, `vision.ts:20-21`), ale **już w dużej mierze zaadresowane** | Pośrednio: `tech-stack.md` mówi tylko o „external vision provider" | #2 — ta sama forma portu, **znacznie tańsza**; dołącza do wzorca z #1 |
| P-4 | Sentry | 1 plik + config | Niskie; `logger.ts` jest już ACL-em de facto | — | nie ruszać |
| P-5 | Cloudflare KV | 3 trasy + 4 sygnatury | Średnie, ale **wtórne** wobec #1 | — | znika przy okazji #1 |
| P-6 | React / Radix / zod | 1 warstwa | Nieistotne | — | nie kandydat |

### Wybór: **P-1 — zewnętrzny katalog gier (dziś: IGDB)**

Cztery powody, każdy z dowodem:

1. **Rozjazd intencja↔kod jest największy i jako jedyny w repo jawnie spisany.** PRD osobno
   tłumaczy, *dlaczego* nie nazywa dostawcy (`prd.md:205`), a kod umieszcza jego nazwę
   w **kolumnie bazy** (`…create_library_entries.sql:21`), w **typie wire** (`types.ts:187`,
   `:230`), w **schemacie walidacji przyjmującym dane od klienta** (`validation/library.ts:44`),
   w **wyspie React** (`GameDialog.tsx:301`) i w **nazwie bindingu infrastruktury**
   (`wrangler.jsonc:29`). Żadna inna zależność nie ma pisemnej deklaracji, którą kod łamie.

2. **Ryzyko wymiany jest realne, nie hipotetyczne.** Repo samo udokumentowało, że wybrało
   bibliotekę dwumiesięczną, z ~2 gwiazdkami, „feature-complete but unproven"
   (`external-research.md:29`), świadomie przedkładając DX nad dojrzałość
   (`external-research.md:35-37`). Alternatywy zostały wypisane w tym samym pliku
   (`igdb-api-node` — twitchtv, MIT, dojrzała; `igdb-api-types` + raw `fetch` —
   `external-research.md:30-31`). Plan awaryjny istniał na papierze i **nie ma dziś szwu,
   przez który dałoby się go wykonać.**

3. **Blast radius wymiany wykracza poza kod, który o IGDB „wie" świadomie.** Dziś podmiana
   dostawcy wymusiłaby zmianę **kontraktu HTTP** (`{ result: IgdbLookupResult }` —
   `lookup.ts:54`; `igdbId` w `IdentifyResponse` — `types.ts:230`), a więc również wyspy React
   (`GameDialog.tsx:291-303`) i harnessu pomiarowego (`identify-harness.mjs:220`, `:294`) —
   mimo że użytkownik nie zobaczyłby żadnej różnicy funkcjonalnej.

4. **Ta sama zmiana likwiduje najgorszą duplikację w repo.** Pojęcie „platforma" ma dziś
   **cztery** niezależne reprezentacje (doc 01 §E, R-14), z których jedna leży **poza systemem
   typów** (`scripts/identify-harness.mjs:42`) i jest broniona wyłącznie komentarzem
   (`igdb.ts:59-61`). Trzy z nich istnieją dlatego, że wewnętrzną tożsamością konsoli jest dziś
   **numeryczne id IGDB**, a nie wartość domenowa.

---

## KROK 3 — Diagnoza

### 3.1 Duplikacja #1: pojęcie „platforma" w czterech reprezentacjach

| Repr. | Miejsce | Klucz | Wartość | Kto używa |
|---|---|---|---|---|
| A | `KNOWN_PLATFORMS` — `platforms.ts:14-29` | — | 14 etykiet display | picklista comboboxa (`library/index.astro:9`) |
| B | `PLATFORM_DISPLAY_BY_ALIAS` — `platforms.ts:50-87` (37 wpisów) | alias znormalizowany | etykieta kanoniczna | `normalizePlatformLabel` → **tylko tor zdjęciowy** (`vision.ts:150`, `:224`) |
| C | `PLATFORM_IDS_BY_NAME` — `igdb.ts:62-102` (35 wpisów) | ten sam alias | **id IGDB** | filtr zapytania (`igdb.ts:496`), veto dopasowania (`igdb.ts:412-419`), collapse (`igdb.ts:292`) |
| D | Ręczna kopia C — `identify-harness.mjs:42-83` | ten sam alias | te same id | scoring harnessu (`identify-harness.mjs:104-115`) |

Do tego **dwie kopie tego samego normalizatora**, różniące się wyłącznie nazwą:

```
igdb.ts:105-107        function normalizePlatform(platform: string): string {
                         return platform.trim().toLowerCase().replace(/\s+/g, " ");
                       }

platforms.ts:34-36     function normalizePlatformKey(raw: string): string {
                         return raw.trim().toLowerCase().replace(/\s+/g, " ");
                       }

identify-harness.mjs:85-87   function normalizePlatform(platform) {
                               return platform.trim().toLowerCase().replace(/\s+/g, " ");
                             }
```

…i **dwie kopie `resolvePlatformIds` / `platformsOverlap`** (`igdb.ts:124-135`, `:143-151`
wobec `identify-harness.mjs:89-115`).

Kod wie, że to problem, i broni się komentarzem:

> `igdb.ts:59-61` — *„DUPLICATED: the F-03 accuracy harness (scripts/identify-harness.mjs) keeps
> a hand-copy of this map because it's plain .mjs dev tooling and can't import this TS module.
> If you grow this map, mirror the change there too — **otherwise harness scoring drifts silently
> from real grounding**."*

> `platforms.ts:32-33` — *„Mirrors `normalizePlatform` in `services/igdb.ts` so the two maps key
> identically — **kept local to avoid an `igdb` import in this picklist module**."*

Drugi cytat jest najciekawszy: autor **rozpoznał granicę** („nie chcę importu igdb w module
picklisty") i rozwiązał ją **kopiowaniem**, bo nie było warstwy, do której mógłby ten kod
przenieść. To jest definicja brakującego obiektu wartości.

Skutek dla użytkownika jest już udokumentowany jako rozjazd R-13 (doc 01): tor zdjęciowy
normalizuje etykietę (`vision.ts:224`), tor ręczny nie (`api/library/index.ts:15-18` —
zod tylko `trim()`), a filtr fasety porównuje dokładnym `.in()` (`library.ts:273`).
„PS5" i „PlayStation 5" to dwie fasety i dwa filtry.

### 3.2 Duplikacja #2: „skąd te metadane" rekonstruowane w trzech miejscach

Ta sama decyzja — *matched czy nie, i co z tego wynika dla ośmiu kolumn* — jest podejmowana
niezależnie w trzech warstwach:

| Miejsce | Kod | Warstwa |
|---|---|---|
| `library.ts:96-124` `metadataFromGrounding` | `grounding?.status === "matched" ? {igdb_id: grounding.igdbId, …} : {…nulls, metadata_status:"no_match"}` | serwis |
| `identify.ts:208-210`, `:228-230` | `igdbId: grounding?.status === "matched" ? grounding.igdbId : null` (×3 wystąpienia) | trasa API |
| `GameDialog.tsx:295-303` | `if (result?.status === "matched") patchValues({ …, igdb_id: result.igdbId, metadata_status: "matched" })` | **wyspa React** |

Doc 02 §3.4 rozbiera to od strony niezmiennika N-05. Tutaj liczy się inny wniosek:
**trzecia kopia mieszka w przeglądarce** i to ona decyduje o wartości kolumny `metadata_status`.

### 3.3 Przecieki przez granice — warstwa po warstwie

**Granica 1 — biblioteka → sygnatura publiczna serwisu.** Typ `Game` wrappera występuje
w **eksportowanych** sygnaturach modułu:

```
igdb.ts:272-280   export interface CollapseResult { base: Game; collapsedFrom: number | null }
igdb.ts:314       export function collapseToBaseGame(candidates: Game[], query: {…}): CollapseResult
igdb.ts:403       export function isConfidentMatch(base: Game, query: {…}): boolean
```

Te trzy funkcje niosą **najcenniejszą wiedzę domenową w repo** — normalizację tytułu bazowego,
rozpoznawanie edycji, próg podobieństwa nazw dostrojony do zbioru prawdy F-03
(`igdb.ts:334-348`). Doc 01 nazwał to R-05: *„~140 linii dedykowanej wiedzy o edycjach …
najbogatszy model domenowy w repo — którego PRD w ogóle nie zna."* Dziś ta wiedza jest
**zaadresowana typem biblioteki**, więc zginęłaby razem z wymianą dostawcy.

**Granica 2 — biblioteka → kontrakt wire.** Trasa oddaje surową unię lookupu na zewnątrz:

```
lookup.ts:43       let result: IgdbLookupResult;
lookup.ts:54       return Response.json({ result }, { status: 200 });
types.ts:187-199   export type IgdbLookupResult = { status:"matched"; igdbId:number; … } | { status:"no_match" }
types.ts:230       igdbId: number | null;      // w IdentifyResponse
```

Nazwa dostawcy jest **częścią publicznego kontraktu HTTP**. Każdy klient tego API — wyspa
React, harness, przyszły klient mobilny — musi ją znać.

**Granica 3 — kontrakt wire → UI.** Wyspa React konsumuje ten kształt i sama pisze pochodzenie:

```
GameDialog.tsx:291   const data = (await response.json()…) as { result?: IgdbLookupResult } | null;
GameDialog.tsx:301          igdb_id: result.igdbId,
GameDialog.tsx:302          metadata_status: "matched",
GameDialog.tsx:95    igdb_id: values.igdb_id,       // w każdym PUT
GameFormFields.tsx:29   igdb_id: number | null;     // pole formularza
```

**Granica 4 — walidacja brzegowa przyjmuje pole dostawcy od klienta.**

```
validation/library.ts:44   igdb_id: z.number().nullable(),
```

To jest jednocześnie luka niezmiennika (doc 02 §3.4) i przeciek nazwy: schemat wejściowy API
jest napisany w słowniku konkretnego dostawcy.

**Granica 5 — infrastruktura → trasy API.** Ponieważ port nie istnieje, każda trasa musi znać
binding KV, którego istnienie wynika wyłącznie z braku hooka na token store w wrapperze:

```
lookup.ts:45     lookupGameMetadata(parsed.data.title, parsed.data.platform, env.IGDB_TOKENS)
index.ts:50      createLibraryEntry(supabase, env.IGDB_TOKENS, parsed.data)
identify.ts:105  lookupGameMetadata(query.data.title, query.data.platform, env.IGDB_TOKENS)
identify.ts:171  lookupGameMetadata(vision.title, vision.platform, env.IGDB_TOKENS)
```

**Granica 6 — nazwa dostawcy w schemacie bazy.**

```
…create_library_entries.sql:21   igdb_id bigint,
database.types.ts:44/62/80       igdb_id: number | null      (plik generowany — dziedziczy nazwę)
```

**Granica 7 — poza systemem typów.** `scripts/identify-harness.mjs:38-115` — kopia mapy,
normalizatora i porównania platform, utrzymywana ręcznie. Harness mierzy guardrail FR-005
(≥ 90%, `prd.md:43`), więc jego dryf od realnego groundingu **fałszuje warunek shipowalności**
(doc 01 R-12).

### 3.4 Weryfikacja negatywna: czy biblioteka serwerowa trafia do bundla klienta?

**Nie.** Sprawdzone, bo to najgroźniejsza klasa przecieku i nie chcę jej przypisywać temu
kodowi bez dowodu:

- `GameDialog.tsx:3` importuje `IgdbLookupResult` przez `import type` — kasowane przy
  transpilacji, zero bajtów w bundlu.
- `src/lib/platforms.ts` (jedyny moduł „platformowy" z runtime'owymi danymi) jest importowany
  wyłącznie przez `vision.ts:3` (serwer) i `library/index.astro:9` (frontmatter SSR).
  Żaden komponent klienta go nie importuje — `KNOWN_PLATFORMS` dociera do wyspy jako **prop**.
- `@api-wrappers/igdb-wrapper` nie występuje w żadnym pliku `.tsx`.

Przeciek jest więc **na poziomie słownika i kontraktu**, nie bajtów. To nie czyni go mniej
kosztownym — zmiana kontraktu wire jest droższa niż zmiana importu — ale diagnoza musi
być dokładna.

### 3.5 Podsumowanie diagnozy

| Objaw | Dowód | Konsekwencja przy wymianie dostawcy |
|---|---|---|
| Nazwa dostawcy w kontrakcie HTTP | `lookup.ts:54`, `types.ts:187`, `:230` | Zmiana kontraktu publicznego → zmiana klienta i harnessu |
| Nazwa dostawcy w schemacie walidacji wejścia | `validation/library.ts:44` | Klient musi znać dostawcę, żeby zapisać wpis |
| Typ biblioteki w sygnaturach niosących wiedzę domenową | `igdb.ts:314`, `:403` | Wiedza o edycjach i progach pewności ginie razem z wrapperem |
| Tożsamość konsoli = id IGDB | `igdb.ts:62-102` + 3 kopie pochodne | Nowy dostawca = nowy zestaw id = przepisanie czterech map |
| Binding KV w sygnaturach i w trasach | `igdb.ts:437`, `library.ts:57`, 4 wywołania | Obejście specyficzne dla wrappera stało się kształtem API serwisu |
| Nazwa dostawcy w kolumnie bazy | `…create_library_entries.sql:21` | Kosmetyczne, ale kłamie o pochodzeniu danych |
| Wiedza skopiowana poza system typów | `identify-harness.mjs:38-115` | Dryf metryki guardrailu FR-005 bez żadnego sygnału |

---

## KROK 4 — Projekt warstwy antykorupcyjnej

### 4.1 Zasada projektowa i linia cięcia

Domena mówi o **katalogu gier**, nie o IGDB. Adapter tłumaczy jeden na drugi i jest jedynym
miejscem, które zna jakąkolwiek nazwę dostawcy.

Linia cięcia nie biegnie „wszystko o grach do domeny, wszystko o HTTP do adaptera" — biegnie
przez rozróżnienie **wiedza o grach** vs **wiedza o dostawcy**:

| Zostaje w domenie (przeżywa wymianę) | Idzie do adaptera (ginie z dostawcą) |
|---|---|
| Czym jest platforma i kiedy dwa napisy znaczą tę samą konsolę | Jakie id ma ta konsola w IGDB |
| Czym jest „edycja" gry i jak wygląda tytuł bazowy (`EDITION_TOKENS`, `PUBLISHER_PREFIXES`, `normalizeBaseTitle` — `igdb.ts:199-254`) | Że IGDB wyraża relację edycja→baza polami `version_parent` / `parent_game` (`igdb.ts:257-259`, `:314-330`) |
| Polityka pewności dopasowania: progi podobieństwa, veto platformowe, próg popularności (`igdb.ts:334-348`, `:403-424`) | Że sygnałem popularności są `total_rating_count` / `follows`, a alternatywne tytuły siedzą w `alternative_names` (`igdb.ts:369`, `:380`) |
| Że długość gry jest w **godzinach** | Że IGDB podaje ją w sekundach, w polu `normally` osobnego endpointu (`igdb.ts:163-168`, `:522-527`) |
| Że data wydania to `YYYY-MM-DD` | Że IGDB trzyma daty jako epoch-sekundy (`igdb.ts:170-173`) |
| Że wpis może wskazywać na rekord w katalogu | Że ten rekord ma numeryczne id i nazywa się `igdb_id` |

To jest najważniejsza decyzja tego planu: **wymiana dostawcy nie może kosztować utraty
~140 linii wiedzy o edycjach i dostrojonych progów pewności**, bo tego dorobku nie da się
odtworzyć bez powtórzenia całego spike'u F-03.

### 4.2 Struktura katalogów po refaktorze

```
src/lib/domain/                       ← czyste, zero I/O, zero nazw dostawców
  platform.ts                         ← obiekt wartości Platform (+ vocabulary)
  platform-vocabulary.json            ← JEDYNE źródło słownika aliasów (czytane też przez .mjs)
  game-title.ts                       ← normalizeBaseTitle, podobieństwo tokenowe
  match-confidence.ts                 ← polityka pewności nad kandydatem neutralnym
  catalog-ref.ts                      ← obiekt wartości CatalogRef
  entry-metadata.ts                   ← z doc 02 (EntryMetadata / MetadataFields)
  library-entry.ts                    ← z doc 02 (agregat)
  errors.ts                           ← z doc 02
  ports/
    game-catalog.ts                   ← PORT: GameCatalogPort + typy portu
    photo-identifier.ts               ← PORT (#2, tor vision)

src/lib/adapters/igdb/                ← JEDYNE miejsce w repo znające IGDB
  index.ts                            ← createIgdbGameCatalog(deps): GameCatalogPort
  igdb-client.ts                      ← IGDBClient, sekrety Twitcha, zapytania apicalypse
  igdb-token-cache.ts                 ← (przeniesione bez zmian z services/)
  igdb-platform-ids.ts                ← etykieta kanoniczna → id IGDB
  igdb-candidate-mapper.ts            ← Game → MatchCandidate / CatalogGame (projekcja)
  igdb-edition-collapse.ts            ← collapse po relacjach version_parent / parent_game

src/lib/container.ts                  ← kompozycja: która implementacja portu jest wpięta
```

### 4.3 Obiekt wartości `Platform` — jedyne miejsce wiedzy o tożsamości konsoli

`src/lib/domain/platform.ts` (nowy plik). Zastępuje reprezentacje A i B z §3.1 i odbiera
reprezentacjom C i D status źródła prawdy.

```ts
/**
 * Tożsamość konsoli w domenie. Wartość, nie napis: dwa różne zapisy tej samej konsoli
 * są równe, a etykieta kanoniczna jest jedyną formą, jaka trafia do bazy i do UI.
 */
export class Platform {
  private constructor(readonly label: string) {}       // np. "PlayStation 5"

  /** Wolny tekst → platforma. Nierozpoznany napis zostaje sobą (Evercade, nowa konsola). */
  static parse(raw: string): Platform;
     // precondition: raw.trim() !== "" else InvalidEntryFieldError("platform")

  /**
   * Jeden napis może nazywać kilka konsol ("Xbox Series X • Xbox One", "PSP (PlayStation
   * Portable)"). Rozdziela po separatorach i nawiasach — logika dziś w igdb.ts:113, :129-134.
   */
  static parseAll(raw: string): Platform[];

  /** Czy dwa wolne teksty mówią o tej samej konsoli. Dziś: platformsOverlap (igdb.ts:143). */
  static overlap(a: string, b: string): boolean;

  equals(other: Platform): boolean;
  toString(): string;                                   // === label
}

/** Picklista dla comboboxa. Dziś: KNOWN_PLATFORMS (platforms.ts:14). */
export const PLATFORM_PICKLIST: readonly Platform[];
```

**Słownik jako dane, nie jako kod.** `src/lib/domain/platform-vocabulary.json`:

```json
{
  "picklist": ["Xbox Series X", "PlayStation 5", "…"],
  "aliases": { "ps5": "PlayStation 5", "playstation 5": "PlayStation 5", "…": "…" }
}
```

Ten jeden plik czytają **oba** światy: moduł TS (`import vocabulary from "./platform-vocabulary.json"`)
oraz harness w czystym Node ESM (`readFile` albo import z atrybutem typu — Node 22, `.nvmrc`).
Reprezentacja D (`identify-harness.mjs:42-83`) znika, a komentarz-ostrzeżenie z `igdb.ts:59-61`
przestaje być potrzebny, bo **nie ma już czego synchronizować**.

**Zmiana waluty tożsamości.** Harness porównuje dziś platformy przez **id IGDB**
(`identify-harness.mjs:104-115`). Po refaktorze porównuje przez `Platform.overlap` —
algorytm identyczny (zbiór ↔ zbiór, przecięcie niepuste), tylko elementami zbioru są
etykiety kanoniczne zamiast liczb dostawcy. Harness przestaje wiedzieć, że IGDB istnieje.

### 4.4 Port — wąski interfejs domenowy

`src/lib/domain/ports/game-catalog.ts` (nowy plik). Cały kontrakt to **jedna metoda**.

```ts
/** Zapytanie do katalogu. Wyłącznie wartości domenowe — żadnego KVNamespace, żadnych id. */
export interface GameQuery {
  readonly title: string;
  readonly platform: Platform;
}

/** Sześć pól, których żąda prd.md:205. Kształt współdzielony z EntryMetadata (doc 02 §4.2). */
export interface CatalogMetadata {
  readonly genre: string[];
  readonly developer: string[];
  readonly series: string[];
  readonly releaseYear: number | null;
  readonly releaseDate: string | null;   // YYYY-MM-DD
  readonly lengthHours: number | null;   // GODZINY — konwersję robi adapter
}

/**
 * Wynik wyszukania. Dyskryminowany, tak jak dziś IgdbLookupResult (types.ts:187) —
 * zmienia się słownik, nie kształt, więc migracja jest mechaniczna.
 *
 * `no_match` = katalog odpowiedział i nie ma takiej gry. Awaria transportu/auth NIE jest
 * `no_match` — leci wyjątkiem, bo „nie wiemy" ≠ „nie ma" (dziś: lookup.ts:17-24).
 */
export type CatalogMatch =
  | { readonly kind: "match"; readonly ref: CatalogRef; readonly metadata: CatalogMetadata;
      readonly diagnostics?: CatalogDiagnostics }
  | { readonly kind: "no_match" };

export interface GameCatalogPort {
  findGame(query: GameQuery): Promise<CatalogMatch>;
}

/** Awaria po stronie dostawcy — jedyny wyjątek, jaki port obiecuje. Trasy mapują na 502. */
export class CatalogUnavailableError extends DomainError { readonly code = "catalog_unavailable"; }
```

`src/lib/domain/catalog-ref.ts`:

```ts
/**
 * Wskazanie na rekord w zewnętrznym katalogu. Domena wie, że wpis MOŻE wskazywać na
 * katalog; nie wie, jaki to katalog ani jak wygląda jego identyfikator.
 */
export class CatalogRef {
  private constructor(readonly source: string, readonly id: string) {}
  static of(source: string, id: string | number): CatalogRef;
  /** Odtworzenie z wiersza: kolumny (igdb_id) — patrz §5.3 w sprawie nazwy kolumny. */
  static fromColumns(cols: { catalogId: number | null }): CatalogRef | null;
  toColumns(): { catalogId: number | null };
  equals(other: CatalogRef): boolean;
}
```

**Trzy rzeczy, których w porcie celowo NIE ma:**

- `KVNamespace` — cache tokenu to szczegół dostawcy (`external-research.md:184-185`),
  wstrzykiwany przy budowie adaptera, nie przy każdym wywołaniu. Przeciek P-5 znika.
- Limity, ponawianie, kody HTTP — wrapper już to robi (`external-research.md:29`); gdyby
  trzeba było zamienić go na raw `fetch`, odpowiedzialność zostaje po stronie adaptera.
- `collapsedFrom` jako pole pierwszej klasy. Dziś jest w unii wynikowej (`types.ts:197`)
  z adnotacją *„diagnostic-only … production consumers ignore it"*. W porcie ląduje
  w opcjonalnym `diagnostics`, więc nie uczestniczy w kontrakcie produkcyjnym.

### 4.5 Wiedza domenowa wyciągnięta spod typów biblioteki

`src/lib/domain/game-title.ts` — przeniesione **bez zmiany zachowania** z `igdb.ts:199-254`,
`:350-376`:

```ts
export function normalizeBaseTitle(raw: string): string;   // igdb.ts:233 — 1:1
export function titleSimilarity(a: string, b: string): number;  // Sørensen–Dice, igdb.ts:356
export function bestTitleSimilarity(query: string, candidateNames: string[]): number; // igdb.ts:367
```

`src/lib/domain/match-confidence.ts` — polityka pewności nad **kandydatem neutralnym**,
zamiast nad typem `Game`:

```ts
/** Kandydat sprowadzony do sygnałów, których wymaga polityka. Adapter go produkuje. */
export interface MatchCandidate {
  readonly ref: CatalogRef;
  readonly title: string;
  readonly alternativeTitles: string[];
  readonly platforms: Platform[];
  /** Znormalizowany sygnał „czy to znana gra". Adapter wybiera, z czego go liczy. */
  readonly popularity: number;
}

/** Dziś: isConfidentMatch (igdb.ts:403-424). Progi (igdb.ts:345-348) przenoszą się bez zmian. */
export function isConfidentMatch(candidate: MatchCandidate, query: GameQuery): boolean;
```

Progi `MIN_QUERY_INFO_CHARS`, `NAME_SIM_FLOOR`, `NAME_SIM_STRONG`, `POP_FLOOR`
(`igdb.ts:345-348`) są dostrojone do zbioru prawdy F-03 — to **wynik pomiaru, nie parametr
biblioteki**, więc zostają w domenie. Adapter dostarcza tylko liczbę `popularity`;
w wersji IGDB będzie to `Math.max(total_rating_count, follows)` (`igdb.ts:380`).

### 4.6 Adapter — jedyny moduł znający IGDB

`src/lib/adapters/igdb/index.ts`:

```ts
export interface IgdbCatalogDeps {
  readonly tokenStore: KVNamespace;          // binding wstrzykiwany raz, w kompozycji
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Fabryka adaptera. Jedyne miejsce, gdzie powstaje IGDBClient. */
export function createIgdbGameCatalog(deps: IgdbCatalogDeps): GameCatalogPort;
```

Pseudokod `findGame` — ten sam przebieg co dziś `lookupGameMetadata` (`igdb.ts:437-562`),
przełożony na słownik portu:

```
findGame(query):
  platformIds := IGDB_PLATFORM_IDS.resolve(query.platform)          // igdb-platform-ids.ts
  raw         := client.games.search(query.title).fields(FIELD_SET) // igdb-client.ts
                   .whereIf(platformIds, g => g.platforms.in(platformIds))
                   .limit(CANDIDATE_LIMIT).execute()
                 // transport/auth/KV padło -> throw CatalogUnavailableError
  if raw is empty: return { kind: "no_match" }

  candidates  := raw.map(toCatalogCandidate)                        // igdb-candidate-mapper.ts
  base        := collapseToBaseGame(raw, query)                     // igdb-edition-collapse.ts
                 // relacje version_parent / parent_game -> wiedza IGDB
                 // fallback po tytule bazowym -> woła domain/game-title.normalizeBaseTitle

  if not isConfidentMatch(toCatalogCandidate(base), query):         // domain/match-confidence.ts
      return { kind: "no_match" }

  seconds     := client.gameTimeToBeats.query()…first()?.normally   // sekundy (patrz §5.4 Q2)
  return {
    kind: "match",
    ref: CatalogRef.of("igdb", base.id),
    metadata: {
      genre:       names(base.genres),
      developer:   names(base.involved_companies.filter(developer).map(company)),
      series:      names(base.collections),
      releaseYear: yearFromEpochSeconds(base.first_release_date),
      releaseDate: isoDateFromEpochSeconds(pickPlatformDate(base, platformIds)),
      lengthHours: hoursFromSeconds(seconds),                        // ceil, igdb.ts:163-168
    },
    diagnostics: { collapsedFrom: … },
  }
```

`igdb-candidate-mapper.ts` — cała projekcja „kształt IGDB → kształt domenowy" w jednym pliku:

```ts
export function toCatalogCandidate(game: Game): MatchCandidate {
  return {
    ref: CatalogRef.of("igdb", game.id),
    title: game.name,
    alternativeTitles: names(game.alternative_names),
    platforms: names(game.platforms).flatMap(Platform.parseAll),
    popularity: Math.max(game.total_rating_count ?? 0, game.follows ?? 0),
  };
}
```

`igdb-platform-ids.ts` — mapa **kluczowana etykietą kanoniczną**, nie surowym aliasem:

```ts
/** Etykieta kanoniczna Platform → id platform IGDB v4. 14 wpisów zamiast 35 aliasów. */
const IGDB_PLATFORM_IDS: ReadonlyMap<string, number[]> = new Map([
  ["PlayStation 5", [167]], ["PlayStation 4", [48]], /* … */ ["PC", [6]],
]);

export function resolve(platform: Platform): number[];   // [] dla Evercade → search bez filtru
```

To jest miejsce, gdzie duplikacja realnie umiera: aliasy („ps5", „psvita", „pc dvd-rom")
rozwiązuje **domena**, a adapter tłumaczy już tylko 14 etykiet kanonicznych na id.
Mapa kurczy się z 35 wpisów (`igdb.ts:62-102`) do 14 i przestaje być kopiowana.

### 4.7 Kompozycja — jedno miejsce, które wie, który adapter jest wpięty

`src/lib/container.ts` (nowy plik):

```ts
import { env } from "cloudflare:workers";
import { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } from "astro:env/server";
import { createIgdbGameCatalog } from "@/lib/adapters/igdb";

/** Jedyna linia w repo, która wiąże port domenowy z konkretnym dostawcą. */
export function gameCatalog(): GameCatalogPort {
  return createIgdbGameCatalog({
    tokenStore: env.IGDB_TOKENS,
    clientId: requireSecret(TWITCH_CLIENT_ID, "TWITCH_CLIENT_ID"),
    clientSecret: requireSecret(TWITCH_CLIENT_SECRET, "TWITCH_CLIENT_SECRET"),
  });
}
```

Trasy wołają `gameCatalog()` i nie widzą ani `env`, ani sekretów, ani nazwy dostawcy.
Głośna awaria przy braku sekretów (`igdb.ts:25-29`) zachowana — przenosi się tutaj.

### 4.8 Styk z doc 02

Doc 02 §4.2 definiuje `EntryMetadata.fromLookup(result: IgdbLookupResult)`. Po tym refaktorze
sygnatura brzmi `EntryMetadata.fromLookup(match: CatalogMatch)` — to jedyna zmiana, jakiej
doc 02 wymaga, i jest czysto typowa (`status:"matched"` → `kind:"match"`,
`igdbId` → `ref`). Oba plany są niezależne; §KROK 6 podaje zalecaną kolejność.

---

## KROK 5 — Dowód izolacji, before/after, rozstrzygnięcia kontraktowe

### 5.1 Kto wie o IGDB przed i po

| Plik | Dziś wie | Po refaktorze | Dlaczego |
|---|---|---|---|
| `src/lib/services/igdb.ts` | **TAK** (`:1`, `:2`, `:21`, `:62-102`, `:444-499`) | **plik znika** — rozbity na `adapters/igdb/*` i `domain/*` | — |
| `src/lib/services/igdb-token-cache.ts` | **TAK** (`:19-20`) | **TAK** — przeniesiony do `adapters/igdb/` | Obejście specyficzne dla wrappera |
| `src/types.ts` | **TAK** (`:187-199`, `:230`) | **NIE** | `IgdbLookupResult` → `CatalogMatch` w `domain/ports/`; `IdentifyResponse.igdbId` → `catalogId` |
| `src/lib/services/library.ts` | **TAK** (`:4`, `:65`, `:97`, `:104`, `:138`) | **NIE** | Przyjmuje `CatalogMatch`; kolumnę pisze `EntryMetadata.toColumns` (doc 02) |
| `src/lib/validation/library.ts` | **TAK** (`:44`) | **NIE** | Pole usunięte ze schematu (doc 02 §5.1 poz. 6) |
| `src/lib/platforms.ts` | **TAK** (`:6-8`, `:32-33`, `:40-45`) | **plik znika** | Treść → `domain/platform.ts` + `platform-vocabulary.json` |
| `src/pages/api/library/lookup.ts` | **TAK** (`:3`, `:45`) | **NIE** | `gameCatalog().findGame({title, platform: Platform.parse(...)})` |
| `src/pages/api/library/index.ts` | **TAK** (`:50`) | **NIE** | Bez `env.IGDB_TOKENS` w sygnaturze |
| `src/pages/api/identify.ts` | **TAK** (`:9`, `:105`, `:114`, `:171`, `:208`, `:228`) | **NIE** | Cztery wystąpienia `env.IGDB_TOKENS` znikają; `igdbId` → `catalogId` |
| `src/components/library/GameDialog.tsx` | **TAK** (`:3`, `:291`, `:301`) | **NIE** | Po doc 02 §5.1 poz. 11 re-fetch jest serwerowy; dialog czyta zwrócony wiersz |
| `src/components/library/GameFormFields.tsx` | **TAK** (`:29`) | **NIE** | Pole usunięte z `GameFormValues` (doc 02 §5.1 poz. 13) |
| `scripts/identify-harness.mjs` | **TAK** (`:38-115`, `:220`, `:294`) | **NIE** | Czyta `platform-vocabulary.json`; porównuje etykiety, nie id |
| `test/helpers/fetch-mock.ts` | **TAK** (`:17`) | **TAK** | Mockuje `globalThis.fetch` na granicy dostawcy — **właściwe miejsce** |
| `src/lib/services/igdb*.test.ts` | **TAK** | **TAK** — jako `adapters/igdb/*.test.ts` | Testy adaptera mają prawo znać adapter |
| `src/db/database.types.ts` | **TAK** (`:44`) | **TAK, dopóki kolumna się tak nazywa** | Plik generowany; patrz §5.3 |
| `…create_library_entries.sql:21` | **TAK** | **TAK, opcjonalnie NIE** | Patrz §5.3 — osobna, nieobowiązkowa faza |
| `wrangler.jsonc:29`, `astro.config.mjs:55-56`, `.dev.vars.example:3-4` | **TAK** | **TAK** | Konfiguracja infrastruktury; nazwa sekretu to nazwa sekretu dostawcy |

**Bilans: z 18 plików produkcyjnych znających dziś IGDB zostaje 5** — katalog
`src/lib/adapters/igdb/` (liczony jako jeden byt), jedna linia w `src/lib/container.ts`
i trzy pliki konfiguracji infrastruktury. **Zero** w bazie logiki domenowej, zero w kontraktach
wire, zero w UI, zero w tooling'u dev.

### 5.2 Co dokładnie robi wymiana dostawcy (test „off-ramp")

Scenariusz z `external-research.md:30-31`: wrapper okazuje się porzucony, przechodzimy na
`igdb-api-types` + raw `fetch` — albo w ogóle na inny katalog.

| Krok | Dotyka | Uwaga |
|---|---|---|
| 1. Nowy katalog `src/lib/adapters/<provider>/` implementujący `GameCatalogPort` | nowe pliki | Kontrakt to jedna metoda |
| 2. Zmiana jednej linii w `src/lib/container.ts` | 1 linia | Jedyny punkt wiązania |
| 3. Nowe sekrety w `astro.config.mjs` + `.dev.vars.example` + Worker secrets | konfiguracja | Nieuniknione dla każdego dostawcy |
| 4. Testy adaptera | nowe pliki | Stary zestaw ginie razem ze starym adapterem |

| **Czego wymiana NIE dotyka** | Dowód |
|---|---|
| Migracji i schematu tabeli | `CatalogRef.toColumns()` jest jedynym producentem wartości kolumny |
| Kontraktu HTTP (`/api/library`, `/api/library/[id]`, `/api/library/lookup`, `/api/identify`) | Odpowiedzi mówią `catalogId`, nie `igdbId` |
| Żadnego komponentu React | Wyspy nie znają lookupu ani po refaktorze doc 02, ani po tym |
| `recommendation.ts` | Czyta kolumny, nie dostawcę — dziś i po |
| Słownika platform ani picklisty | `platform-vocabulary.json` jest domenowy |
| Wiedzy o edycjach i progów pewności | `domain/game-title.ts` + `domain/match-confidence.ts` |
| Harnessu FR-005 | Porównuje etykiety kanoniczne; zna tylko kontrakt HTTP |
| Testów tras i testów domeny | Widzą port, nie dostawcę |

### 5.3 Before/after dla każdego zduplikowanego miejsca

| # | Miejsce | Before | After |
|---|---|---|---|
| 1 | `platforms.ts:14-29` (`KNOWN_PLATFORMS`) | Lista etykiet w kodzie TS | `platform-vocabulary.json` → `PLATFORM_PICKLIST` |
| 2 | `platforms.ts:50-87` (`PLATFORM_DISPLAY_BY_ALIAS`, 37 wpisów) | Mapa alias→etykieta, wołana tylko z toru zdjęciowego | Ten sam JSON; `Platform.parse` wołane na **obu** torach zapisu (domyka R-13) |
| 3 | `igdb.ts:62-102` (`PLATFORM_IDS_BY_NAME`, 35 wpisów) | Mapa alias→id IGDB; źródło tożsamości konsoli | `adapters/igdb/igdb-platform-ids.ts` — **14** wpisów, klucz = etykieta kanoniczna |
| 4 | `identify-harness.mjs:42-83` (kopia ręczna) | Kopia poza systemem typów, broniona komentarzem | **Usunięta.** Harness czyta ten sam JSON |
| 5 | `igdb.ts:105-107` / `platforms.ts:34-36` / `identify-harness.mjs:85-87` | Trzy identyczne normalizatory | Jeden, prywatny w `domain/platform.ts` |
| 6 | `igdb.ts:124-135` + `:143-151` / `identify-harness.mjs:89-115` | Dwie kopie `resolvePlatformIds` + `platformsOverlap` | `Platform.parseAll` / `Platform.overlap` — raz |
| 7 | `igdb.ts:199-254` (`normalizeBaseTitle`) | Eksport z modułu IGDB | `domain/game-title.ts` — przeżywa wymianę |
| 8 | `igdb.ts:256-330` (collapse) | Miesza wiedzę o edycjach z relacjami IGDB | Rozdzielone: tytuł bazowy → domena, relacje → `adapters/igdb/igdb-edition-collapse.ts` |
| 9 | `igdb.ts:334-424` (`isConfidentMatch`) | `(base: Game, query)` — polityka pod typem biblioteki | `(candidate: MatchCandidate, query)` — progi w domenie, sygnały z adaptera |
| 10 | `igdb.ts:163-173` (sekundy→godziny, epoch→ISO) | Konwersja jednostek eksportowana z serwisu | Prywatna w adapterze; port oddaje godziny i `YYYY-MM-DD` |
| 11 | `library.ts:96-124`, `identify.ts:208-210`/`:228-230`, `GameDialog.tsx:295-303` | Trzy kopie decyzji „co znaczy matched", jedna w przeglądarce | Jedno miejsce: `EntryMetadata` (doc 02 §4.2) zasilane `CatalogMatch` |
| 12 | `lookup.ts:43-54` | Oddaje `IgdbLookupResult` jako `{ result }` | Oddaje `CatalogMatch` jako `{ match }`; słownik neutralny |
| 13 | `types.ts:187-199` | `IgdbLookupResult` w kontraktach współdzielonych | Przeniesione do `domain/ports/game-catalog.ts` jako `CatalogMatch` |
| 14 | `validation/library.ts:44` | `igdb_id` przyjmowane od klienta | Pole nie istnieje (doc 02) |
| 15 | `lookup.ts:45`, `index.ts:50`, `identify.ts:105`, `:171` | `env.IGDB_TOKENS` w czterech wywołaniach | `gameCatalog()` — binding tylko w `container.ts` |

**UI dostaje gotowe dane domenowe.** Dziś wyspa dostaje surowy kształt dostawcy i sama
składa z niego stan wpisu (`GameDialog.tsx:295-303`). Po obu refaktorach `handleRefetch`
wygląda tak:

```
Before (GameDialog.tsx:280-303)
  POST /api/library/lookup {title, platform}
  → { result: IgdbLookupResult }
  → if (result.status === "matched")
        patchValues({ genre, developer, series, release_year, release_date,
                      length_hours, igdb_id: result.igdbId, metadata_status: "matched" })

After
  POST /api/library/{id}/refetch                     (trasa z doc 02 §5.1 poz. 11)
  → { entry: LibraryEntry }                          (wiersz po stronie serwera)
  → setValues(mapEntryToValues(entry))               (bez decyzji o pochodzeniu)
  → 502 nadal ⇒ "failed", nie "no_match"             (zachowanie lookup.ts:17-24 utrzymane)
```

Wyspa przestaje znać zarówno dostawcę, jak i regułę pochodzenia — dostaje **wiersz domenowy**.

### 5.4 Otwarte pytania zależne od kontraktu IGDB — rozstrzygnięcia

W kodzie żyją dziś cztery pytania o kontrakt dostawcy, rozstrzygnięte empirycznie i opisane
komentarzem. Poniżej rozstrzygnięcie w oparciu o dokumentację IGDB v4 (Context7,
`/websites/api-docs_igdb`) oraz research wrappera z archiwum, plus miejsce zakodowania decyzji.

**Q1. Czy `release_dates.platform` to id, czy rozwinięty obiekt?**

Kod obchodzi to rzutowaniem:

> `igdb.ts:177-185` — *„When the query selects `release_dates.platform`, IGDB returns a bare
> numeric id, but the typed model declares the expanded `Platform` object — so accept both
> shapes."* → `const platform = releaseDate.platform as unknown as number | { id?: number } | undefined;`

**Rozstrzygnięcie:** dokumentacja endpointu `release_dates` opisuje `platform` jako
*„Reference ID for Platform"*. W Apicalypse rozwinięcie następuje **wyłącznie** przez
notację kropkową na konkretnym polu (`release_dates.platform.name`); selekcja
`release_dates.platform` zwraca surowe id. Kod ma rację empirycznie, a typ wrappera jest
zbyt optymistyczny.

**Gdzie zakodować:** w `adapters/igdb/igdb-candidate-mapper.ts` — jawny, nazwany typ
odpowiedzi (`interface IgdbReleaseDateRow { date?: number; platform?: number }`) i
projekcja z niego, zamiast `as unknown as` w kodzie współdzielonym. Decyzja przestaje być
komentarzem i staje się częścią kontraktu adaptera. **Nie** w warstwie API — trasa nie ma
prawa wiedzieć, że IGDB ma pola referencyjne.

**Q2. Czy `game_time_to_beats.normally` jest w sekundach i czy to właściwe pole?**

**Rozstrzygnięcie:** dokumentacja podaje `normally` jako *„Average time (in seconds) to finish
the game while mixing in some extras such as side quests without being overly thorough"*.
Konwersja z `igdb.ts:163-168` jest poprawna. Endpoint oferuje też `hastily` (bez dodatków)
i `completely` (100%).

**Gdzie zakodować — dwie różne decyzje w dwóch różnych miejscach:**
- *„Długość gry w domenie znaczy typowe przejście z częścią zawartości pobocznej, w pełnych
  godzinach"* — to decyzja produktowa (PRD: „overall game length commitment", `prd.md:161`).
  Miejsce: kontrakt portu, w dokumentacji `CatalogMetadata.lengthHours`.
- *„U tego dostawcy realizuje to pole `normally` endpointu `game_time_to_beats`, w sekundach,
  zaokrąglane w górę"* — decyzja dostawcy. Miejsce: adapter.

Bez tego rozdziału wybór `normally` vs `completely` wygląda na szczegół techniczny, a jest
tuningiem rekomendera: `length_hours` waży `W_LEN = 1000` (`recommendation.ts:35`).

**Q3. Jak filtrować po platformie — `platforms` czy `platforms.id`?**

> `igdb.ts:492-496` — *„`platforms` is an array of platform ids on the games endpoint, so filter
> the field directly (`platforms = (id,…)`). Filtering `platforms.id` is rejected by IGDB
> („Invalid field name: 'game.platforms.id'")."*

**Rozstrzygnięcie:** potwierdzone — dokumentacja pokazuje `where platforms = {48}` oraz
wariant `where release_dates.platform = [48,49,6]`. Kod jest poprawny.
**Gdzie zakodować:** w `adapters/igdb/igdb-client.ts`, razem z listą pól (`igdb.ts:444-490`).
Port przyjmuje `Platform`, nigdy id — więc pytanie nie ma prawa opuścić adaptera.

**Q4. Gdzie należy cache tokenu Twitcha?**

> `external-research.md:184-185` — *„`IGDBClientConfig` exposes **no token store,
> token-injection, or token-provider option** … The only interception points are the config's
> `fetch` and …"*

**Rozstrzygnięcie:** przechwycenie `fetch` (`igdb-token-cache.ts:52-59`) jest jedynym
dostępnym mechanizmem i pozostaje właściwe. Ale to obejście **konkretnego wrappera**, nie
wymaganie domeny — a dziś to ono wciągnęło `KVNamespace` do czterech tras i trzech sygnatur
serwisów (P-5).

**Gdzie zakodować:** `adapters/igdb/igdb-token-cache.ts`, a binding wstrzykiwany **raz**,
w `IgdbCatalogDeps.tokenStore` (§4.6). Inny dostawca może w ogóle nie potrzebować cache'u —
i wtedy nic w domenie ani w trasach o tym nie usłyszy.

---

## KROK 6 — Weryfikacja i plan faz

### 6.1 Kryterium sukcesu (wykonywalne)

```bash
rg -n --hidden -g '!node_modules' -g '!dist' -g '!.wrangler' -g '!package-lock.json' \
   -i 'igdb|twitch|api-wrappers' src/ scripts/ e2e/ test/ supabase/
```

**Dozwolone trafienia po refaktorze:**

| Ścieżka | Dlaczego wolno |
|---|---|
| `src/lib/adapters/igdb/**` | To jest ACL |
| `src/lib/container.ts` (1 linia importu + 1 wywołanie) | Jedyny punkt kompozycji |
| `supabase/migrations/**`, `src/db/database.types.ts` | Nazwa kolumny — patrz 6.2 (faza opcjonalna) |

**Zero trafień** w: `src/types.ts`, `src/lib/services/**`, `src/lib/domain/**`,
`src/lib/validation/**`, `src/pages/**`, `src/components/**`, `scripts/**`, `e2e/**`.

Konfiguracja infrastruktury (`wrangler.jsonc`, `astro.config.mjs`, `.dev.vars.example`)
jest poza zakresem grepa świadomie: nazwa sekretu dostawcy w konfiguracji dostawcy nie jest
przeciekiem. Można ją znormalizować (`CATALOG_TOKENS` zamiast `IGDB_TOKENS`) w fazie 6 —
binding to cache, więc rename nie niesie ryzyka utraty danych, ale wymaga zmiany w dashboardzie
Cloudflare (uwaga: `CLAUDE.md` §Environment — Workers Builds deployuje każdy push na `main`).

**Kryterium dodatkowe — brak drugiego źródła prawdy o platformach:**

```bash
rg -c 'toLowerCase\(\)\.replace\(/\\s\+/g' src/ scripts/    # oczekiwane: 1 trafienie
```

### 6.2 Plan faz

Zgodny z konwencją repo (`/10x-new` → `/10x-research` → `/10x-plan` → `/10x-tdd|/10x-implement`
→ `/10x-impl-review`, gate'y `npm test` / `lint` / `typecheck` / `build` + job `e2e`).

| Faza | Zakres | Test-first? | Gate |
|---|---|---|---|
| **1. Słownik platform** | `domain/platform.ts` + `platform-vocabulary.json`; `platforms.ts` znika; `Platform.parse` na **obu** torach zapisu (domyka R-13); harness czyta JSON i porównuje etykiety | **TAK** — czysta wartość, zero I/O; wzorzec `recommend()` | `npm test`; `npm run test:mutation --mutate "src/lib/domain/platform.ts"` (moduł krytyczny ryzykiem) |
| **2. Wiedza domenowa spod typów biblioteki** | `domain/game-title.ts`, `domain/match-confidence.ts`, `domain/catalog-ref.ts`. Przeniesienie **bez zmiany zachowania** | częściowo — istniejące asercje z `igdb.test.ts` przenoszą się **bez modyfikacji treści** | `npm test` — te same przypadki, ta sama zieleń |
| **3. Port + adapter** | `domain/ports/game-catalog.ts`, `adapters/igdb/**`, `container.ts`; `services/igdb.ts` i `igdb-token-cache.ts` znikają z `services/` | **TAK** dla portu (fake in-memory), nie dla adaptera (istniejące testy integracyjne przez `fetch-mock` przenoszą się 1:1) | `npm test`; `igdb.integration.test.ts` musi przejść bez zmian w asercjach |
| **4. Kontrakty wire** | `IgdbLookupResult` → `CatalogMatch` w `domain/ports/`; `IdentifyResponse.igdbId` → `catalogId`; `lookup.ts` oddaje `{ match }`; trasy wołają `gameCatalog()` | **TAK** — najpierw czerwone testy kontraktu trasy (wzorzec `test-plan.md` §6.4) | `npm test`; **`scripts/identify-harness.mjs` zaktualizowany w tym samym commicie** (czyta `catalogId`) — inaczej guardrail FR-005 przestaje mierzyć |
| **5. UI** | `GameDialog`/`GameFormFields` tracą `igdb_id`; re-fetch przez trasę serwerową | wspólna z doc 02 fazą 3 — **wykonać razem**, nie dwa razy dotykać tych samych plików | `npm test`; `npm run test:e2e` (3 speci; komentarze o `igdbId` w `photo-*.spec.ts:48`, `:52` do aktualizacji) |
| **6. Opcjonalnie: nazwy w infrastrukturze i bazie** | `igdb_id` → `catalog_id` (+ ewentualnie `catalog_source`), `IGDB_TOKENS` → `CATALOG_TOKENS`, `npm run db:types` | **TAK** — asercje pgTAP przed migracją | `npm run test:db`; **osobny PR** — deploy na `main` jest automatyczny |
| **7. Poza zakresem, świadomie** | Port `PhotoIdentifierPort` dla `vision.ts` (P-3) | — | — |

**Dlaczego faza 6 jest opcjonalna i osobna.** Wymiana dostawcy **nie wymaga** zmiany nazwy
kolumny — `CatalogRef.toColumns()` mapuje wartość domenową na dowolnie nazwaną kolumnę.
Rename jest wyłącznie po to, żeby schemat przestał kłamać o pochodzeniu danych. Wrzucenie
migracji + regeneracji typów + zmiany bindingu do tego samego PR-a co refaktor kodu zamieniłoby
zieloną tarczę w zgadywankę.

**Dlaczego faza 7 jest poza zakresem.** OpenRouter (P-3) jest już zamknięty w jednym pliku
i oddaje wynik domenowy (`vision.ts:221-226`). Zysk z portu to głównie testowalność trasy —
realny, ale nieporównywalnie mniejszy niż przy P-1. Zrobić po, tym samym wzorcem.

### 6.3 Kolejność względem doc 02

Plany są niezależne poza jednym stykiem (`EntryMetadata.fromLookup`). Zalecana kolejność:

```
doc 03 faza 1-2   (Platform + wiedza domenowa — nic nie zależy od doc 02)
doc 02 faza 1-2   (EntryMetadata + agregat + repozytorium; fromLookup od razu na CatalogMatch)
doc 03 faza 3-4   (port + adapter + kontrakty wire)
doc 02 faza 3  ∥  doc 03 faza 5   (jedno dotknięcie GameDialog/GameFormFields)
doc 02 faza 4-5, doc 03 faza 6
```

Odwrotna kolejność też działa, kosztem jednej dodatkowej zmiany sygnatury
`EntryMetadata.fromLookup` (z `IgdbLookupResult` na `CatalogMatch`).

### 6.4 Nowe nazwy nośne do zarejestrowania

Repo nie prowadzi formalnego rejestru kontraktów; rolę tę pełnią `CLAUDE.md` §Key conventions
i `context/foundation/lessons.md`.

| Nazwa | Znaczenie | Dlaczego nośna |
|---|---|---|
| `GameCatalogPort` | Port: jedna metoda `findGame(query)` | Rozszerzenie go = przeciek dostawcy do domeny |
| `CatalogMatch` / `CatalogMetadata` | Wynik i ładunek wyszukania w słowniku domeny | Zastępują `IgdbLookupResult` w kontraktach wire |
| `CatalogRef` | Wskazanie na rekord w katalogu (`source` + `id`) | Domena wie, że katalog istnieje; nie wie który |
| `Platform` | Tożsamość konsoli jako wartość, nie napis | Jedyne źródło prawdy o aliasach; likwiduje R-13 i R-14 |
| `platform-vocabulary.json` | Słownik jako dane, czytane przez TS i przez `.mjs` | Jedyny sposób, by harness nie miał kopii |
| `MatchCandidate` | Kandydat sprowadzony do sygnałów polityki | Pozwala progom F-03 przeżyć wymianę dostawcy |
| `CatalogUnavailableError` | „Nie mogliśmy zapytać" ≠ „nie ma takiej gry" | Nośnik rozróżnienia, które dziś trzyma `lookup.ts:17-24` |

**Nowe konwencje do `CLAUDE.md` §Key conventions:**

- „**Ports & adapters**: external providers live behind a port in `src/lib/domain/ports/`,
  implemented in `src/lib/adapters/<provider>/`. No provider name may appear in `src/types.ts`,
  `src/pages/**`, `src/components/**`, or `scripts/**` — wiring happens only in
  `src/lib/container.ts`."
- „**Platform**: free-text platform strings are parsed through `Platform` on **every** write
  path. Provider platform ids exist only inside that provider's adapter."

**Nowy wpis do `context/foundation/lessons.md`:**

- *„Komentarz nie jest granicą"* — kontekst: `igdb.ts:59-61` i `platforms.ts:32-33` — dwa
  miejsca, w których autor rozpoznał granicę warstw i utrwalił ją komentarzem plus kopią kodu;
  problem: kopia poza systemem typów (`identify-harness.mjs:42`) mierzyła guardrail FR-005
  i mogła cicho odjechać od realnego groundingu; reguła: jeśli komentarz mówi „keep in sync"
  albo „kept local to avoid an import", brakuje obiektu wartości albo pliku danych — nie
  dyscypliny; dotyczy: plan, implement, impl-review.

### 6.5 Świadome nie-cele

- **Supabase nie dostaje ACL-a.** RLS niesie N-01 (`prd.md:171`, `test-plan.md:61`,
  18 asercji pgTAP). Repozytorium z doc 02 §4.5 daje szew na zapisie i to wystarcza;
  ukrywanie Postgresa za portem osłabiłoby jedyną warstwę, która widzi awarię izolacji.
- **Projekcje odczytowe zostają na Supabase.** `listLibraryEntries`, `getLibraryFacets`,
  `listUsedPlatforms` (`library.ts:237`, `:381`, `:362`) to zapytania, nie ładowanie agregatu.
  Owinięcie ich w port dałoby albo wyciek `.overlaps()`/`.in()` do domeny, albo regresję
  wydajności — zgodnie z decyzją doc 02 §4.5.
- **Nie wprowadzamy DI-kontenera.** `container.ts` to jedna funkcja fabrykująca. Framework
  wstrzykiwania byłby kosztem bez odbiorcy przy jednym porcie (docelowo dwóch).
- **Nie zmieniamy zachowania.** Każdy próg, każda degradacja i każdy kod odpowiedzi zostają
  takie jak dziś. Rozjazdy semantyczne R-01, R-02, R-03, R-06 są decyzjami produktowymi
  i mają własne miejsce w doc 01 §KROK 4 — refaktor, który przy okazji „poprawia" regułę,
  jest nieweryfikowalny.
- **Nie ruszamy `recommendation.ts`.** Silnik czyta kolumny; po refaktorze czyta te same
  kolumny, wypełnione przez ten sam port.
