# Audyt tygodnia 14 (DPA, retencja, start sprzedaży)

Przegląd zmian od `aa29dd3` do `2140f25`, czyli tydzień 14 (`fa6c10e`) i trzy rzeczy dodane po nim: powiadomienia o zmianie podprocesorów (`6b8beee`), DPA po polsku (`2d179b6`) i okres próbny (`2140f25`). Sześć niezależnych przeglądów:

- migracje i baza;
- strona danych organizacji, w tym eksport i usuwanie;
- okres próbny w Stripe;
- teksty prawne i strony publiczne porównane z kodem;
- powiadomienia o podprocesorach i test obciążeniowy, razem z `notifyRun` i zmianą w CLI;
- zgodność z planem oraz pokrycie testami.

Znaleziska oznaczone „potwierdzone” sprawdzono skryptem na lokalnym stosie (Supabase na 553xx, własne serwery aplikacji na 3104 i 3106, własna atrapa Stripe na 55395) albo w dokumentacji Stripe. Te, które sprawdzono tylko czytaniem kodu, mają dopisek „niesprawdzone”. Skrypty leżą w katalogu tymczasowym sesji (`audit-db`, `audit-app`, `audit-stripe`, `audit-legal`, `audit-notices`, `audit-docs`). Dane testowe po skryptach usunięto.

Punkt wyjścia: `npm run verify` przechodzi (lint, type-check, testy: core 62, cli 33, web 48, proxy 15, services 8, schemas 4). `db-types --check` potwierdza, że `database.types.ts` zgadza się z bazą. Liczby testów w dzienniku są dokładne (48 jednostkowych i 62 integracyjne w `apps/web` po okresie próbnym).

Autoryzacja trzyma się wszędzie, gdzie ją sprawdzano: RLS na nowych tabelach, funkcje `security definer` z pustym `search_path`, trasa PDF-u filtruje po akceptacji i organizacji, eksport tylko dla właściciela, usuwanie przez klienta użytkownika i RLS. Najwięcej problemów jest w tekstach prawnych, które obiecują więcej niż kod, i w wysyłce powiadomień.

## P0: obietnica prawna niezgodna z kodem, dotyczy danych klientów

| # | Problem | Miejsce | Stan |
|---|---|---|---|
| 1 | DPA, cennik i strona główna obiecują, że każda wartość jest wysyłana jako typ, długość i hash, że wartości „never uploaded in clear text” (Załącznik 1, kategorie szczególne) i że serwis odrzuca raport z wartościami. Kod zostawia liczby poniżej miliona, `true`/`false` i `null` bez zmian, a segment ścieżki bez spacji, `@` i 7 cyfr zostaje dosłownie. ADR 0012 to przyznaje, nowe teksty już nie. Potwierdzone: raport z `/contacts/jan-kowalski`, `{age: 34, diabetic: true}` i zmianą `34→35` przeszedł `redactionProblems` bez uwag. Poprawka w tekście (opisać, co zostaje czytelne) albo w kodzie (kształt dla każdej liczby i wartości logicznej). | `lib/legal/documents.ts:145,175,251,264`, `lib/legal/dpa-pl.ts:12,118,131`, `app/pricing/page.tsx:32`, `app/page.tsx:115`; `core/src/redact.ts:25-27,67-80` | poprawione w tekstach (ADR 0018) |

## P1: baza i uprawnienia

| # | Problem | Miejsce | Stan |
|---|---|---|---|
| 2 | Blokada akceptacji wersji roboczej DPA działa tylko w akcji serwera. `accept_dpa` sprawdza tylko, czy wersja wygląda jak data. Właściciel woła `rpc('accept_dpa')` kluczem anon i własnym JWT, zapisuje akceptację tekstu, którego prawnik nie widział, albo wersji `2099-99-99` (PDF daje wtedy 410). Wiersza nie da się potem poprawić ani usunąć, a organizacja trafia do odbiorców powiadomień. ADR 0015 pisze, że taka akceptacja „jest odrzucana”. Potwierdzone przez trzy przeglądy. | `migrations/20270104000000_data_retention_dpa.sql:23,40-67`, `app/(app)/o/[orgId]/data/actions.ts:42-56` | poprawione (ADR 0018) |
| 3 | Konto usunięte, e-mail zostaje. `auth.audit_log_entries` w Supabase trzyma `actor_username`, a zdarzenie `user_deleted` zapisuje adres. Nic tej tabeli nie czyści, strona retencji jej nie wymienia, a obiecuje e-mail „until the account is deleted”. Potwierdzone: 884 wiersze usuniętych użytkowników z adresami w lokalnej bazie. | `lib/legal/documents.ts:100-103,343` | poprawione: 30 dni w `purge_expired_runs`, do sprawdzenia na projekcie w chmurze |

