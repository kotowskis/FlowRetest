# ADR 0015. DPA, polityka retencji, testy obciążeniowe uploadu, strony do startu sprzedaży

Data: 2026-09-25. Status: przyjęte, teksty prawne czekają na prawnika.

## Kontekst

Tydzień 14 planu (sekcja 11) obejmuje dokument powierzenia danych (DPA) z polityką retencji, testy obciążeniowe uploadu oraz start sprzedaży. Opinia prawnika o umowie powierzenia miała być zamówiona w tygodniu 6 i jej nie ma. Otwarte decyzje założyciela to nadal dane firmy oraz domena z hostingiem i pocztą (ADR 0008, 0010). Przed tym tygodniem interfejs nie pozwalał wyeksportować danych ani niczego usunąć, choć baza na to pozwalała przez RLS. DPA bez tych funkcji obiecywałby coś, czego nie da się wykonać.

## Decyzje

| Temat | Decyzja | Powód |
|---|---|---|
| Teksty prawne | pięć stron `/legal/{terms,privacy,dpa,subprocessors,retention}` po angielsku, treść jako dane w `lib/legal/documents.ts`, jedna funkcja na dokument | ta sama treść idzie na stronę i do PDF kopii DPA; test jednostkowy sprawdza brak długich myślników, wypełnione dane firmy i zgodność listy podprocesorów w DPA i na stronie |
| Dane firmy | zmienne `LEGAL_NAME`, `LEGAL_ADDRESS`, `LEGAL_COMPANY_ID`, `LEGAL_EMAIL`; bez nich albo bez `LEGAL_FINAL=true` strony mają baner „Draft” i nie są indeksowane | dane firmy żyją obok kluczy Stripe, a nie w kodzie; baner znika dopiero po decyzji, że teksty są po przeglądzie |
| Akceptacja DPA | właściciel organizacji wpisuje firmę, adres, numer rejestrowy (opcjonalnie), swoje imię i nazwisko oraz rolę i zaznacza umocowanie; `accept_dpa` zapisuje wiersz z wersją i adresem e-mail z sesji; wiersze bez `update` i `delete` | rekord pokazuje, kto, kiedy i w czyim imieniu przyjął którą wersję; e-mail z sesji, nie z formularza |
| Wersje DPA | `DPA_VERSION` to data; każda przyjęta wersja zostaje w `DPA_TEXTS`, więc PDF starej akceptacji drukuje tekst, który wtedy przyjęto; nieznana wersja daje 410 | zmiana tekstu nie może zmienić treści już podpisanej umowy |
| Wersja robocza | poza środowiskiem z `LEGAL_ALLOW_DRAFT_ACCEPTANCE=true` (lokalnie i w CI, wpisuje je `db:env`) akceptacja wersji roboczej jest odrzucana | klient nie może przyjąć tekstu, którego prawnik nie widział |
| PDF kopii | `GET /o/<org>/dpa/<id>/pdf` dla każdego członka i na każdym planie; pierwsza strona to strony umowy i rekord akceptacji, dalej pełny tekst | agencja przekazuje kopię swojemu klientowi albo audytorowi; RODO nie może być funkcją planu płatnego |
| Krótsza historia | `organizations.retention_days` (1 do 3650, puste = plan), zmienia tylko właściciel; nocne czyszczenie bierze krótszy z okresów planu (z okresem łaski) i organizacji | umowy klientów agencji często pozwalają na 30 dni; dłuższy okres niż plan niczego nie zmienia, bo za retencję płaci się planem |
| Zaproszenia | wygasają po 30 dniach: `claim_invitations` pomija starsze, nocne czyszczenie je usuwa | zaproszenie trzyma adres osoby, która nie założyła konta |
| Eksport | `GET /o/<org>/export`, tylko właściciele, każdy plan; JSON Lines strumieniowo, przebiegi stronami po 20 według `id`; odczyty przez RLS, dziennik powiadomień przez rolę serwisową tylko dla już odczytanych przebiegów; hashe tokenów nie wychodzą | rok przebiegów po 5 MB nie mieści się w pamięci funkcji; stronicowanie po kluczu nie gubi wierszy, gdy czyszczenie działa w trakcie |
| Usuwanie | przebieg (właściciel, akceptacje zostają bez linku), workspace i organizacja (właściciel, potwierdzenie przez wpisanie nazwy), konto (każdy, potwierdzenie adresem e-mail) | DPA (punkt 10) i polityka retencji obiecują usuwanie przez właściciela; baza już to dopuszczała przez RLS |
| Usunięcie konta | organizacje, w których osoba jest jedynym członkiem, znikają razem z kontem; jedyny właściciel organizacji z innymi członkami musi najpierw nadać komuś rolę właściciela; subskrypcja pobierająca opłaty blokuje; wszystko sprawdzane przed pierwszym usunięciem (`lib/account.ts`) | wyzwalacz `keep_an_owner` z audytu P1 i tak zatrzymałby usunięcie użytkownika; lepiej powiedzieć to przed usuwaniem niż zostawić połowę zmian |
| Nadanie roli | przycisk „Make owner” przy członkach | bez niego jedyny właściciel nie mógł przekazać organizacji ani usunąć konta |
| Podprocesorzy | Supabase (Frankfurt), Vercel (Frankfurt, sieć brzegowa globalnie), Resend (Irlandia), Stripe Payments Europe; lista w kodzie jako kandydaci | to typowy zestaw dla tego stosu, ale żaden z nich nie jest jeszcze wybrany; przed zdjęciem banera lista musi odpowiadać produkcji |
| Strona główna | `/` dla niezalogowanych pokazuje produkt (przykładowy plan z terminala, trzy kroki, `upgrade-check` przed n8n 3.0, warstwa płatna, oferta wdrożenia 1 000 do 2 500 EUR z Team na 6 miesięcy, co opuszcza maszynę); zalogowanych przekierowuje do `/orgs`; wspólny nagłówek i stopka z linkami prawnymi na wszystkich stronach publicznych | start sprzedaży potrzebuje adresu, pod który można wysłać agencję; oferta wdrożenia pochodzi z notatki decyzyjnej (sekcja 9) |
| Kontakt | `SALES_EMAIL`, inaczej `LEGAL_EMAIL`, inaczej brak linku | adres to decyzja założyciela |

