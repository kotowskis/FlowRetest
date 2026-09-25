# Protokół pilotażu

Jedna strona dla każdej agencji w pilotażu. Plan zapisał ten dokument na dzień 10 (tydzień 2); powstał w tygodniu 14, bo sesje z agencjami jeszcze się nie odbyły.

## Cel

Sprawdzić na workflow agencji trzy rzeczy, od których zależy bramka 5: czy FlowRetest przechwytuje co najmniej 80% węzłów piszących, czy odtwarza znane agencji regresje i czy agencja płaci w ciągu 30 dni od pierwszego raportu.

## Zasada danych

Dane agencji i jej klientów nie opuszczają maszyny agencji. Sesje odbywają się przez udostępnienie ekranu, na komputerze agencji albo w jej CI. Skynappse nie dostaje eksportów workflow, fixture'ów ani baseline'ów. Zgłoszenia błędów idą jako opis albo jako pliki po `flowretest redact --fixtures`. Jeśli agencja chce wypróbować warstwę hostowaną, wysyła tylko raport po `flowretest upload` i przed pierwszym uploadem jej właściciel przyjmuje DPA w aplikacji.

## Kryteria wejścia

- n8n w wersji 2.20 lub nowszej, dostęp do publicznego API instancji (klucz API);
- Docker na maszynie, na której działa runner;
- co najmniej jeden workflow z zapisanymi udanymi wykonaniami, który wysyła dane do zewnętrznych API;
- osoba po stronie agencji, która zna ten workflow i ostatnie błędy w nim.

## Przebieg

| Sesja | Czas | Co się dzieje | Kto prowadzi |
|---|---|---|---|
| 1 | 60 do 90 min | `init`, `pull`, `scan`, pierwszy `run` na workflow wskazanym przez agencję; stoper od `init` do pierwszego planu | agencja przy klawiaturze, Skynappse podpowiada |
| 2 | 60 min, tydzień później | odtworzenie do pięciu znanych regresji agencji (stara i nowa wersja workflow z historii), `accept`, `diff --against baseline`, opcjonalnie GitHub Action | agencja |
| 3 | 30 min, po 30 dniach | przegląd: czy agencja użyła narzędzia sama przy prawdziwej zmianie, decyzja o zapłacie | Skynappse |

## Co mierzymy

| Miara | Źródło | Próg |
|---|---|---|
| czas od `init` do pierwszego planu | stoper w sesji 1 | poniżej 60 minut |
| pokrycie węzłów piszących | stopka planu (`Coverage`) | co najmniej 80% na workflow agencji |
| przypadki SKIPPED i powody | tabela wsparcia ze `scan` | lista do planu wydań, bez progu |
| odtworzone regresje | sesja 2 | co najmniej 4 z 5 |
| samodzielne użycie | pytanie w sesji 3 | tak albo nie |
| zapłata | faktura za wdrożenie albo plan Team | 2 z 3 agencji w 30 dni od pierwszego raportu |

## Po każdej sesji

Wynik trafia do `docs/dziennik.md` w jednym akapicie: agencja (skrót), wersja n8n, liczby z tabeli, blokery. Bloker, który zatrzymał sesję, dostaje zgłoszenie w repozytorium w ciągu doby.