## P1: powiadomienia o zmianie podprocesorów

| # | Problem | Miejsce | Stan |
|---|---|---|---|
| 4 | Wysyłka może zapisać mail jako doręczony, choć nikt go nie dostał, i nigdy go nie ponowi. Skrypt uzupełnia brakujące zmienne z `apps/web/.env.local`. Uruchomiony na produkcji z samym adresem Supabase i kluczem serwisowym weźmie `MAILPIT_URL` z pliku, a bez żadnego transportu `sendMail` zwraca `ok: true` (transport „log”). Kolejne uruchomienie pomija wszystkich jako „already had it”. Z tego samego pliku przychodzi `APP_URL=http://127.0.0.1:3100`, więc link w prawdziwym mailu prowadzi na localhost. Potwierdzone. | `scripts/subprocessor-notice.ts:20-26,32`, `lib/subprocessor-notices.ts:139-144`, `lib/mail.ts:57-58` | poprawione |
| 5 | 30 dni liczy się od zapisu ogłoszenia, nie od maila. `sendNotice` nie sprawdza, ile zostało do zmiany: wysyłka w dniu 20 daje klientom 10 dni, działa nawet po dacie zmiany. Warunek w bazie porównuje daty, więc ogłoszenie z 23:59 UTC i zmianą za 30 dat to około 29 dni. `announced_at` da się też ustawić wstecz kluczem serwisowym. DPA punkt 6 obiecuje mail „at least 30 days before”. Potwierdzone: ogłoszenie z datą zmiany miesiąc temu wysłało 24 maile. | `migrations/20270111000000_subprocessor_notices.sql:13`, `lib/subprocessor-notices.ts:110-146` | poprawione |
| 6 | Powiadomienia dostają tylko organizacje z akceptacją DPA. Regulamin (punkt 4) włącza DPA do umowy każdej organizacji, a DPA obiecuje mail do właścicieli „the organization”. Organizacja, która nie kliknęła akceptacji, nie dowie się o zmianie. Potwierdzone w kodzie. | `migrations/20270111000000_subprocessor_notices.sql:37-47`, `lib/legal/documents.ts:199,438` | poprawione: odbiorcy to właściciele wszystkich organizacji |

## P1: eksport danych

| # | Problem | Miejsce | Stan |
|---|---|---|---|
| 7 | Eksport ucina każdą tabelę poza przebiegami na 1000 wierszach (`max_rows` PostgREST), bez błędu i bez znaku w pliku. Organizacja Agency z 1100 akceptacjami (nie są czyszczone) dostaje 1000. Strona obiecuje „Everything the service keeps”. Potwierdzone: `acceptance lines 1000 of 1100; workflow lines 1000 of 1051`. | `app/(app)/o/[orgId]/export/route.ts:34-51` | otwarte |
| 8 | Około 250 workspace'ów i eksport się urywa, a strona Data daje 500. Każde `.in('workspace_id', wsIds)` wkłada wszystkie UUID do adresu (`URI too long`). Agency nie ma limitu workspace'ów. Przy 200 jeszcze działa. Potwierdzone. | `export/route.ts:43-57`, `lib/data.ts` (`getOrganizationData`, liczba przebiegów) | otwarte |

## P1: okres próbny i płatności