## Testy obciążeniowe uploadu

Skrypt `apps/web/scripts/load-upload.ts` zakłada organizacje tymczasowe, wysyła raporty po redakcji jak `flowretest upload` i usuwa to, co założył. Raporty: mały 16 KB (3 przypadki, 3 wywołania, 8 pól), średni 149 KB, duży 4,5 MB (20 przypadków, 40 wywołań, 45 pól; limit uploadu to 5 MB). Pomiar na `next start` na Windows 11, Supabase w Docker Desktop, ta sama maszyna generuje ruch; inne aplikacje działały w tle, więc powtórzenia różnią się o około 30%.

Wynik końcowy (po poprawkach niżej), 8 organizacji na planie Agency, 30 s na poziom:

| Scenariusz | Równolegle | Żądań | req/s | p50 | p95 | Kody | RSS aplikacji |
|---|---|---|---|---|---|---|---|
| mieszany 3:1 mały i średni | 10 | 964 | 31,5 | 218 ms | 690 ms | 201 | 456 MB |
| mieszany | 25 | 955 | 31,1 | 817 ms | 1 468 ms | 201 | 463 MB |
| mieszany | 50 | 1 066 | 33,3 | 1 374 ms | 2 062 ms | 201 | 474 MB |
| jedna organizacja (macierz CI) | 20 | 100 | 22 | 825 ms | 1 522 ms | 201 | 454 MB |
| duży 4,5 MB | 1 | 5 | 0,5 | 2 094 ms | 2 169 ms | 201 | 507 MB |
| duży | 4 | 20 | 1,2 | 3 119 ms | 4 143 ms | 201 | 562 MB |
| duży | 8 | 40 | 1,8 | 4 032 ms | 7 295 ms | 201 | 594 MB |
| limit Free (50 na dobę) | 40 | 80 | 60 | 518 ms | 921 ms | 50 × 201, 30 × 429 | 559 MB |
| zły token, ciało 4,5 MB | 25 | 200 | 19,6 | 1 289 ms | 1 481 ms | 200 × 401 | 447 MB |

Co z tego wynika:

