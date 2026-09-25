# ADR 0010. Plany, Stripe, limity i retencja

Data: 2026-09-24. Status: przyjęte.

## Kontekst

Tydzień 12 planu (sekcja 11): Stripe z planami Team 79 EUR i Agency 199 EUR, limity workspace'ów i retencji, faktury. Liczby wzięliśmy z hipotezy cenowej w notatce decyzyjnej (punkt 6.9): Team to 10 workspace'ów, 3 osoby i raporty 90 dni, Agency to workspace'y bez limitu, 10 osób i rok, rocznie o 20% taniej. Notatka opisuje Free jako darmowy runner bez konta. Warstwa hostowana potrzebuje jednak stanu dla organizacji bez subskrypcji, więc powstał plan Free w aplikacji. Konta Stripe, domeny ani rejestracji VAT nie ma, więc całość działa na ustawieniach ze środowiska, a lokalnie i w CI na atrapie Stripe w `apps/web/scripts/fake-services.mjs`.

## Decyzje

| Temat | Decyzja | Powód |
|---|---|---|
| Gdzie są plany | tabela `plans` z limitami i cenami do wyświetlenia; kwotę pobiera Stripe z ceny o kluczu `flowretest_<plan>_<monthly\|yearly>` | limity sprawdza baza bez pytania Stripe; w ustawieniach aplikacji nie ma identyfikatorów cen |
| Plan Free w aplikacji | 1 workspace, 2 miejsca, historia 14 dni, 50 uploadów na dobę, bez Checka i Slacka | agencja może sprawdzić przepływ z drugą osobą (akceptacja), zanim zapłaci; Check i Slack zostają w płatnych planach jak w notatce |
| Limity uploadów | Team 1000, Agency 5000 na organizację w ostatnich 24 godzinach, odmowa 429 | ochrona przed pętlą w CI; zamyka brak z ADR 0007 (limit na organizację, nie na token, bo token łatwo wygenerować drugi) |
| Gdzie sprawdzane są limity | w bazie: wyzwalacze na `workspaces` i `invitations`, `ingest_run` przed zapisem; błąd 53400 z nazwą limitu w `hint` | UI tylko tłumaczy odmowę na zdanie; blokada doradcza (`pg_advisory_xact_lock` na organizację) zatrzymuje dwa równoległe zapisy przechodzące przez ten sam licznik |
| Miejsca | członkowie plus oczekujące zaproszenia | zaproszenie zamienia się w członkostwo przy logowaniu bez ponownego sprawdzenia, więc liczy się od razu |
| Po obniżeniu planu | nic nie jest usuwane; uploady przyjmują najstarsze workspace'y w liczbie z planu, nowsze dostają 402; nowych zaproszeń nie da się wysłać, dopóki miejsc jest za dużo | bez tej reguły anulowanie subskrypcji zostawiałoby 30 workspace'ów za darmo; najstarsze workspace'y zwykle mają historię i tokeny w CI |
| Zmiana planu w aplikacji | przy żywej subskrypcji zmiana ceny przez API z proporcjonalnym rozliczeniem; przejście na mniejszy plan tylko, gdy organizacja mieści się w jego limitach | bez konfigurowania zmian planu w portalu Stripe; nie da się kupić Team z 12 workspace'ami |
| Portal Stripe | karta, adres, numer VAT, faktury, anulowanie | Stripe wysyła maile o nieudanych płatnościach i fakturach; nie budujemy tego drugi raz |
| Źródło prawdy | Stripe; webhook zapisuje stan w `billing_accounts` i `invoices`, a każde zdarzenie czyta obiekt ponownie z API (`Stripe-Version: 2026-02-25.clover`) | zdarzenia przychodzą w dowolnej kolejności i czasem dwa razy; ponowny odczyt daje stan bieżący; od wersji basil okres rozliczeniowy jest w pozycji subskrypcji |
| Organizacja subskrypcji | po kliencie Stripe utworzonym dla organizacji (klucz idempotencji `frt-customer-<org>`); plan z ceny, nigdy z metadanych subskrypcji (od ADR 0012: metadane ceny `flowretest_plan`, `lookup_key` jako zapas) | plan wynika z ceny, którą Stripe faktycznie pobiera; metadane zostają stare po zmianie planu, np. w portalu |
| Druga żywa subskrypcja | nie jest przejmowana, a `stripe_events` zapisuje powód | dwa otwarte Checkouty w dwóch kartach dałyby dwa obciążenia; zwrot robi się ręcznie w Stripe |
| Strona po płatności | synchronizuje sesję Checkout od razu, jeśli należy do klienta tej organizacji | plan widać bez czekania na webhook, także lokalnie bez `stripe listen` |
| Statusy | `active`, `trialing`, `past_due` dają plan; pozostałe dają Free | `past_due` to czas ponawiania karty przez Stripe; odcięcie w trakcie ponawiania karałoby za wygasłą kartę |
| Retencja | `purge_expired_runs()` codziennie o 03:17 UTC przez `pg_cron`; znikają przebiegi starsze niż okres planu razem z Checkami i logiem powiadomień, akceptacje zostają bez linku do przebiegu | działa niezależnie od hostingu aplikacji; baseline'y leżą u agencji, więc usunięcie przebiegu nie psuje synchronizacji wykonanych akceptacji |
| Okres łaski | przez 30 dni po końcu płatnego planu retencja jest taka jak w tamtym planie | karta, która padła na dobre, nie kasuje roku historii w jedną noc |
| Usuwanie organizacji | odmowa, gdy subskrypcja nadal pobiera opłaty | usunięcie wiersza nie zatrzymuje subskrypcji w Stripe |
| Kto widzi rozliczenia | plan i limity: każdy członek; faktury: właściciele; identyfikatory Stripe: tylko rola serwisowa | faktury mają dane rozliczeniowe agencji |
| Podatki | `tax_id_collection` i wymagany adres w Checkoutcie; ceny `tax_behavior=exclusive`; Stripe Tax włącza `STRIPE_AUTOMATIC_TAX=true` | ceny na stronie są netto; numer VAT na fakturze pozwala klientowi z UE rozliczyć odwrotne obciążenie |