| # | Problem | Miejsce | Stan |
|---|---|---|---|
| 9 | Dwa Checkouty otwarte przed pierwszą synchronizacją dostają oba okres próbny. Właściciel płaci w dwóch kartach: powstają dwie subskrypcje `trialing` na 0 EUR i obie obciążają kartę po 14 dniach (Team i Agency). Bez okresu próbnego podwójna opłata była widać od razu. Po anulowaniu pierwszej organizacja przechodzi na drugą, nadal w okresie próbnym. Potwierdzone na atrapie. Propozycja: drugą żywą subskrypcję w `trialing` anulować od razu (nic jeszcze nie pobrano) albo wygaszać pozostałe sesje po zakończeniu jednej. | `lib/plan-change.ts:31-33,80`, `lib/billing.ts:38-42,65-66` | otwarte |
| 10 | VAT. Cennik i regulamin piszą „Prices exclude VAT” i o odwrotnym obciążeniu w UE, a domyślnie VAT nie jest naliczany: ceny mają `tax_behavior: exclusive`, `automatic_tax` jest włączone tylko przy `STRIPE_AUTOMATIC_TAX=true`. Odwrotne obciążenie nie dotyczy polskiego klienta polskiego dostawcy. Strona Billing podaje „charged 79 EUR a month” bez VAT (przy podatku to 97,17 EUR), strona główna nie ma „excl. VAT”. Potwierdzone dla konfiguracji domyślnej. | `app/pricing/page.tsx:161,206`, `lib/legal/documents.ts:429`, `lib/stripe.ts:236`, `billing/page.tsx:38,76`, `app/page.tsx:92` | poprawione: teksty, strona Billing, Checkout na kluczu produkcyjnym wymaga decyzji o VAT |

## P1: teksty prawne

| # | Problem | Miejsce | Stan |
|---|---|---|---|
| 11 | Nikt nie akceptuje regulaminu. Na `/login` (tam powstaje konto), przy zakładaniu organizacji i w Checkoucie nie ma linku do regulaminu ani do informacji o prywatności; Checkout nie ma `consent_collection`. Limit odpowiedzialności, zwroty i punkt 3 o okresie próbnym opierają się na regulaminie. Potwierdzone. | `app/login/page.tsx:16`, `lib/stripe.ts:213-238` | otwarte |
| 12 | DPA pisze, że autorzy commitów pojawiają się „only as a repository name, commit hash and pull request number”. Raport niesie też `git.ref` (nazwę gałęzi, cennik sam o niej pisze), a `github_installations.account_login` (login GitHuba) nie jest wymieniony w punkcie 3. Potwierdzone. | `lib/legal/documents.ts:176,249-250`, `dpa-pl.ts:43,116`; `schemas/src/index.ts:208-215` | poprawione |
| 13 | Brak postanowienia o usunięciu albo zwrocie danych po zakończeniu usługi (art. 28 ust. 3 lit. g). Załącznik 1 mówi „the term of the Terms of Service plus section 10”, regulamin nie ma okresu obowiązywania ani wypowiedzenia, punkt 10 dotyczy tylko usunięcia organizacji przez klienta. Porzucona organizacja Free trzyma członków i akceptacje bez końca. Potwierdzone w tekście i w `purge_expired_runs`. | `lib/legal/documents.ts:248,406-467` | tekst dopisany (regulamin punkt 9, DPA punkt 10); porzucone organizacje Free to pytanie do prawnika |
| 14 | Transfery do USA. Załącznik 3 wymienia Supabase Inc., Vercel Inc. i Resend Inc. jako „EU” bez podstawy transferu; SCC ma tylko Stripe. Punkt 7 obiecuje transfer tylko na podstawie decyzji o adekwatności albo SCC. Potwierdzone w tekście. | `lib/legal/documents.ts:56-58,206` | tekst dopisany; do sprawdzenia przez prawnika |

## P1: plan i testy

