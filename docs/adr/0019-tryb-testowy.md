# ADR 0019. Tryb testowy warstwy płatnej

Data: 2026-09-26. Status: przyjęte.

## Kontekst

Po tygodniu 14 aplikacja (`apps/web`) ma wszystko, czego potrzebuje sprzedaż, ale wersja produkcyjna czeka na decyzje i konta założyciela: projekt Supabase w chmurze, konto Stripe, zarejestrowaną GitHub App, dostawcę maili, dane firmy do tekstów prawnych i domenę. Lokalne uruchomienie wymagało dotąd pięciu kroków (`db:start`, `db:env`, `fake-services init`, `fake-services serve`, `dev`), a po nich baza była pusta: żeby coś zobaczyć, trzeba było zalogować się kodem z Mailpita, założyć organizację, wygenerować token i wysłać przebieg z CLI przy działającym n8n. Założyciel poprosił o flagę, która uruchamia aplikację w trybie testowym na danych testowych i bez konfiguracji produkcyjnej.

## Decyzje

| Temat | Decyzja | Powód |
|---|---|---|
| Uruchomienie | `npm run test-mode` (w katalogu głównym albo w `apps/web`), opcje `--reset`, `--port`, `--fake-port`; skrypt `apps/web/scripts/test-mode.ts` sprawdza Dockera i wolne porty, buduje `core` i `schemas`, gdy nie mają `dist`, uruchamia lokalną Supabase (jeśli nie działa), atrapę GitHub, Slacka i Stripe'a oraz `next dev`, na końcu zasila bazę danymi i wypisuje konta oraz tokeny | jedna komenda zamiast pięciu; Ctrl+C zatrzymuje aplikację i atrapę, Supabase działa dalej jak po `db:start` |
| Flaga | zmienna `FLOWRETEST_TEST_MODE=true`, ustawiana przez skrypt; liczy się tylko wtedy, gdy `APP_URL` i `NEXT_PUBLIC_SUPABASE_URL` wskazują na localhost (`lib/test-mode.ts`); serwer z flagą i publicznym adresem ją ignoruje i raz to loguje | flaga otwiera logowanie bez maila, więc nie może zadziałać na wdrożeniu nawet przez pomyłkę w zmiennych; ten sam wzór co `LEGAL_ALLOW_DRAFT_ACCEPTANCE` (ADR 0018) |
| Konfiguracja | skrypt przekazuje ustawienia procesom potomnym jako zmienne środowiskowe, nie czyta i nie zapisuje `.env.local`; zmienne produkcyjne z pliku (`RESEND_API_KEY`, `MAIL_FROM`, `LEGAL_*`, `SALES_EMAIL`, `STRIPE_AUTOMATIC_TAX`, `STRIPE_TRIAL_DAYS`) nadpisuje pustymi wartościami, bo Next bierze zmienną ze środowiska przed plikiem także wtedy, gdy jest pusta | `.env.local` programisty zostaje nietknięty; wartości przeznaczone na produkcję nie przeciekają do trybu testowego |
| Maile | w trybie testowym `sendMail` nie używa Resend nawet przy ustawionym kluczu, maile idą do Mailpita | dane testowe nie mogą wysłać maila do prawdziwej osoby |
| Logowanie | strona logowania w trybie testowym ma sekcję „Test accounts”: przycisk dla każdego z czterech kont z `TEST_ACCOUNTS`; akcja `signInAsTestAccount` sprawdza tryb i adres, tworzy link przez `admin.generateLink` i weryfikuje go tak jak link z maila; inne adresy logują się kodem z Mailpita | baza odrzuca sesje z hasłem (ADR 0012), więc wejście bez maila idzie tą samą drogą co link; adresy w domenie `.test` nie należą do nikogo |
| Baner | pasek „Test mode” na każdej stronie z linkiem do Mailpita | nikt nie weźmie danych testowych za prawdziwe, także na zrzucie ekranu |
| Dane | `scripts/test-mode-seed.ts` zapisuje dane tak, jak robią to ludzie i runner: organizacje i workspace'y przez klienta RLS, plan Agency przez Checkout atrapy Stripe i jej podpisane webhooki, przebiegi przez `POST /api/runs` z tokenem workspace'u (wychodzą przy tym maile, wiadomości Slacka i GitHub Check); kluczem serwisowym tylko to, czego ludzie nie zapisują sami (akceptacja DPA, połączenie z GitHub, webhook Slacka, daty przebiegów cofnięte o 0 do 13 dni) | dane przechodzą przez te same kontrole co prawdziwe, więc tryb testowy przy okazji sprawdza całą ścieżkę |
| Zestaw danych | Acme Agency (Agency, DPA przyjęte, członek, zaproszenie czekające na pierwsze logowanie, workspace'y Northwind CRM i Globex Ops, 5 workflow, 15 przebiegów ze wszystkimi statusami, upgrade-check na 2.41.0 i v3-nightly do macierzy dryfu, akceptacja, Check na PR 42, Slack, subskrypcja maili) oraz Solo Studio (Free, 1 workspace, 2 przebiegi) | każda strona aplikacji ma co pokazać, a plan Free pokazuje zablokowane funkcje |
| Stan między uruchomieniami | seed działa, gdy w bazie nie ma Solo Studio (zapisywanego na końcu); dane częściowe zatrzymują start z prośbą o `--reset`; atrapa Stripe z `FAKE_SERVICES_STATE` trzyma klientów, subskrypcje i faktury w `apps/web/.test-mode/fake-stripe.json`, tokeny workspace'ów leżą w `.test-mode/tokens.json` | po restarcie strona Billing i portal nadal znajdują klienta w atrapie; bez pliku stanu atrapa zachowuje się jak dotąd (testy) |
| `--reset` | `supabase db reset` i usunięcie `.test-mode/` | lokalna baza jest i tak jednorazowa (`db:reset` po każdej migracji) |

## Czego tu nie ma

Wdrożenia trybu testowego jako publicznego demo: potrzebowałoby Supabase w chmurze, czyli właśnie konfiguracji produkcyjnej, a flaga celowo nie działa poza localhost. Trybu testowego w CLI: runner już działa bez kont (sandbox, katalog regresji `spike day7`), a do lokalnej aplikacji wysyła przebiegi przez `upload --url` z tokenem wypisanym przez `test-mode`.

## Jak sprawdzono

Start od pustej bazy (`--reset`), logowanie jednym kliknięciem jako właściciel i jako osoba zaproszona (zaproszenie przyjęte przy pierwszym logowaniu), strony organizacji, workspace'u, macierzy dryfu i Billing; atrapa zapisała Check na `acme-agency/flows` i pięć wiadomości Slacka, Mailpit pięć maili. Restart bez `--reset` zachował dane i subskrypcję w atrapie. Testy jednostkowe web 53 z 53 (3 nowe w `test/unit/test-mode.test.ts`), integracyjne 72 z 72 z `CI=1` przeciw aplikacji w trybie testowym.