## Czego tu nie ma

Okresu próbnego (Checkout przyjmuje `subscription_data[trial_period_days]`, decyzja założyciela; doszedł w ADR 0017). Strony cennika dla niezalogowanych (tydzień 13). Funkcji zależnych od planu z tygodnia 13 (PDF, macierz dryfu). Limitu liczby organizacji na osobę: ktoś może założyć kilka organizacji Free zamiast płacić za Team, co przy 1 workspace na organizację i bez Checka nie wygląda na realne ryzyko.

## Lista dla założyciela na dzień założenia konta Stripe

1. Konto Stripe firmy, najpierw tryb testowy; dane firmy i numer VAT w ustawieniach, bo trafiają na faktury.
2. `STRIPE_SECRET_KEY=sk_test_... node apps/web/scripts/stripe-setup.mjs --webhook https://<domena>/api/stripe/webhook` zakłada produkty, cztery ceny z kluczami `lookup_key` i endpoint webhooka; wypisuje `STRIPE_WEBHOOK_SECRET`.
3. W ustawieniach Checkoutu włączyć "Limit customers to one subscription".
4. Portal klienta (Settings, Billing, Customer portal): faktury, zmiana karty, dane rozliczeniowe z numerem VAT, anulowanie na koniec okresu.
5. Numeracja faktur i stopka zgodne z polskimi wymogami (księgowa), maile Stripe o fakturach i nieudanych płatnościach włączone.
6. Decyzja o Stripe Tax i rejestracji OSS; do tego czasu `STRIPE_AUTOMATIC_TAX` zostaje wyłączone.
7. Powtórzyć kroki 2 do 4 w trybie live z kluczem `sk_live_...`.

## Skutki

- Testy integracyjne, które potrzebują więcej niż Free, ustawiają plan funkcją `setPlan` z `test/integration/helpers.ts`; test Checkoutu przechodzi przez prawdziwe webhooki aplikacji z podpisem atrapy.
- Zmiana cen to zmiana w trzech miejscach: `plans` (migracja), `scripts/stripe-setup.mjs` i atrapa. Cena w Stripe jest niezmienna, więc nowa kwota to nowa cena z `transfer_lookup_key`.
- Atrapa odtwarza tylko pola, z których korzysta aplikacja. Zgodność z prawdziwym API (kody błędów, pola faktury w wersji clover) trzeba potwierdzić przy pierwszym przebiegu w trybie testowym.