| # | Problem | Miejsce | Stan |
|---|---|---|---|
| 15 | Lista blokad w `docs/sprzedaz.md` pomija fakturowanie w Polsce: KSeF (obowiązkowy od 2026, faktury Stripe przez niego nie przechodzą), fakturę za wdrożenie 1000 do 2500 EUR (pewnie pierwsza faktura, liczy się na bramce 5) i sposób na „6 miesięcy Team w cenie” (kupon Stripe, procedura niezapisana). Do potwierdzenia z księgową. | `docs/sprzedaz.md:3,11,25`, ADR 0010 | na liście założyciela w `docs/sprzedaz.md` |
| 16 | Usuwanie konta nie ma testu integracyjnego. Akcja działa kluczem serwisowym, omija RLS, usuwa organizacje i woła `auth.admin.deleteUser`. Test jednostkowy sprawdza tylko reguły w `accountDeletionPlan`. | `app/(app)/account/actions.ts:15-44` | otwarte |

## P2

| # | Problem | Miejsce | Stan |
|---|---|---|---|
| 17 | Dwa równoległe `send` wysyłają każdy mail dwa razy (potwierdzone: 48 wysyłek na 24 odbiorców). Nie ma blokady ani klucza idempotencji Resend; timeout przy przyjętym mailu kończy się ponowną wysyłką. | `lib/subprocessor-notices.ts:126-141` | poprawione |
| 18 | Odbiorcy i rejestr wysyłki czytane przez PostgREST, limit 1000 wierszy. Powyżej 1000 właścicieli reszta nie dostaje maila, powyżej 1000 wpisów w rejestrze część dostaje drugi raz. Niesprawdzone powyżej 1000. | `lib/subprocessor-notices.ts:127-128` | poprawione |
| 19 | Ogłoszenia można zmienić i usunąć kluczem serwisowym po wysyłce. Usunięcie kasuje kaskadą rejestr wysyłki, czyli dowód doręczenia. Baza nie sprawdza elementów `changes` (`[1,"x",{}]` przeszło, strona `/legal/subprocessors` by na tym padła). Potwierdzone. | `migrations/20270111000000_subprocessor_notices.sql:5-14` | poprawione |
| 20 | Odbiorcy biorą `members.email`, odświeżany tylko przy logowaniu, zamiast adresu z `auth.users` (`run_recipients` używa `coalesce(u.email, m.email)`). Niesprawdzone. | `migrations/20270111000000_subprocessor_notices.sql:37-46` | poprawione |
| 21 | Wygasłe zaproszenie działa do nocnego czyszczenia: liczy się do miejsc w planie, widać je jako oczekujące, blokuje ponowne zaproszenie tego adresu. Podobnie okresy na stronie retencji (1 dzień, 2 dni, 30 dni) są minimalne, bo czyszczenie działa raz na dobę. Potwierdzone. | `20261230000000_audit_p2.sql` (`org_plan`), `lib/data.ts:79`, `documents.ts:96,106` | poprawione |
| 22 | `dpa_acceptances` nie ma unikalności na organizację i wersję; podwójne kliknięcie albo dwóch właścicieli naraz daje dwa wiersze. Literówki w nazwie firmy nie da się poprawić, bo formularz znika po akceptacji. Potwierdzone. | `migrations/20270104000000_data_retention_dpa.sql:20-33`, `data/page.tsx:18,94` | poprawione: podwójne kliknięcie zwraca ten sam wiersz, poprawka to nowa akceptacja |
| 23 | PDF starej akceptacji nie jest zamrożony: rysuje dzisiejsze dane `LEGAL_*` i dzisiejszą flagę wersji roboczej. Akceptacja wersji roboczej wydrukuje się później bez baneru, jeśli data wersji się nie zmieni. Potwierdzone. | `dpa/[acceptanceId]/pdf/route.ts:25,29` | poprawione |
| 24 | Nazwa firmy z emoji albo znakami CJK drukuje się w PDF jako śmieci (Inter nie ma glifów). Polskie znaki działają. Potwierdzone. | `lib/pdf/dpa-pdf.ts:124` | poprawione: walidacja znaków w formularzu |
| 25 | Eksport urwany przez `maxDuration = 300` albo brak pamięci wygląda na kompletny: nie ma wiersza końcowego. Strona 20 dużych przebiegów podniosła pamięć procesu ze 152 do 467 MB, komentarz mówi o „kilkudziesięciu”. Przy 5,4 MB/s powyżej około 1,6 GB raportów eksport się nie zmieści. | `export/route.ts:10,53-86` | otwarte |
| 26 | Eksport pomija część danych: wpisy organizacji w `subprocessor_notice_deliveries`, `upload_events`, kolumny `trial_end`, `first_subscription_at`, `previous_plan`, `plan_changed_at`. | `export/route.ts:38` | otwarte |
| 27 | Po usunięciu konta właściciela klient Stripe organizacji nadal ma jego e-mail; faktury idą na adres usuniętej osoby. Niesprawdzone. | `app/(app)/account/actions.ts:15-42`, `lib/stripe.ts:195-200` | otwarte |
| 28 | Maile usuniętych osób zostają w `acceptances.accepted_by_email`, `dpa_acceptances.signer_email`, `notification_log.recipient`; rejestr wysyłki powiadomień przeżywa usunięcie organizacji o rok, choć punkt 10 DPA mówi „removed from the live database at once”. Strona retencji pisze, że usunięcie organizacji jest odrzucane „until the subscription is cancelled”, a kod pozwala już przy zaplanowanym anulowaniu. | `documents.ts:225,341`, `data/actions.ts:79`, `lib/account.ts:160` | otwarte |
| 29 | Okres próbny: `customer.subscription.trial_will_end` obsłużone, ale nie ma go w `WEBHOOK_EVENTS`, więc Stripe go nie wyśle (ADR 0017 pisze, że dodane). `STRIPE_TRIAL_DAYS` z błędną wartością (`off`, `-1`, `120`) daje 14 dni zamiast wyłączenia. Data pierwszego obciążenia w komunikacie zmiany planu jest w UTC bez oznaczenia. `billing_mode` nie jest przypięty do `flexible` (domyślny w `2026-02-25.clover`, ale atrapa zakłada zachowanie flexible). | `scripts/stripe-setup.mjs:31-46`, `lib/stripe.ts:38-43`, `lib/plan-change.ts:28,68` | otwarte |
| 30 | Okres próbny z kartą, która przejdzie weryfikację i odrzuci obciążenie, daje 14 dni i cały okres ponawiania planu płatnego za darmo (`past_due` daje plan). Zależy od ustawienia ponawiania na „cancel” w Stripe (lista w ADR 0010). Uzupełnienie `first_subscription_at` w migracji pomija organizacje po ścieżce „usunięty klient Stripe”; flagę ustawia tylko kod aplikacji. | `lib/stripe.ts:220`, `migrations/20270118000000_trial.sql:12`, `lib/plan-change.ts:91` | flaga okresu próbnego w wyzwalaczu; `past_due` po okresie próbnym zależy od ustawienia ponawiania w Stripe (ADR 0010) |
| 31 | Test obciążeniowy: scenariusz „zły token” wysyła token o złej długości, więc mierzy odrzucenie po formacie, nie wywołanie bazy. Brak blokady przed produkcją (adres z środowiska), sprzątanie w `finally` nie działa po Ctrl+C (zostają organizacje z fałszywym Agency). p95 przy n=5 to maksimum. | `scripts/load-upload.ts:30-46,131-134,248,257-261` | otwarte |
| 32 | Zerwane połączenia przy złym tokenie i dużym ciele nadal zdarzają się na serwerze (1 na 200 w powtórzeniu); poprawka tygodnia 14 jest tylko w CLI. Wiersz „200 × 401” w ADR 0015 czyta się tak, jakby problem zniknął. Liczby w dzienniku („31 do 47 uploadów na sekundę”) nie zgadzają się z tabelą ADR (31,1 do 33,3); pomiary walidacji i `ingest_run` z ADR 0015 nie pochodzą ze skryptu. | `app/api/runs/route.ts:22-24`, ADR 0015:37-62, `dziennik.md:266` | otwarte |
| 33 | `notifyRun` po nieudanym drugim odczycie raportu pomija Check GitHuba bez wpisu w `github_checks` i bez logu. | `lib/notify-run.ts:94-95` | otwarte |
| 34 | Braki w testach: usuwanie przebiegu (nic), usuwanie workspace'u i organizacji przez właściciela, `makeOwner` tylko po stronie bazy, eksport i PDF tylko na Agency (ADR obiecuje każdy plan), stronicowanie eksportu powyżej 20 przebiegów, PDF sprawdza tylko `%PDF-`, trasa 410 bez testu. | `test/integration/data-retention.test.ts` | otwarte |
| 35 | Drobne w interfejsie: `setRetention` pisze „deleted tonight” także wtedy, gdy krótszy okres planu i tak wygrywa; `makeOwner` nie pokazuje błędu; `/legal/subprocessors` daje 500, gdy Supabase nie odpowiada; `DraftNotice` pisze „company details are not filled in”, gdy brakuje tylko `LEGAL_FINAL`; cennik pisze „salted hash”, DPA „keyed hash”. | `data/actions.ts:34`, `(app)/actions.ts:173-178`, `legal/[doc]/page.tsx:63-68`, `components/legal.tsx:177` | otwarte |
| 36 | Polski DPA: „dalszego podmiotu” bez „przetwarzającego” (punkt 7), „zmienionym” słabsze niż „replaced” (punkt 6), „Klient nie umieszcza” słabsze niż „must not” (punkt 3), odwołanie do „Regulaminu”, który jest tylko po angielsku. Liczby i terminy w obu wersjach się zgadzają. | `lib/legal/dpa-pl.ts:73` | poprawione |
| 37 | Informacja o prywatności nie wspomina o transferze do Stripe Inc., o prawie do przenoszenia danych, o danych osób akceptujących DPA i rejestrze powiadomień ani o czasie trzymania logów hostingu. Regulamin obiecuje mail 30 dni przed zmianą warunków i przed usunięciem płatnej funkcji; nie ma na to mechanizmu, zostaje ręczna wysyłka. | `lib/legal/documents.ts:352-404` | poprawione w tekstach; wysyłka zmian regulaminu zostaje ręczna |
| 38 | Dokumentacja: dziennik mówi, że przyjęto ogłoszenie „za 31 dni”, ADR 0016 że za 30 (baza przyjmuje 30); `LEGAL_ALLOW_DRAFT_ACCEPTANCE` jest w `.env.example` tylko w komentarzu; `db:env` wpisuje je do `.env.local`, więc `next start` z kopii deweloperskiej na własnym serwerze otwiera akceptację wersji roboczej; jedno trafienie filtra markerów AI w `docs/rozwoj.md:51` (trójka). | `dziennik.md:288`, ADR 0016:28, `scripts/env-local.mjs:17` | blokada wersji roboczej poza localhost poprawiona; reszta otwarta |
| 39 | Link „GitHub” w nagłówku i przycisk na stronie głównej prowadzą do `github.com/skynappse/flowretest`, które nie istnieje (repozytorium jest pod `kotowskis/FlowRetest`). To nazwa z planu, więc założenie repozytorium trzeba dopisać do listy w `docs/sprzedaz.md`. | `components/public-shell.tsx:4`, `packages/cli/package.json:45` | na liście założyciela w `docs/sprzedaz.md` |

