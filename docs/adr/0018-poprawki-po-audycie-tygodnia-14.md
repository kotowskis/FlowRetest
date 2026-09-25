# ADR 0018. Poprawki po audycie tygodnia 14

Data: 2026-09-25. Status: przyjęte.

## Kontekst

Audyt tygodnia 14 (`docs/audyt-tydzien-14-2026-09-25.md`) znalazł 39 problemów. Najwięcej dotyczyło tekstów prawnych, które obiecywały więcej, niż robi kod, oraz wysyłki powiadomień o podprocesorach. Numery w tabeli to numery punktów audytu.

## Decyzje

| # | Temat | Decyzja | Powód |
|---|---|---|---|
| 1 | Redakcja w tekstach | teksty opisują to, co robi `core/redact.ts`: wartości tekstowe jako typ, długość i skrót, liczby poniżej miliona oraz `true`/`false`/`null` czytelne, `normalize.ignore` wyłącza pole z raportu; DPA zobowiązuje klienta do wpisania tam pól, które same ujawniłyby osobę albo szczególną kategorię danych; test jednostkowy porównuje tekst z `shapeOf` | zmiana kodu zabrałaby z raportu to, po co agencja go ogląda (kwota 100 zamiast 120, flaga, licznik); ADR 0012 już przyjął to ograniczenie |
| 10 | VAT | teksty mówią, że polska firma płaci polski VAT, a firma z innego kraju UE rozlicza odwrotne obciążenie; strona Billing pisze „plus VAT where due”; Checkout z kluczem `sk_live_` bez jawnego `STRIPE_AUTOMATIC_TAX` (`true` albo `false`) kończy się błędem | faktury bez VAT przy tekście „ceny netto” to błąd, którego nie widać, dopóki nie przyjdzie księgowa |
| 12 | Dane w DPA | punkt 3 i Załącznik 1 wymieniają nazwę gałęzi i nazwę konta GitHub podłączonej instalacji | oba pola są zapisywane (`runs.report.git.ref`, `github_installations.account_login`) |
| 13 | Koniec usługi | regulamin dostaje punkt 9 o czasie obowiązywania i wypowiedzeniu (30 dni z naszej strony), DPA punkt 10 mówi o usunięciu danych w 30 dni od końca | art. 28 ust. 3 lit. g wymaga usunięcia albo zwrotu po zakończeniu usługi; porzucone organizacje Free zostają pytaniem do prawnika |
| 14 | Transfery | punkt 7 DPA i Załącznik 3 podają podstawę dostępu spoza EOG (SCC, dla Vercela też Data Privacy Framework) | Supabase, Vercel i Resend należą do grup z USA; treść do sprawdzenia przez prawnika z ich umowami powierzenia |
| 28, 37 | Retencja i prywatność | strona retencji: dziennik logowania usługi auth (30 dni), adres osoby w zapisach, które zrobiła, logi hostingu (do 30 dni), rejestr powiadomień po usunięciu organizacji, zdanie o nocnym usuwaniu; informacja o prywatności: dane osoby akceptującej DPA, rejestr powiadomień, przekazanie do Stripe Inc., prawo do przenoszenia danych | teksty mają wymieniać wszystko, co usługa trzyma |
| 36 | Polski DPA | poprawione sformułowania (dalszy podmiot przetwarzający, „zastąpionym”, „nie może”), odwołanie do Regulaminu mówi, że jest po angielsku | tłumaczenie ma zobowiązywać tak samo jak tekst angielski |

Wersja DPA zostaje `2026-09-25`. Tekst jest wersją roboczą, nikt nie przyjął go na produkcji, więc zmiana bez nowej daty nikogo nie wiąże starszym brzmieniem. Pierwsza wersja po przeglądzie prawnika dostanie datę przeglądu.

## Baza i powiadomienia (migracja `20270125000000_audit_week14.sql`)

