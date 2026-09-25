# ADR 0012. Poprawki P0 z audytu warstwy płatnej

Data: 2026-09-25. Status: przyjęte.

## Kontekst

Audyt tygodni 9 do 13 (`docs/audyt-2026-09-25.md`) znalazł osiem problemów P0: dwa pozwalały serwerowi wysyłać żądania tam, gdzie nie powinien (Slack, GitHub), dwa dotyczyły kont i tokenów, jeden przepuszczał dane osobowe w raporcie po redakcji, trzy kosztowały klienta pieniądze albo historię przebiegów. Ten dokument zapisuje, jak je zamknęliśmy i czego poprawka nie obejmuje. Zmiany w bazie są w migracji `20261228000000_audit_p0.sql`.

## Decyzje

| # | Temat | Decyzja | Powód |
|---|---|---|---|
| 1 | Webhooki Slacka | `insert` na `slack_webhooks` zabrany roli `authenticated`; akcja serwera sprawdza hosta, właściciela i plan, potem zapisuje kluczem serwisowym; `sendSlack` sprawdza hosta przed każdym wysłaniem | strażnik tylko w akcji serwera nie działał, bo PostgREST przyjmował wiersz z pominięciem aplikacji; sprawdzenie przy wysyłce chroni też stare wiersze |
| 2 | Checki GitHuba | przy podpinaniu aplikacja pobiera `GET /user/installations/<id>/repositories` tokenem osoby i zapisuje w `github_installations.repositories` tylko repozytoria, w których ta osoba ma `admin`; Check idzie tylko na repozytorium z tej listy, tokenem instalacji zawężonym do tego repozytorium i do `checks: write` | GitHub pokazuje instalację każdemu, kto ma odczyt jednego repozytorium; wymagany Check to bramka ustawiana przez administratora repozytorium, więc tylko on może ją kierować do FlowRetest |
| 3 | Logowanie | wyzwalacz na `auth.mfa_amr_claims` odrzuca każdą sesję otwartą hasłem; testy logują się linkiem z `admin.generateLink` | publiczny endpoint rejestracji hasłem zostaje w Supabase Auth; przy autopotwierdzaniu dawał sesję na cudzy adres i przejęcie zaproszenia; blokada w bazie działa bez względu na ustawienia projektu w chmurze |
| 4 | Tokeny | wyzwalacz nie pozwala zmienić `revoked_at`, które już jest ustawione | członek może cofnąć token (bezpieczny kierunek), nikt nie może go przywrócić |
| 5 | Redakcja | liczby od miliona w górę jako `<digits N>`; klucze obiektów i zapytań z e-mailem albo długą liczbą, segmenty ścieżki ze spacją, e-mailem albo długą liczbą oraz e-maile i długie liczby w nazwach, etykietach, ostrzeżeniach i ścieżkach pól zamieniane na kształty; strażnik `redactionProblems` sprawdza wszystkie te miejsca | raport po redakcji to jedyny plik, który opuszcza maszynę agencji, a strażnik na serwerze jest ostatnią linią obrony |
| 6 | Plan z ceny Stripe | plan z metadanych ceny `flowretest_plan` (ustawia `stripe-setup.mjs`, także na istniejących cenach), klucz `lookup_key` jako zapas; baza nie zamienia planu żywej subskrypcji na `null` | `transfer_lookup_key` zdejmuje klucz ze starej ceny, a klienci na starej cenie przechodzili na Free i tracili historię |
| 7 | Zmiana planu | `proration_behavior=always_invoice` i `payment_behavior=pending_if_incomplete`; przy `past_due` zmiana planu jest odrzucana; zdarzenia `pending_update_applied` i `pending_update_expired` w webhooku | nowa cena działa dopiero po opłaceniu różnicy; wcześniej limity Agency działały od razu, a dopłata trafiała na następną fakturę |
| 8 | Retencja po zmianie planu | `billing_accounts.previous_plan` i `plan_changed_at` ustawiane wyzwalaczem; przez 30 dni po przejściu na mniejszy plan retencja jest taka jak w poprzednim; `ended_at` nie przesuwa się przy kolejnych synchronizacjach subskrypcji `unpaid` albo `paused` | obniżenie z Agency na Team kasowało następnej nocy historię starszą niż 90 dni, a okres łaski dla nieopłaconej subskrypcji trwał bez końca |

## Odrzucone

- Podmiana hasła na losowe w chwili potwierdzenia adresu (pierwsza wersja punktu 3). GoTrue po potwierdzeniu zapisuje cały wiersz użytkownika jeszcze raz, ze starym hashem, więc zmiana z wyzwalacza się nie utrzymywała. Sprawdzone na lokalnym GoTrue.
- Włączenie `enable_confirmations` jako jedynej ochrony. Działa tylko wtedy, gdy projekt w chmurze ma to samo ustawienie. Blokada sesji w bazie nie zależy od konfiguracji.

## Czego poprawka nie obejmuje

- Imiona i nazwiska bez znaczników (bez spacji w segmencie ścieżki, bez cyfr, bez `@`) nadal przechodzą w kluczach i ścieżkach: nie da się ich odróżnić od nazw pól ani słów w API.
- Instalacje GitHuba podpięte przed migracją mają pustą listę repozytoriów i nie dostają Checków, dopóki administrator repozytorium nie podepnie ich ponownie. Lista nie odświeża się sama po dodaniu repozytorium do instalacji.
- Tryb rozliczeń `flexible` i anulowanie przez `cancel_at` (punkt 16 audytu) oraz pozostałe punkty P1 i P2 czekają na osobne poprawki.

## Skutki

- Pułapka dla przyszłych zmian: wyzwalacz na `auth.mfa_amr_claims` opiera się na tabeli wewnętrznej GoTrue. Po aktualizacji Supabase trzeba sprawdzić, że logowanie hasłem nadal kończy się błędem (test `audit-p0.test.ts`), a logowanie kodem działa.
- Kolejność działań po założeniu konta Stripe (ADR 0010) się nie zmienia; `stripe-setup.mjs` dopisuje metadane do cen, które już istnieją.
- GitHub App nie potrzebuje nowych uprawnień: lista repozytoriów użytkownika działa z uprawnieniem `metadata: read`.