## Pytania do prawnika (ocena prawna, nie błędy)

- DPA punkt 6 mówi, że GitHub i Slack nie są podprocesorami, a GitHub App dostawcy wysyła do GitHuba (USA) raport po redakcji.
- Dane konta i logowania są w DPA danymi przetwarzanymi dla klienta, a w informacji o prywatności dostawca jest ich administratorem.
- Brak wprost zapisanego art. 28 ust. 4 (odpowiedzialność za dalszych podmiotów przetwarzających), art. 28 ust. 3 lit. a (przetwarzanie tylko na udokumentowane polecenie, z wyjątkiem obowiązku prawnego i uprzedzeniem o nim) i lit. f (pomoc przy art. 32 i 34).
- Czy 48 godzin na zgłoszenie naruszenia i warunki audytu (raz w roku, na koszt klienta, najpierw dokumenty) wystarczą.
- Czy dowód akceptacji DPA powinien przeżyć usunięcie organizacji (rozliczalność); dziś znika razem z nią.
- Czy klauzula o rozstrzygającej wersji angielskiej utrzyma się wobec polskiego klienta.
- Limit odpowiedzialności równy 12 miesiącom opłat to 0 na planie Free; usługa jest tylko B2B, ale nic tego nie sprawdza.
- Faktury trzymane 5 lat, gdy kopie znikają z organizacją, a dostawca polega na Stripe.