| # | Temat | Decyzja | Powód |
|---|---|---|---|
| 2 | Kto zapisuje akceptację DPA | `accept_dpa` wykonuje tylko rola serwisowa; akcja serwera sprawdza wersję i to, czy tekst można już przyjąć, a funkcja dostaje id zalogowanego użytkownika i sprawdza, że jest właścicielem | przez PostgREST właściciel omijał obie kontrole aplikacji; osobna tabela wersji w bazie powtarzałaby logikę `LEGAL_FINAL` w dwóch miejscach |
| 22 | Podwójne kliknięcie | funkcja blokuje wiersz organizacji i zwraca istniejącą akceptację, gdy wszystkie dane są takie same; inne dane dają nowy wiersz, który staje się bieżący (poprawka literówki), strona pokazuje starszy jako „replaced by a later acceptance” | wiersze się nie zmieniają, więc poprawka musi być nową akceptacją |
| 23 | PDF kopii | `dpa_acceptances.provider` i `draft` zapisują dane dostawcy i stan wersji roboczej z chwili akceptacji; PDF drukuje je zamiast dzisiejszych `LEGAL_*` | kopia ma pokazywać to, co widział właściciel |
| 24 | Znaki w PDF | pola akceptacji przyjmują litery łacińskie, greckie i cyrylicę z cyframi i interpunkcją | Inter nie ma glifów emoji ani CJK, a kopia umowy nie może mieć krzaków w nazwie firmy |
| 38 | Wersja robocza na serwerze publicznym | `LEGAL_ALLOW_DRAFT_ACCEPTANCE` działa tylko przy `APP_URL` na localhost | `db:env` wpisuje flagę do `.env.local`, a `next start` czyta ten plik |
| 5 | Okres 30 dni | ogłoszenie dostaje czas bazy, zmiana może wejść najwcześniej 31. dnia po dacie ogłoszenia; `send` odmawia, gdy do zmiany zostało mniej niż 30 dni, i każe ogłosić zmianę ponownie | DPA liczy 30 dni od maila |
| 19 | Ogłoszenia jako dowód | ogłoszenia nie da się zmienić; usunąć można tylko takie, o którym nie wyszedł żaden mail; baza sprawdza elementy `changes` | strona i rejestr wysyłki są dowodem tego, co dostali właściciele |
| 6, 20 | Odbiorcy | właściciele wszystkich organizacji, z adresem konta z `auth.users` | regulamin włącza DPA do umowy każdej organizacji; `members.email` odświeża się tylko przy logowaniu |
| 4, 17, 18 | Wysyłka | adres jest rezerwowany w bazie (`claim_notice_delivery`) przed mailem, rezerwacja starsza niż 15 minut wraca do puli; mail przez Resend ma `Idempotency-Key`; transport „log” to porażka; odbiorcy czytani stronami po 1000; skrypt nie czyta `.env.local`, gdy adres bazy jest w środowisku, a baza spoza localhost wymaga `RESEND_API_KEY` i adresu `https` w `APP_URL` | dwa uruchomienia naraz wysyłały każdy mail dwa razy, a wysyłka bez transportu zapisywała doręczenie |
| 21 | Wygasłe zaproszenia | nie liczą się do miejsc i nie widać ich na stronie organizacji; ponowne zaproszenie tego samego adresu zastępuje wygasłe | do nocnego czyszczenia blokowały miejsce i adres |
| 30 | Jeden okres próbny | `first_subscription_at` ustawia wyzwalacz przy każdym zapisie `stripe_subscription_id` i nigdy go nie czyści | ścieżka po usuniętym kliencie Stripe zerowała id subskrypcji |
| 3 | Dziennik logowania | `purge_expired_runs` usuwa wpisy `auth.audit_log_entries` starsze niż 30 dni; brak uprawnień kończy się ostrzeżeniem, a przebiegi i tak są usuwane | adresy usuniętych kont zostawały bez końca |

Test integracyjny nie sprawdza już czyszczenia rejestru wysyłki po roku, bo ogłoszenia nie da się teraz cofnąć w czasie przez API. Sprawdzone w SQL z wyłączonymi wyzwalaczami (`session_replication_role = replica`): rejestr ogłoszenia sprzed 400 dni znika, samo ogłoszenie zostaje.

Po wdrożeniu na projekt Supabase w chmurze trzeba jeden raz sprawdzić, że `select public.purge_expired_runs()` nie zgłasza ostrzeżenia o `auth.audit_log_entries`. Jeśli zgłasza, zostaje wyłączenie zapisu dziennika do bazy w ustawieniach Auth projektu albo zmiana tekstu retencji.

## Eksport

| # | Temat | Decyzja | Powód |
|---|---|---|---|
| 7 | Limit 1000 wierszy | każda tabela czytana stronami po 1000 z pełnym porządkiem, przebiegi dalej kluczem `id` | PostgREST ucinał tabelę po cichu |
| 8 | Duże organizacje | filtry `in` po 100 workspace'ów, na stronie Data i w macierzy dryfu też | około 250 identyfikatorów w adresie dawało błąd |
| 25 | Urwany plik | ostatni wiersz `{"type":"end","data":{"lines":N}}`; po 270 s wiersz `error` z liczbą wierszy i prośbą o kontakt; 5 przebiegów na zapytanie zamiast 20 | bez wiersza końcowego plik ucięty przez limit czasu wyglądał na pełny; 20 raportów po 5 MB podnosiło pamięć o 300 MB |
| 26 | Brakujące dane | licznik uploadów, maile o podprocesorach wysłane do właścicieli organizacji, wszystkie daty z `billing_accounts` (bez identyfikatorów Stripe); format eksportu `2` | strona obiecuje wszystko, co usługa trzyma |

