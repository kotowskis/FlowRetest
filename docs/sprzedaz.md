# Start sprzedaży

Stan na 2026-09-25, koniec tygodnia 14 planu. Technicznie sprzedaż może ruszyć. Działa strona główna z cennikiem, plany rozlicza Stripe (na razie atrapa), a właściciel organizacji przyjmuje DPA w aplikacji i tam eksportuje albo usuwa dane. DPA ma tłumaczenie na polski, a zmianę podprocesora ogłasza skrypt z mailem do właścicieli (ADR 0016). Nie może ruszyć, dopóki założyciel nie zamknie ośmiu decyzji z listy niżej. Każda z nich blokuje pierwszą fakturę.

## Blokery

| Nr | Co | Dlaczego blokuje | Szacunek |
|---|---|---|---|
| 1 | publikacja CLI `0.3.0` na npm i obrazu proxy w GHCR (lista wydania w `docs/dziennik.md`) | strona główna i README mówią `npx flowretest`; bez paczki komenda nie działa | 1 godzina, dwa logowania i tag |
| 2 | domena, hosting aplikacji, projekt Supabase w UE, dostawca poczty | bez nich nie ma adresu, na który można wysłać agencję, ani maili z kodem logowania | 1 dzień konfiguracji po decyzji |
| 3 | konto Stripe z danymi firmy, ceny przez `scripts/stripe-setup.mjs`, portal klienta (ADR 0010) | bez tego nie ma płatności ani faktur | pół dnia |
| 4 | przegląd prawny DPA, regulaminu i polityki prywatności, dane firmy w zmiennych `LEGAL_*` (ADR 0015) | teksty mają baner „Draft” i akceptacja DPA jest zablokowana na produkcji | kilka godzin kancelarii |
| 5 | mail do license@n8n.io o Sustainable Use License (notatka, sekcja 10) | odpowiedź wymagająca umowy OEM kończy warstwę płatną | koszt zero, czas odpowiedzi nieznany |
| 6 | fakturowanie w Polsce z księgową: KSeF dla faktur polskim firmom (faktury Stripe przez niego nie przechodzą), faktura za wdrożenie 1 000 do 2 500 EUR poza Stripe, kupon Stripe na „6 miesięcy Team w cenie” | pierwsza faktura to najpewniej wdrożenie dla agencji z Polski; bez ustalonej ścieżki nie da się jej wystawić zgodnie z prawem | rozmowa z księgową, potem pół dnia |
| 7 | VAT: rejestracja w Stripe Tax i `STRIPE_AUTOMATIC_TAX=true` albo, przy zwolnieniu z VAT, `false` i zmiana tekstów, które mówią o cenach netto (ADR 0018) | Checkout z kluczem produkcyjnym bez tej decyzji kończy się błędem | godzina po decyzji |
| 8 | repozytorium `skynappse/flowretest` na GitHubie (dziś kod jest w `kotowskis/FlowRetest`) albo zmiana adresu w `components/public-shell.tsx` i `packages/cli/package.json` | link „GitHub” na stronie głównej i w nagłówku daje 404 | 1 godzina |

Kolejność: 5, 4 i 6 od razu, bo czekają na kogoś z zewnątrz. Potem 1, bo pilotaż i odpowiedzi na forum potrzebują działającej paczki niezależnie od warstwy płatnej. Na końcu 2 i 3.

## Oferta

- Runner i GitHub Action: darmowe, MIT, bez konta.
- Free w aplikacji: 1 workspace, 2 osoby, historia 14 dni, bez Checka i Slacka.
- Team: 79 EUR miesięcznie netto, 10 workspace'ów, 3 osoby, 90 dni, Check i Slack.
- Agency: 199 EUR miesięcznie netto, bez limitu workspace'ów, 10 osób, 365 dni, PDF przebiegu, macierz dryfu.
- Rocznie 20% taniej.
- Team i Agency zaczynają się od 14 dni za darmo, raz na organizację; Checkout pobiera kartę i obciąża ją dopiero po okresie próbnym (ADR 0017).
- Wdrożenie: 1 000 do 2 500 EUR z planem Team na 6 miesięcy w cenie (notatka, sekcja 9). Propozycja widełek do decyzji: do 3 instancji klientów 1 000 EUR, 4 do 10 instancji 1 750 EUR, powyżej 10 instancji 2 500 EUR. W cenie: fixture'y dla workflow wskazanych przez agencję, GitHub Action w jej repozytorium, pierwszy `upgrade-check` na każdej instancji, jedna sesja szkoleniowa. Praca: 2 do 4 dni założyciela.

## Lejek na pierwsze tygodnie

1. `upgrade-check` przed n8n 3.0: to główny argument do końca 2026 roku. Każda agencja z instancją per klient musi przetestować aktualizację.
2. Wątki na forum n8n 306721, 313427 i 254023: odpowiedź z reprodukcją jednego przypadku z katalogu regresji (15 przypadków w `packages/cli/src/catalog/cases.ts`), bez linku do cennika w pierwszej wiadomości.
3. experts.n8n.io: około 96 agencji; mail do tych, których publiczny stos to HubSpot i Google Sheets (najlepsze pokrycie runnera).
4. Dwie agencje z Polski z sieci kontaktów Skynappse.
5. PR do n8n-as-code (`test`) i narzędzie w n8n-mcp (`docs/integracje.md`) po publikacji 0.3.0.

Pierwszych dziesięciu kandydatów z notatki (sekcja 9): pięciu autorów z forum (Logan_Crook, James_Shannon, mnebel, Adam13y, Exnav29), trzy agencje z experts.n8n.io, dwie z Polski. Tabela do prowadzenia przez założyciela:

