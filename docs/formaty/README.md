# Formaty plików

Każdy format ma schemat zod w `packages/schemas/src/index.ts` i wygenerowany z niego JSON Schema w tym katalogu (`npm run build`, potem `node scripts/export-schemas.mjs`). Dziś CLI waliduje schematem przy wczytaniu `config.yml` i `stubs.yml`; pozostałe schematy opisują pliki, które CLI pisze, i służą integracjom. Po zmianie schematu trzeba uruchomić `npm run schemas`, inaczej pliki w tym katalogu się zestarzeją.

| Format | Plik | Kto pisze | Kto czyta |
|---|---|---|---|
| konfiguracja | `.flowretest/config.yml` | `init`, człowiek | każda komenda |
| fixture | `.flowretest/<workflow>/fixtures/<wykonanie>.json` | `pull` | `run`, `scan`, `redact` |
| reguły proxy | `<sandbox>/rules/rules.json` | `run` (z tabel usług i nagłówków arkusza z nagrań) | obraz proxy |
| stuby | `.flowretest/<workflow>/stubs.yml` | człowiek | `run`, `upgrade-check` |
| przechwycenie | `<sandbox>/capture/requests.jsonl` | obraz proxy | `run` |
| raport | `.flowretest/<workflow>/runs/<czas>/report.json` | `run`, `upgrade-check` | `diff`, `accept`, `redact --report` |
| baseline | `.flowretest/<workflow>/baseline/<przypadek>.json` | `accept` | `diff --against baseline` |

## Konfiguracja (`config.schema.json`)

`instance.url` to adres instancji; klucz API leży osobno w `secrets.env` albo w `FLOWRETEST_API_KEY`. `engine.tag` to tag obrazu `n8nio/n8n`, który runner pobiera do sandboxa; `engine.timezone` trafia do `GENERIC_TIMEZONE` i `TZ`; `engine.env` to dodatkowe zmienne dla sandboxa, nigdy kopia produkcji. `normalize.ignore` to ścieżki w ciele żądania zastępowane przez `<ignored>` (np. `properties.last_activity`), `normalize.idSegments` to wyrażenia regularne segmentów ścieżki uznawanych za `{id}`. `run.stabilize` włącza podwójny przebieg, `run.executor` wybiera `batch` (jeden proces n8n na stronę) albo `execute` (proces na przypadek).

## Fixture (`fixture.schema.json`)

Jedno nagrane wykonanie. `trigger` to węzeł, od którego zaczęło się wykonanie, i jego elementy wyjściowe; `nodes` to wyjścia wszystkich węzłów per uruchomienie (`runs[]`, każde z `outputs[][]` po indeksie wyjścia, `startTime`, `executionTime`, `inputCount`). `workflowData` to wersja workflow z chwili nagrania, używana jako strona "stara", gdy wszystkie fixture'y mają ten sam `workflowVersionId`. `redacted: true` oznacza kopię po `redact`. Fixture'y zawierają dane klientów końcowych i są w `.gitignore`.

## Reguły proxy (`rules.schema.json`)

Lista uporządkowana; pierwsza pasująca reguła wygrywa. `match` ma `host` (dokładny albo wyrażenie od `^`), `method` (wyrażenie, np. `POST|PUT`) i `path` (wyrażenie). `respond` ma `status`, `headers`, `json` albo `body`, albo `close: true` (zamknięcie połączenia, w raporcie BLOCKED). `times` zużywa regułę po N trafieniach. W `json` działają szablony `{{seq}}`, `{{uuid}}`, `{{now}}`, `{{echo body.x}}`, także w środku tekstu.

## Przechwycenie (`capture.schema.json`)

Jedna linia JSON na żądanie. `version` i `case` pochodzą z `current.json` zapisywanego przez runner przed przypadkiem (w trybie partii `case` to `batch`, a przypisanie idzie po oknie czasowym wykonania). `headers` zawiera tylko listę dozwolonych nagłówków i flagę `x-frt-has-authorization`; wartość `Authorization` nigdy nie jest zapisywana. `body` do 256 kB, `multipart` jako lista części z rozmiarem i skrótem bez bajtów. Większe ciało ma tylko `bodyBytes` i `bodySha256` i jest porównywane po nich. Parametr zapytania albo pole formularza wysłane kilka razy ma w `query` tablicę wartości w kolejności wysłania. Liczby całkowite większe niż 2^53 w ciele JSON zostają zapisane jako tekst z dokładnymi cyframi.

