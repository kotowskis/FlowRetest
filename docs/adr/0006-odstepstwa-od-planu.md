# ADR 0006. Odstępstwa od planu w tygodniach 1 do 8

Data: 2026-09-24. Status: przyjęte; spisane po audycie (`docs/audyt-2026-09-24.md`), który znalazł je w kodzie bez zapisu w ADR ani w dzienniku.

## Kontekst

Plan implementacji z 2026-09-23 opisuje narzędzia i flagi. Część z nich zmieniła się w trakcie pracy, a powody zostały tylko w kodzie. Ten zapis zbiera je w jednym miejscu, żeby następna osoba nie przywracała planu tam, gdzie kod ma rację, i nie brała planu za stan faktyczny.

## Decyzje

| Plan | Stan | Powód |
|---|---|---|
| Node 20 u użytkownika | Node 22.12 | odczyt błędów sprzed startu wymaga `node:sqlite` (22.5), commander 15 wymaga 22.12 |
| bundel z tsup | esbuild w `packages/cli/build.mjs` | tsup nie jest już rozwijany; wystarcza jedno wywołanie esbuild; pakiety robocze `@flowretest/*` są wklejane do bundla i zostają prywatne |
| katalog `catalog/` z `expected.json` i README per przypadek | przypadki jako kod w `packages/cli/src/catalog/cases.ts`, oczekiwania w `packages/cli/e2e/catalog.test.ts` | przypadki budują workflow z funkcji pomocniczych; eksport do JSON zostaje na później, gdy katalog będzie współdzielony poza repozytorium |
| stabilizacja domyślnie włączona, `--no-stabilize` | `--stabilize` włączane ręcznie, `run.stabilize` w konfiguracji | podwójny przebieg obu wersji podwaja czas; `accept` i tak wymaga przebiegu ze stabilizacją, a Action włącza ją domyślnie |
| `volatile.json` | pola zmienne w `report.json` (`calls[].volatile`) i w baseline'ach (`volatilePaths`) | jedno źródło prawdy zamiast osobnego pliku; od audytu każde pole jest przypisane do klucza wywołania |
| `--keep-sandbox`, `accept --case`, `redact --fixtures` | `--keep`, `accept --cases`, `redact` (fixture'y domyślnie) i `redact --report` | krótsze nazwy, lista przypadków jak w `run --cases` |
| nieobsługiwany węzeł na ścieżce: BLOCKED | przypadek SKIPPED, wynik przebiegu BLOCKED, kod 3 | przypadek w ogóle nie jest wykonywany, więc SKIPPED lepiej opisuje stan przypadku; wynik całości nadal nie może być PASS |
| węzeł AI bez nagrania: BLOCKED | wykonanie przeciw szablonowi zlewu i ostrzeżenie | zapisane w dzienniku, tydzień 6 |
| macierz e2e 2.20.x, 2.30.x, 2.40.5, `next` | 2.40.5, `next`, `v3-nightly` | 3.0 jest bliżej niż utrzymanie starych minorów; 2.20 i 2.30 do dodania, gdy pilotażowa agencja będzie na takiej wersji |
| komendy spike'u poza produktem | `spike day3..day7` w CLI, ukryte w `--help` | `spike day7 --only` to szybka ścieżka do prób pojedynczych przypadków |
| reguły skanera S001 do S012 według planu | S000 do S013 z inną numeracją (S010 zmiana nazwy, S012 parametry, S013 `localhost`) | numeracja powstała w kolejności wdrażania; lista jest w `docs/dziennik.md`, tydzień 3 |

## Uzupełnione po audycie

Wszystkie elementy planu, których brakowało po tygodniu 8, są w kodzie: `--stub` i `stubs.yml`, sprawdzanie szczelności przed każdym przebiegiem (pole `sandbox`), flagi globalne, `diff --format`, `sandbox export --compose`, sekcja "Engine differences", pole `static`, eslint, próg pokrycia 80% w `core`, `npm audit` w CI i ręczne oczekiwania (`expectations.yml`). Różnice wobec planu przy tej okazji:

| Plan | Stan | Powód |
|---|---|---|
| stub jako reguła proxy `user-stub` z dopasowaniem host, metoda, ścieżka | stub na poziomie węzła w rewriterze | działa też dla węzłów spoza HTTP (Postgres, SMTP), dla odczytów bez nagrania i dla nagrań ponad 1 MB; reguła proxy nie była dotąd potrzebna |
| c8 z progiem 80% | wbudowany pomiar Node (`--experimental-test-coverage --test-coverage-lines=80 --test-coverage-functions=80`) w `npm test` pakietu `core` | ten sam próg bez dodatkowej zależności; `core` ma 97% linii |
| eslint z konfiguracją z Pstriq | `eslint.config.mjs`: `@eslint/js` i `typescript-eslint` (recommended, bez reguł z typami) plus `no-restricted-imports` dla modułów IO w `core` i `services` | konfiguracja Pstriq nie jest w tym repozytorium; reguły z typami dublowałyby `tsc` |
| `sandbox export --compose` bez szczegółów | compose z proxy, n8n jako `n8n start` na wolumenie sandboxa i kontenerem socat wystawiającym edytor na 127.0.0.1:5678 | n8n zostaje w sieci wewnętrznej, więc otwarcie edytora nie rozszczelnia sandboxa |
| `--verbose` bez definicji | każde wywołanie `docker` z czasem i pełne stosy błędów na stderr | na stderr, żeby nie mieszać się z `--json` na stdout |

## Skutki

- Plan pozostaje dokumentem z 2026-09-23 i nie jest poprawiany wstecz; stan faktyczny opisują ten ADR, `CHANGELOG.md` i `docs/dziennik.md`.
- Każde kolejne odstępstwo dostaje wpis tutaj albo osobny ADR.
