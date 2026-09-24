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