## Co jest w porządku

- Retencja bierze krótszy z okresów planu i organizacji. Po obniżeniu planu działa 30 dni łaski, `NULL` oznacza okres planu, granice są liczone bez błędu o jeden dzień.
- Okresy planów zgadzają się ze stroną retencji (Free 14 dni, Team 90, Agency 365). Ceny zgadzają się z cennikiem: 79 i 199 EUR miesięcznie, 758,40 i 1910,40 EUR rocznie.
- Zaproszenia starsze niż 30 dni `claim_invitations` pomija i usuwa.
- `dpa_acceptances`: anon nic, członek tylko czyta, właściciel akceptuje przez funkcję, e-mail z sesji, wierszy nie da się edytować.
- Trasa PDF filtruje po akceptacji i organizacji (404 dla cudzej), nazwa pliku w `Content-Disposition` jest bezpieczna, czcionki są w śladzie builda.
- Eksport: tylko właściciel (członek 403, obcy 404), bez hashy tokenów i adresów webhooków Slacka. Identyfikatorów Stripe też nie ma.
- Usuwanie konta: reguły sprawdzone przed usunięciem, te same statusy co wyzwalacz przy usuwaniu organizacji, sesja przestaje działać od razu.
- Okres próbny: `trialing` daje pełny plan, zmiana planu w trakcie nic nie pobiera i zachowuje datę końca, anulowanie w portalu działa, koniec bez płatności przenosi na Free bez kasowania historii. Poprawki audytu z tygodni 9 do 13 dotyczące Stripe działają dalej.
- Treść maili o podprocesorach jest escapowana, ponowienie wysyła tylko nieudane, odbiorcy liczeni w chwili wysyłki.
- CLI nie powtarza uploadu po zerwanym połączeniu, token idzie tylko w nagłówku.
- EN i PL DPA zgadzają się co do liczb i terminów, oba mają punkt 12; bez `LEGAL_*` strony pokazują zaślepki, nie „undefined”; `/legal/unknown` daje 404; brak analityki i ciasteczek na stronach publicznych.
- CI wgrywa migracje przed testami integracyjnymi i uruchamia `db-types --check`.