- Walidacja w Node jest tania: 0,5 ms na mały raport, 4 ms na średni, 107 ms na 4,5 MB (z czego 81 ms to `redactionProblems`).
- Sama baza (wywołanie `ingest_run` bez aplikacji) przyjmuje około 190 małych uploadów na sekundę przy 25 równoległych, więc przy małych raportach ogranicza aplikacja: jeden proces Node, dwa wywołania RPC na upload i pięć do sześciu zapytań w `notifyRun` po odpowiedzi.
- Duży raport to limit bazy: około 1,1 s na zapis 4,5 MB (PostgREST i JSONB) i najwyżej około 1,5 zapisu na sekundę na tym sprzęcie.
- Licznik dobowy jest dokładny pod współbieżnością: blokada doradcza organizacji w `ingest_run` przepuściła dokładnie 50 z 80 równoczesnych żądań.
- Spodziewany ruch po starcie to kilka uploadów na minutę, więc zapas jest ponad stukrotny. Optymalizacja `notifyRun` (jedno RPC zamiast pięciu zapytań) zostaje na czas, gdy pojawi się realny ruch.

Poprawki po pierwszym przebiegu:

| Problem | Pomiar przed | Poprawka | Po |
|---|---|---|---|
| `notifyRun` czytał z bazy cały raport po każdym uploadzie, także bez nikogo do powiadomienia | duży, 8 równolegle: p50 11,4 s, p95 20,6 s, 0,8 req/s | raport czytany tylko przed wysłaniem Checka do GitHuba | p50 3,4 do 4,0 s, p95 5,0 do 7,3 s, 1,8 do 2,2 req/s |
| przy złym tokenie i dużym ciele serwer odpowiada 401 przed przeczytaniem ciała, a klient czasem dostaje zerwane połączenie zamiast odpowiedzi | 14 z 200 żądań kończyło się błędem sieci | CLI po błędzie sieci przy żądaniu z ciałem pyta `GET /api/acceptances?workflow=-` tym samym tokenem i przy 401 zgłasza zły token (kod 4) | komunikat „the token is wrong or revoked” zamiast „request failed” |

Serwer nadal nie czyta ciała przy złym tokenie; Node odbiera resztę danych z gniazda, ale ich nie parsuje.

## Czego tu nie ma

Tekstów po przeglądzie prawnika. Numeru rejestrowego, adresu i e-maila firmy. Powiadamiania właścicieli mailem o zmianie podprocesora (DPA punkt 6) ani wersji DPA po polsku; obie rzeczy doszły w ADR 0016. Testów obciążeniowych na docelowym hostingu: liczby wyżej dotyczą jednej maszyny deweloperskiej.

## Lista dla założyciela przed zdjęciem banera

1. Prawnik czyta `/legal/dpa`, `/legal/terms`, `/legal/privacy` (lista pytań w `docs/sprzedaz.md`); zmiany w `lib/legal/documents.ts`, a po zmianie DPA nowa data w `DPA_VERSION` i stara funkcja zostaje w `DPA_TEXTS`.
2. Wybór hostingu i dostawcy poczty; lista `SUBPROCESSORS` ma odpowiadać produkcji, a regiony faktycznej konfiguracji (Supabase w eu-central-1, funkcje Vercel w fra1).
3. Potwierdzenie liczb, które teksty podają jako fakt: kopie zapasowe 7 dni (plan Supabase Pro), szyfrowanie w spoczynku, uwierzytelnianie dwuskładnikowe na kontach Supabase, hostingu, Stripe i GitHub.
4. Zmienne `LEGAL_NAME`, `LEGAL_ADDRESS`, `LEGAL_COMPANY_ID`, `LEGAL_EMAIL`, `SALES_EMAIL`, potem `LEGAL_FINAL=true`; bez `LEGAL_ALLOW_DRAFT_ACCEPTANCE` na produkcji.

## Skutki

- Każda zmiana czasu przechowywania czegokolwiek to zmiana w dwóch miejscach: w bazie (migracja, `purge_expired_runs`) i w `RETENTION_ROWS`. Test integracyjny pilnuje tylko okresów planów.
- Test jednostkowy odrzuca długi myślnik w tekstach prawnych, więc reguły filtra markerów AI obowiązują też je.
