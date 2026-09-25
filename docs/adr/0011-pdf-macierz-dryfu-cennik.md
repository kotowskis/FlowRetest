# ADR 0011. Eksport PDF, macierz dryfu v0, strona cennika

Data: 2026-09-25. Status: przyjęte.

## Kontekst

Tydzień 13 planu (sekcja 11): eksport PDF "co by wysłano" per przebieg, macierz dryfu silnika v0 i strona cennika. Notatka decyzyjna (punkt 6.7) uzasadnia PDF potrzebą audytora (ISO 27001: dowód, że zmianę przetestowano i zatwierdzono). Hipoteza cenowa (punkt 6.9) przypisuje PDF i macierz dryfu do planu Agency. Aplikacja ma tylko raporty po redakcji (ADR 0007), więc oba widoki budujemy z kształtów wartości, nie z wartości.

## Decyzje

| Temat | Decyzja | Powód |
|---|---|---|
| Treść PDF | nagłówek przebiegu (porównanie, silnik, commit, szczelność, pokrycie, adres przebiegu), akceptacje tego przebiegu, potem każde wywołanie nowej wersji w każdym przypadku z polami żądania; przy zmienionych polach wartość starej wersji | audytor pyta, co zmiana wyśle i kto ją zatwierdził; zmiany bez niezmienionych wywołań nie pokazałyby pełnego obrazu |
| Wartości w PDF | kształty z raportu po redakcji (typ, długość, solony skrót), jak na stronie przebiegu; akapit na końcu dokumentu to wyjaśnia | dokument trafia do klienta agencji i audytora, więc nie może zawierać danych klientów końcowych |
| Limit pól | 150 pól na wywołanie, dalej zdanie z liczbą pominiętych | jedno wywołanie z tablicą tysiąca elementów dawałoby setki stron |
| Biblioteka | `@react-pdf/renderer` 4.9 w trasie `GET /runs/<id>/pdf`, dokument pisany przez `createElement` | plan wymienia react-pdf; satori z Pstriq robi obrazy, nie wielostronicowy dokument z podziałem stron; bez JSX test jednostkowy w Node renderuje PDF bez kroku budowania |
| Fonty | Inter (400, 600) i Roboto Mono z paczek `@expo-google-fonts`, pliki TTF w `apps/web/assets/fonts` z licencjami OFL | 14 standardowych fontów PDF nie ma polskich liter, a nazwy węzłów je mają; fontkit nie dekoduje plików JetBrains Mono (ligatury) ani IBM Plex Mono z tych paczek |
| Dostęp | sesja i RLS jak na stronie przebiegu; plan bez `pdf_export` dostaje 402 z adresem strony Billing; plik `attachment`, `cache-control: private, no-store`; nazwa pliku tylko ASCII | obcy użytkownik dostaje 404 tak samo jak dla strony; PDF nie może zostać w pamięci pośredniej współdzielonej |
| Dane macierzy | kolumny `engine_from` i `engine_to` generowane z `report -> 'upgrade'` przebiegów `upgrade-check`; widok `latest_upgrade_runs` (`security_invoker`) z ostatnim przebiegiem na parę workflow i wersja docelowa | `ingest_run` zostaje bez zmian; widok z uprawnieniami wywołującego trzyma polityki RLS tabeli `runs` |
| Widoki macierzy | workspace: workflow w wierszach, wersje docelowe w kolumnach, komórka ze statusem i linkiem do przebiegu; organizacja: workspace'y w wierszach, komórka z liczbą workflow na status i kolorem najgorszego | agencja pyta najpierw, które instancje klientów mogą przejść na daną wersję, a dopiero potem, który workflow blokuje |
| Kolejność wersji | numery od najnowszej, potem nazwy (`next`, `v3-nightly`) alfabetycznie; kolumna po tagu obrazu | rejestr obrazu nie zmienia wersji n8n |
| Funkcje w planach | kolumny `pdf_export` i `drift_matrix` w `plans`, obie tylko w Agency; `org_plan` je zwraca | przesunięcie funkcji do Team to jedna instrukcja `update`, bez zmian w kodzie |
| Strona cennika | publiczna `/pricing`, plany czytane z tabeli `plans` kluczem anon, pięć pytań (co opuszcza maszynę, workspace, obniżenie planu, faktury i VAT, anulowanie); indeksowana, reszta aplikacji nie | strona nie obieca limitu innego niż ten, który egzekwuje baza |

## Czego tu nie ma

Macierz nie pokazuje workflow bez żadnego `upgrade-check` ani nie proponuje wersji do sprawdzenia; to zadanie runnera (`upgrade-check` dla wszystkich workflow projektu). Porównania dwóch przebiegów z planu (sekcja 11, przeglądarka raportu) nadal nie ma. Domeny, hostingu i regionu danych strona cennika nie wymienia, bo to otwarte decyzje założyciela.

## Skutki

- Pułapki react-pdf 4.9 są w `docs/rozwoj.md`: `lineHeight` ustawione na stronie usuwa tekst z `render` (numer strony), a taki tekst potrzebuje szerokości.
- `next.config.ts` wyłącza `@react-pdf/renderer` z bundlowania serwera i dołącza fonty do śledzenia plików trasy PDF; build to potwierdza w `.nft.json` trasy.
- Testy integracyjne, które kopiują wiersze `runs`, używają `insertableRun`, bo tabela ma już pięć kolumn generowanych.