## Okres próbny

| # | Temat | Decyzja | Powód |
|---|---|---|---|
| 9 | Dwie karty Checkoutu | druga żywa subskrypcja organizacji w statusie `trialing` jest od razu anulowana (`DELETE /v1/subscriptions/<id>`), bo nic jeszcze nie pobrała; opłacona druga subskrypcja dalej trafia do logu z prośbą o zwrot | oba okresy próbne kończyły się dwoma obciążeniami, a sesje Checkoutu żyją 24 godziny |
| 29 | `trial_will_end` | zdarzenie dopisane do `WEBHOOK_EVENTS` w `stripe-setup.mjs` | Stripe wysyła tylko zdarzenia, które endpoint subskrybuje |
| 29 | `STRIPE_TRIAL_DAYS` | wartość spoza liczb całkowitych 0 do 90 wyłącza okres próbny i daje ostrzeżenie w logu | ktoś, kto wpisuje „off”, chce wyłączyć okres próbny, a nie dostać 14 dni |
| 29 | Daty | komunikaty zmiany planu podają dzień z dopiskiem „(UTC)” | okres próbny kończący się o 23:00 UTC kończy się w Warszawie następnego dnia |
| 29 | Tryb rozliczeń | Checkout ustawia `subscription_data.billing_mode.type=flexible` | to domyślna wartość przypiętej wersji API, ale atrapa i komunikaty zakładają, że zmiana interwału nie kończy okresu próbnego |

Punkt 30 (`past_due` po okresie próbnym) nie zmienia kodu. Ponawianie płatności w Stripe trzeba ustawić na anulowanie subskrypcji (lista założyciela w ADR 0010), inaczej karta odrzucona po okresie próbnym zostawia plan płatny do końca ponawiania.

## Regulamin, usuwanie konta, testy

| # | Temat | Decyzja | Powód |
|---|---|---|---|
| 11 | Akceptacja regulaminu | zakładający organizację zaznacza akceptację regulaminu (z DPA jako częścią), baza zapisuje `organizations.terms_version`, czas i osobę (migracja `20270126000000_terms_acceptance.sql`); właściciel organizacji bez akceptacji albo ze starszą wersją widzi na stronie organizacji przycisk akceptacji (`accept_terms`); strona logowania linkuje informację o prywatności i regulamin | limit odpowiedzialności, zwroty i okres próbny opierają się na regulaminie, którego nikt nie przyjmował; `consent_collection` w Checkoucie wymaga adresu regulaminu w ustawieniach konta Stripe, więc zostaje na liście założyciela |
| 16, 27 | Usuwanie konta | logika przeniesiona do `lib/account.ts` (`deleteAccountData`) i sprawdzona testem integracyjnym; organizacja, która zostaje z innym właścicielem, dostaje jego adres na kliencie Stripe | ścieżka z rolą serwisową nie miała testu, a faktury szły na adres usuniętej osoby |
| 34 | Testy | nowy `test/integration/deletion.test.ts`: odmowy usunięcia konta, usunięcie po zaplanowanym anulowaniu, przebieg (akceptacja zostaje bez linku), workspace, organizacja, „Make owner” | te ścieżki kasują dane i nie miały testów |

Parametr `p_terms_version` w `create_organization` jest opcjonalny, żeby testy i skrypty mogły zakładać organizacje bez formularza. Aplikacja zawsze go wysyła. Organizacja założona bezpośrednio przez API bez niego widzi baner akceptacji.

## Drobniejsze (P2)

| # | Temat | Decyzja |
|---|---|---|
| 31 | Test obciążeniowy | skrypt przyjmuje tylko bazę i aplikację na localhost; Ctrl+C usuwa organizacje; scenariusz `badtoken` używa tokenu o poprawnym kształcie, więc mierzy też wywołanie bazy; percentyle metodą najbliższej rangi z pominięciem zerwanych połączeń |
| 32 | Zerwane połączenia przy 401 | `/api/runs` przed odpowiedzią 401 odczytuje i wyrzuca resztę ciała (do 5 MB, bez parsowania); trzy przebiegi `badtoken` po 200 żądań dały 600 × 401 |
| 33 | Check GitHuba | nieudany odczyt raportu przed Checkiem zapisuje wiersz `github_checks` z przyczyną |
| 35 | Drobne w interfejsie | `/legal/subprocessors` pokazuje listę także wtedy, gdy baza nie odpowiada; „Make owner” zostaje bez komunikatu, jak „Remove”: przycisk widzi tylko właściciel |
| 38 | Dokumentacja | 31 dni w ADR 0016 i `docs/rozwoj.md`, liczby w dzienniku zgodne z tabelą ADR 0015, `LEGAL_ALLOW_DRAFT_ACCEPTANCE` jako osobna linia w `.env.example` |
