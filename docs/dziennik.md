# Dziennik po spike'u

Postępy względem planu implementacji (sekcja 8) po dniu 10. Spike jest opisany w `docs/spike/wyniki.md`.

## Tydzień 3 (start 2026-09-24), CLI 0.1

Zrobione:

- skaner statyczny w `core/scan.ts`: tabela wsparcia (trigger, odtwarzany, wykonywany, zamieniany, nieobsługiwany, osiągalność), reguły S000 (nieobsługiwany na ścieżce), S001 (typeVersion), S002 (wiszące odwołanie), S003 (id poświadczeń), S004 (przełączniki węzła), S005 (`.item` za Merge, Aggregate, Summarize albo Code), S006 (opcja Proxy), S008 (`process.env` w Code), S009 (dodane i usunięte węzły oraz połączenia), S010 (zmiana nazwy węzła po id), S011 (węzeł wyłączony), S012 (zmiana parametrów), S013 (adres `localhost` w HTTP Request);
- komendy `scan`, `diff` (ponowne renderowanie przebiegu, także wobec baseline'u) i `accept` (baseline per przypadek z autorem i komunikatem);
- `run` w trybie partii z wyłącznym przypisaniem przechwyceń do wykonań, sprzątanie sandboxa po Ctrl+C, rejestry wywołań i pola zmienne w `report.json`, odczyt błędów walidacji sprzed startu z bazy SQLite sandboxa (`node:sqlite`);
- wersja `0.1.0-next.1`, README pakietu po angielsku, CHANGELOG, `npm pack --dry-run` (58 kB, 65 plików), test e2e katalogu (`npm run e2e -w packages/cli`).

Sprawdzone na instancji deweloperskiej: `run` daje DIFF wobec nagranej wersji, `accept` zapisuje trzy baseline'y, `diff --against baseline` daje PASS i pozostaje PASS po kolejnym przebiegu.

Do zrobienia w tym tygodniu (bramka 3, piątek):

- publikacja `0.1.0-next.1` na npm z kanałem `next` i obrazu proxy w GHCR (wymaga logowania założyciela: `npm login`, `docker login ghcr.io`);
- macierz e2e w CI (`.github/workflows/e2e.yml`) na obrazach 2.40.5 i `v3-nightly`;
- sesje z trzema agencjami na ich eksportach; lista blokerów;
- reguła w `scan` ostrzegająca, gdy fixture'y pochodzą z innej wersji workflow niż opublikowana.

Znane skróty wersji 0.1:

- `accept` nie wymusza dwóch identycznych przebiegów nowej wersji; `--stabilize` maskuje pola zmienne przed zapisem;
- `init` wymaga `--engine`, bo anonimowy `GET /rest/settings` nie zwraca wersji;
- brak redakcji fixture'ów (0.2) i renderera JUnit oraz Markdown (0.2);
- workflow wołający własną instancję przez `localhost` kończy w sandboxie błędem połączenia; `scan` to ostrzega, `run` pokazuje ERROR.

## Tydzień 4 (2026-09-24), CLI 0.2

Zrobione:

- `run --stabilize` wykonuje obie wersje dwa razy: pola zmienne z obu par, znacznik `stable` per przypadek w `report.json`; `accept` odmawia bez sprawdzonej stabilności albo przy niestabilnej nowej wersji, chyba że `--force`;
- `run --format terminal,json,junit,md`: `junit.xml` (jeden testcase na przypadek, DIFF oraz ERROR jako failure, BLOCKED oraz SKIPPED jako skipped) i `plan.md` (tabela, sekcje zwijane per przypadek, limit 60 kB) w katalogu przebiegu;
- `upgrade-check --engine-old --engine-new`: ta sama wersja workflow na dwóch obrazach w dwóch sandboxach; na instancji deweloperskiej 2.40.5 przeciw `v3-nightly` dało PASS w 53 s;
- `redact --workflow`: kopie fixture'ów z podmienionymi e-mailami, nazwiskami oraz telefonami, z zachowanymi identyfikatorami, datami oraz liczbami; ta sama wartość dostaje tę samą zamianę, więc złączenia między węzłami działają;
- GitHub Action (`action/action.yml`, composite): `init`, `pull`, `run` z formatami, artefakt z raportem, komentarz w PR aktualizowany w miejscu, porażka zadania przy ERROR i BLOCKED;
- wersja `0.2.0-next.1`.

Odkrycie warte zapamiętania: Docker Desktop na Windows zwraca `EIO` przy listowaniu katalogu z bind mountu, gdy ścieżka hosta ma około 180 znaków lub więcej (156 znaków działa, 182 nie), a Git Bash pokazuje w takich katalogach niepełne listy plików. Katalogi montowane do sandboxa (reguły, przechwycenia, certyfikaty, praca, wyjście) leżą teraz w katalogu tymczasowym systemu (`frt-<losowe>`), a w `.flowretest/<id>/runs/<czas>/` zostają tylko `report.json`, `plan.txt`, `junit.xml` oraz `plan.md`.

Poza sesją: publikacja `0.2.0-next.1` (npm, GHCR), sesje z agencjami, pierwsze płatne wdrożenie, przypomnienie do license@n8n.io.