`{{seq}}` w regułach to numer kolejnego wywołania tego samego endpointu (metoda, host, ścieżka) w danej wersji, więc n-te wywołanie endpointu dostaje ten sam numer w starej i nowej wersji. Wywołania innych endpointów go nie przesuwają, a ciało żądania nie ma na niego wpływu.

## Raport (`report.schema.json`)

`cases[]` to wynik diffu per przypadek: `status`, `entries[]` (`op` jako `=`, `~`, `+`, `-`, `!`, węzeł, metoda, host, szablon ścieżki, `fieldDiffs[]`, `flags[]`), `summary`, `error`, `warnings[]`. `calls` to znormalizowane rejestry obu stron, pola zmienne i znacznik `stable` per przypadek, z których korzystają `accept` i `diff --against baseline`. Ścieżki w `fieldDiffs[].path` to pola ciała (`a.b[2].c`, klucz z kropką jako `["a.b"]`) oraz trzy pola spoza ciała: `@path` (konkretna ścieżka URL, więc wywołanie do innego rekordu jest zmianą), `@contentType` (typ mediów bez parametrów) i `?nazwa` (parametr zapytania, powtórzony jako `?nazwa[1]`). Pola zmienne w `calls[].volatile` mają postać `<klucz wywołania> :: <ścieżka pola>` i maskują pole tylko w wywołaniach o tym kluczu. `coverage` liczy węzły piszące przechwycone i odtworzone oraz nieobsługiwane, a `stubbed` wymienia węzły obsłużone stubem. `sandbox` zapisuje sprawdzenie szczelności wykonane przed przebiegiem, osobno dla każdej sieci sandboxa: sieć `--internal`, proxy podpięte tylko do niej, bezpośrednie połączenie z obrazu n8n odrzucone. Raport bez tego pola (sprzed 0.3.0) jest renderowany jako „seal not verified”. `engine` i `engines` opisują obrazy z digestami. Flagi: `empty-value`, `missing-field`, `type-changed`, `expression-residue`, `duplicate-bodies`, `count-changed`, `count-per-item-changed`, `node-not-executed`, `blocked`.

Wersja po `redact --report` (`report.redacted.json` i `plan.redacted.md`) ma kształt planu, a nie pełnego raportu: `cases`, `coverage`, etykiety wersji i silnika, bez rejestrów `calls`. Nie przechodzi więc `report.schema.json`. Wartości pól są zastąpione przez `<string 13 #a1b2c3d4>` (typ, długość, skrót HMAC z losowym kluczem na raport, więc równe skróty znaczą równe wartości tylko w obrębie jednego raportu). Ścieżki żądań są zastąpione szablonami. W tekście błędu e-maile, fragmenty w cudzysłowie i ciągi co najmniej czterech cyfr są zastąpione kształtem. Zostają tylko znane placeholdery normalizacji (`<ts>`, `<uuid>`, `<epoch>`, `<token>`, `<volatile>`, `<ignored>`).

## Stuby (`stubs.schema.json`)

Odpowiedzi dla węzłów, których nie da się odtworzyć z nagrania: zapis do bazy, odczyt na gałęzi, której nagranie nie przeszło, nagranie ponad 1 MB. `stubs` to mapa nazwa węzła na `items` (lista obiektów `json` kolejnych elementów wyjścia) albo `file` (plik JSON lub YAML względem `stubs.yml`: tablica elementów, obiekt z `items` albo jeden obiekt). Flaga `--stub "<węzeł>=<plik>"` wygrywa z wpisem w pliku. Rewriter zastępuje taki węzeł węzłem Code, który zwraca te elementy przy każdym uruchomieniu; węzeł przestaje być nieobsługiwany, nie liczy się do węzłów piszących, jest wymieniony w `coverage.stubbed`, a przypadek dostaje ostrzeżenie `stub: ...`.

## Baseline (`baseline.schema.json`)

Zaakceptowany rejestr wywołań przypadku bez pól zależnych od czasu, z polami `acceptedAt`, `acceptedBy`, `message`, `volatilePaths` oraz `engineDigest`. `accept` odmawia zapisu, gdy przebieg nie sprawdził stabilności nowej wersji albo gdy nowa wersja różni się między dwoma przebiegami; `--force` to omija.