| Kandydat | Źródło | Wersja n8n | Instancje klientów | Pierwszy kontakt | Sesja 1 | Raport | Zapłata |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

Pilotaż prowadzimy według `docs/pilotaz-protokol.md`. Próg bramki 5: 2 z 3 agencji płacą w 30 dni od pierwszego raportu.

## Szablony wiadomości

Po angielsku, bo tak piszą agencje z forum i z experts.n8n.io. Każdą wiadomość trzeba dopasować do jednego workflow albo jednej usługi odbiorcy; bez tego to spam.

### Pierwszy mail do agencji z experts.n8n.io

> Subject: Testing n8n 3.0 on your customers' instances
>
> Hi {name},
>
> I saw on experts.n8n.io that {agency} builds HubSpot and Google Sheets workflows for {n} clients. When n8n 3.0 lands, each of those instances needs an upgrade and a check that nothing changed in what the workflows send.
>
> We built FlowRetest for that. It replays real executions of a workflow on the old and the new n8n image, in a sealed Docker network on your machine, and lists every HTTP call that would change. Nothing is sent to HubSpot, and your clients' data stays on your laptop. The runner is open source: {repo link}.
>
> Would a 60-minute session on one of your workflows be useful? You drive, I help with the setup, and you keep whatever it finds.
>
> {signature}

### Odpowiedź w wątku forum

> This looks like the case where {short description of their bug}. I reproduced a similar one: {link to the catalogue case}. The old and the new version both pass in n8n, but the new one sends `{field}` as {what changed}. FlowRetest shows it as a one-line diff before you deploy:
>
> ```
> ~ [7] Push to ERP   POST erp.example.com/api/orders
>       customer_id: "C-1" -> null
> ```
>
> It is MIT and runs locally: `npx flowretest init`. Happy to help if you try it on your workflow.

### Po pierwszym raporcie w pilotażu

> Hi {name},
>
> Thanks for the session on {date}. On {workflow} FlowRetest captured {x} of {y} write nodes and reproduced {k} of the regressions you listed.
>
> If you want to keep it running on your client instances, there are two options: the Team plan at 79 EUR a month (10 workspaces, approvals, GitHub checks), or an onboarding at {price} EUR where we set it up on all {n} instances with you, with six months of Team included.
>
> {signature}

## Pytania do prawnika

1. Czy Skynappse jako dostawca warstwy hostowanej przetwarza dane osobowe, skoro dostaje tylko typ i długość każdej wartości oraz jej skrót z kluczem, którego nie zna? Czy DPA jest wymagane, czy tylko zalecane?
2. Czy akceptacja DPA w aplikacji przez właściciela organizacji (imię i nazwisko, rola, oświadczenie o umocowaniu, zapis z datą i wersją, kopia PDF) wystarcza jako forma zawarcia umowy powierzenia z firmą z UE?
3. Klauzula 6 (podprocesorzy, 30 dni na sprzeciw, zwrot przedpłaty): czy to wystarcza przy agencjach, które same są procesorami swoich klientów?
4. Regulamin: limit odpowiedzialności do opłat z 12 miesięcy, prawo polskie, sąd właściwy dla siedziby. Czy to działa wobec klientów spoza Polski?
5. Czy Stripe powinien być na liście podprocesorów, skoro przetwarza dane rozliczeniowe jako osobny administrator?
6. DPA ma wersję angielską i polską, a punkt 12 mówi, że przy rozbieżności rozstrzyga angielska. Czy wobec klienta z Polski to działa, czy wiążąca powinna być wersja polska?
7. Powiadomienie o zmianie podprocesora idzie mailem do właścicieli wszystkich organizacji co najmniej 30 dni przed zmianą, liczonych od wysłania maila, z adresem do sprzeciwu. Czy to wystarcza jako „informowanie” z art. 28 ust. 2 RODO?
8. Sustainable Use License: czy warstwa hostowana, która nie uruchamia n8n i pokazuje tylko wyniki runnera działającego u klienta, mieści się w licencji (to samo pytanie co w mailu do n8n)?

Pytania z audytu tygodnia 14 (`docs/audyt-tydzien-14-2026-09-25.md`):

9. DPA punkt 6 mówi, że GitHub i Slack nie są podprocesorami. GitHub App należy jednak do nas i wysyła do GitHuba (USA) raport po redakcji. Czy GitHub powinien być na liście?
10. Dane konta i logowania są w DPA danymi przetwarzanymi dla klienta, a w informacji o prywatności jesteśmy ich administratorem. Która rola jest właściwa?
11. Czy punkt 7 DPA (dostęp spoza EOG na podstawie SCC w umowach Supabase, Vercela i Resend, dla Vercela też Data Privacy Framework) zgadza się z umowami powierzenia tych firm?
12. Czy 48 godzin na zgłoszenie naruszenia i warunki audytu (raz w roku, na koszt klienta, najpierw dokumenty) wystarczą wobec art. 28 ust. 3 lit. h?
13. Czy dowód akceptacji DPA powinien przeżyć usunięcie organizacji? Dziś znika razem z nią, a rejestr powiadomień zostaje rok.
14. Porzucone organizacje Free: czy regulamin powinien je usuwać po okresie bez logowania, skoro DPA wiąże usunięcie z końcem regulaminu?
15. Limit odpowiedzialności do opłat z 12 miesięcy wynosi 0 na planie Free. Usługa jest tylko dla firm, ale nic tego nie sprawdza. Czy to wystarcza?
16. Kopie faktur znikają z organizacją, a oryginały trzyma Stripe. Czy to spełnia obowiązek przechowywania przez 5 lat?