## Proponowana kolejność napraw

1. Teksty prawne i cennik: punkty 1 i 12, VAT z punktu 10 (w tekstach i na stronie Billing) oraz punkt 6 (zmiana tekstu albo odbiorcy bez warunku akceptacji). Zmiany trafią do `documents.ts` i `dpa-pl.ts` oraz na strony publiczne, a wersja DPA dostanie nową datę.
2. Baza: punkt 2 (wersje DPA w tabeli sprawdzanej w `accept_dpa`), 5 (warunek 31 dni i odmowa wysyłki, gdy zostało mniej niż 30), 19, 22.
3. Wysyłka powiadomień: punkt 4 (bez `.env.local` dla produkcji, błąd przy braku transportu, `APP_URL` wymagany), 17, 18.
4. Eksport: punkty 7, 8, 25 (stronicowanie każdej tabeli, zapytania przez złączenie zamiast listy UUID, wiersz końcowy).
5. Stripe: punkt 9, potem 29.
6. Punkt 11 (akceptacja regulaminu przy zakładaniu konta albo `consent_collection` w Checkoucie) i 3 (czyszczenie `auth.audit_log_entries` w `purge_expired_runs` albo wpis na stronie retencji).
7. Testy z punktów 16 i 34, reszta P2.

Punkty 13, 14, 15 i pytania do prawnika idą na listę założyciela w `docs/sprzedaz.md`, razem z repozytorium z punktu 39.
