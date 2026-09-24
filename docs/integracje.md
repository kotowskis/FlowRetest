# Integracje

Propozycje z planu (sekcja 8, tygodnie 5 do 8): subkomenda w n8n-as-code i narzędzie w n8n-mcp. Obie to kanały dystrybucji, nie konkurenci; obie wymagają PR-ów do cudzych repozytoriów, więc poniżej jest to, co runner musi udostępnić, i szkic każdej propozycji.

## Co runner udostępnia

- Wejścia po stronie plików: `--old <plik>` i `--new <plik>` przyjmują JSON workflow w formacie eksportu n8n, także z repozytorium prowadzonego przez n8n-as-code; instancja jest potrzebna tylko do `pull` fixture'ów.
- Wyjścia dla maszyn: `run --format json,junit,md`, `scan --json`, `diff --json`, kody wyjścia 0 do 5 (0 PASS, 1 DIFF, 2 ERROR, 3 BLOCKED, 4 problem z użyciem albo środowiskiem, 5 błąd wewnętrzny).
- Brak stanu poza `.flowretest/`; katalog można trzymać w repozytorium bez sekretów i fixture'ów (reguły `.gitignore` z `init`).

## n8n-as-code: subkomenda `test`

n8n-as-code trzyma workflow jako pliki w repozytorium i synchronizuje je z instancją (`pull`, `push`, przegląd diffu). Propozycja: `n8n-as-code test <plik-workflow>` wywołuje `npx flowretest run --workflow <id> --old <plik z gałęzi bazowej> --new <plik roboczy> --format terminal,md` i zwraca kod wyjścia runnera. Identyfikator workflow i adres instancji są już w konfiguracji n8n-as-code, więc subkomenda przekazuje je do `flowretest init` przy pierwszym uruchomieniu. Warunek: n8n-as-code eksportuje pliki bez pól `activeVersionId` i `shared` albo runner je ignoruje (ignoruje, od wersji 0.1).

Szkic PR-a: nowy plik komendy w n8n-as-code, dokument w README z sekcją "Testing a change before push", przykład GitHub Action z `action/action.yml` z tego repozytorium. Do wysłania po publikacji `flowretest` na npm, bo subkomenda używa `npx`.

## n8n-mcp: narzędzie `flowretest_replay`

n8n-mcp udostępnia narzędzia MCP do pracy z n8n, w tym `n8n_test_workflow`, które wykonuje prawdziwe uruchomienia. Propozycja narzędzia `flowretest_replay` o wejściu `{ workflowId, newWorkflowJson, last?: number }` i wyjściu `report.redacted.json` plus tekst planu. Implementacja: uruchomienie `flowretest` jako procesu potomnego w katalogu projektu MCP z lokalną konfiguracją; wymaga Dockera na maszynie, na której działa serwer MCP, co trzeba jasno opisać w README narzędzia. Wartość dla agenta: przed `n8n_update_workflow` agent może pokazać, co zmieniona wersja wyśle, zamiast wykonywać ją naprawdę.

Szkic PR-a: plik narzędzia w n8n-mcp, wpis w liście narzędzi, test z zamockowanym runnerem. Kolejność: najpierw n8n-as-code (prostsze), potem n8n-mcp.

## GitHub Action dla repozytoriów bez n8n-as-code

Gotowe w `action/action.yml`: `init`, `pull`, `run`, artefakt, komentarz w PR. Przykład użycia jest w README pakietu.
