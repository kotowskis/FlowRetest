# ADR 0013. Poprawki P1 z audytu warstwy płatnej

Data: 2026-09-25. Status: przyjęte.

## Kontekst

Po poprawkach P0 (ADR 0012) zostało 19 punktów P1 z `docs/audyt-2026-09-25.md`: autoryzacja i API, Stripe, `sync`, PDF, macierz dryfu i dwa braki względem planu. Zmiany w bazie są w migracji `20261229000000_audit_p1.sql`. Ten dokument zapisuje decyzje, które nie wynikają wprost z kodu.

## Decyzje

| # | Temat | Decyzja | Powód |
|---|---|---|---|
| 9 | Adres po logowaniu | `safeNext` rozwiązuje `next` względem stałego originu, odrzuca znaki sterujące i ukośnik wsteczny, zwraca tylko ścieżkę, zapytanie i kotwicę | przeglądarka usuwa tabulatory i czyta `\` jak `/`, więc sprawdzanie prefiksów nie wystarczało |
| 10 | Upload | najpierw token (`token_workspace`), potem ciało czytane strumieniem z licznikiem bajtów; to samo w `/api/acceptances/<id>/applied` (64 KB) | żądanie chunked nie ma `Content-Length`, a bez ważnego tokenu serwer nie powinien niczego parsować |
| 11 | Limity logowania | tabela `sign_in_attempts` i funkcja `note_sign_in_attempt`: w 15 minut adres dostaje 5 kodów i 10 prób wpisania, klient (IP z `x-forwarded-for`) 20 kodów i 50 prób; limity Supabase Auth podniesione w `config.toml` | Auth widzi adres serwera Next dla wszystkich, więc jego limity na IP blokowały wszystkich naraz; błąd bazy przepuszcza próbę, żeby awaria nie blokowała logowania |
| 12 | Właściciel | odroczony wyzwalacz na `members`: organizacja, która istnieje, musi mieć właściciela w chwili zatwierdzenia transakcji | przekazanie roli w dwóch zapytaniach i usunięcie całej organizacji działają; odejście ostatniego właściciela nie |
| 13 | Pusty raport | 422 dla raportu bez przypadków | nic nie przetestowano, a zapisany dawałby PASS i zielony Check |
| 14 | Plan Free | webhook Slacka i podpięcie GitHuba odrzucane od razu przy Free | wcześniej konfiguracja wyglądała na udaną, a nic nie wychodziło |
| 16 | Anulowanie w trybie `flexible` | kolumna `billing_accounts.cancel_at` z `cancel_at` subskrypcji albo z końca okresu przy `cancel_at_period_end`; strona Billing, blokada usunięcia organizacji i zmiana planu czytają to pole | portal w trybie `flexible` ustawia tylko `cancel_at` |
| 16, 17 | Zmiana planu przy subskrypcji w złym stanie | przy `unpaid`, `paused`, `incomplete`, `past_due` i przy zaplanowanym końcu zmiana planu jest odrzucana z odesłaniem do portalu | drugi Checkout zakładał drugą subskrypcję, a zmiana ceny po cichu cofała zaplanowany koniec |
| 18 | Dwie żywe subskrypcje | gdy śledzona przestaje dawać plan, synchronizacja szuka innej żywej subskrypcji klienta i ją przejmuje | organizacja płacąca za drugą subskrypcję nie spada na Free |
| 19 | Zapis klienta Stripe | błąd zapisu `billing_accounts` przerywa zmianę planu; webhook Checkoutu przypisuje nieznanego klienta do organizacji z `client_reference_id`, jeśli ta nie ma jeszcze klienta | zapłacony Checkout zawsze trafia do organizacji |
| 20 | Atrapa i testy | logika zmiany planu w `lib/plan-change.ts` (akcja serwera tylko sprawdza właściciela i przekierowuje); atrapa zna `cancel_at`, nieudane płatności z `pending_update`, listę subskrypcji, konflikt klucza idempotencji; test `plan-change.test.ts` przechodzi przez tę samą ścieżkę co przycisk | wcześniej test sam zakładał klienta i sesję, więc `choosePlan` nie był sprawdzany |
| 21 | `sync` | przypadki porównywane po pełnej ścieżce pliku; akceptacja bez zapisanego baseline'u zostaje oczekująca; 409 znaczy „zastosowane gdzie indziej”; nazwa przebiegu z serwera musi wyglądać jak nazwa katalogu | przypadek 1 był znajdowany w `11.json`, a pusta akceptacja znikała z listy na zawsze |
| 22, 23 | PDF | limit 150 pól na wywołanie z pierwszeństwem pól zmienionych; limit 400 wierszy na dokument (około 6 s renderowania), dalej liczby pominiętych wywołań; `maxDuration` 60 s | react-pdf potrzebuje około 15 ms na wiersz; raport do 5 MB dawał minuty renderowania |
| 24 | Macierz dryfu | komórka to najnowszy przebieg na parę workflow i tag (`latestPerTag`), bez względu na rejestr obrazu; widok rozstrzyga remis po `id`; obraz bez tagu to `latest` | `n8nio/n8n:2.41.0` i `docker.n8n.io/n8nio/n8n:2.41.0` dawały dwie komórki w jednej kolumnie |
| 25 | Porównanie przebiegów | strona `/w/<ws>/workflows/<wf>/compare?a=&b=`: nagłówki obu przebiegów, przypadki różniące się statusem albo wywołaniami, link „vs previous” w historii | brak z planu (sekcja 11); porównanie liczone z raportów po redakcji (`lib/compare-runs.ts`) |
| 26 | Wersja workflow | runner zapisuje `versions` w `report.json`, raport po redakcji niesie `workflowVersionId` nowej wersji; `runs.workflow_version_id` (kolumna generowana), `acceptances.workflow_version_id` z `accept_run`; `sync` nie zapisze baseline'u z lokalnego przebiegu innej wersji; wersja widoczna na stronie przebiegu, w historii akceptacji i w PDF | brak z planu (sekcja 11); nazwa katalogu przebiegu to tylko znacznik czasu |
| 27 | CI | `mustRun` w testach integracyjnych: przy `CI` brak Supabase, aplikacji albo atrapy to błąd, nie pominięcie | job mógł być zielony bez żadnego testu integracyjnego |

## Przy okazji

Poprawione drobne punkty P2 z tego samego kodu: `sync` odrzuca nazwę przebiegu z `..`, klient `cloud.ts` wymaga https (http tylko dla localhost), odrzuca adres z użytkownikiem lub hasłem i traktuje odpowiedź 200 bez JSON jako błąd; schemat nie przyjmuje numeru PR powyżej zakresu `integer`; strona po płatności pyta Stripe dopiero po sprawdzeniu członkostwa; portal Stripe bez obsługi błędu wraca na stronę Billing z komunikatem; PDF podaje digest obrazu silnika; `.env.example` wymienia zmienne GitHub App, Slacka i `STRIPE_API_URL`; `stripe-setup.mjs` nie zakłada drugiego produktu dla planu.

## Po stronie założyciela

- W projekcie Supabase w chmurze ustawić te same limity Auth co w `config.toml` (`sign_in_sign_ups`, `token_verifications`, `token_refresh`) i upewnić się, że hosting ustawia `x-forwarded-for` z adresem klienta. Bez tego limit na klienta liczy wszystkich razem.
- W Stripe włączyć w portalu klienta zmianę karty i opłacanie faktur; odmowy zmiany planu odsyłają właśnie tam.

## Skutki

- Raporty z CLI starszego niż ta zmiana nie mają `workflowVersionId`; akceptacje z nich zapisują `null`, a `sync` ich nie sprawdza.
- Dołożenie funkcji do migracji, która jest już wgrana lokalnie, wymaga wgrania dopisanej części ręcznie (`psql`), bo `migration up` pomija zastosowane pliki; CI zawsze stawia bazę od zera.
