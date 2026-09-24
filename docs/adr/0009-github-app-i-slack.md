# ADR 0009. GitHub App z Checkiem i webhook Slack

Data: 2026-09-24. Status: przyjęte.

## Kontekst

Tydzień 11 planu (sekcja 11): GitHub App tworzy Check z wynikiem oraz linkiem. Blokadę merge ustawia klient w ochronie gałęzi. Do tego powiadomienia przez webhook Slack. Aplikacji GitHub nie zarejestrowaliśmy, bo nazwa, konto oraz domena to otwarte decyzje założyciela. Kod działa więc na ustawieniach ze środowiska, a lokalnie i w CI na atrapie (`apps/web/scripts/fake-services.mjs`).

## Decyzje

| Temat | Decyzja | Powód |
|---|---|---|
| Skąd serwer zna commit | `upload` dopisuje `git` (repozytorium, SHA, numer PR) z GitHub Actions albo z `FLOWRETEST_GIT_REPOSITORY` i `FLOWRETEST_GIT_SHA`; w PR bierze SHA z `pull_request.head.sha` | `GITHUB_SHA` w PR to tymczasowy commit scalenia, którego Check nie pokazałby na stronie PR |
| Kolumny przebiegu | `git_repository`, `git_sha`, `pull_request` jako kolumny generowane z `report -> 'git'` | `ingest_run` zostaje bez zmian, a raport jest jedynym źródłem |
| Wynik Checka | PASS `success`, DIFF `action_required`, ERROR i BLOCKED `failure` | DIFF wymaga przeglądu, a wymagany Check z `action_required` blokuje merge; ERROR i BLOCKED znaczą, że workflow nie został sprawdzony |
| Treść Checka | tytuł ze statusem i liczbami, podsumowanie to plan Markdown z raportu po redakcji (limit 65 000 znaków) i link do przebiegu | te same dane co w komentarzu Action przy `values: false`; żadnych wartości klientów |
| Podpięcie instalacji | owner klika "Connect GitHub", podpisany `state` (workspace, użytkownik, 15 minut, HMAC sekretem klienta OAuth), strona instalacji, powrót na setup URL, jednorazowe OAuth; link powstaje tylko, gdy `GET /user/installations` z tokenem tej osoby zawiera to `installation_id` | `installation_id` w adresie da się podać dowolny; bez tej kontroli ktoś mógłby podpiąć cudzą instalację i wystawiać Checki w cudzym repozytorium |
| Która instalacja | ta podpięta do workspace'u, której konto jest właścicielem repozytorium z raportu; brak takiej trafia do `github_checks` jako odmowa z powodem | token workspace'u nie może wystawić Checka w repozytorium konta, którego nikt z organizacji nie podpiął |
| Webhook GitHub | podpis `X-Hub-Signature-256` na surowym ciele; `installation` deleted, suspend, unsuspend oraz `installation_target` renamed | odinstalowanie po stronie GitHuba ma od razu odpiąć workspace |
| Slack | owner dodaje incoming webhook; akceptowany tylko `https://hooks.slack.com/services/...` (`SLACK_WEBHOOK_HOSTS` dopuszcza hosty do testów); członkowie widzą tylko podpowiedź adresu | serwer wysyła na ten adres, więc dowolny host otwierałby drogę do adresów wewnętrznych; adres webhooka jest poświadczeniem |
| Kiedy wysyłać | razem z mailami po odpowiedzi na upload (`after`), każda próba w `notification_log` (Slack) albo `github_checks` | awaria GitHuba ani Slacka nie psuje uploadu, a przyczynę widać w aplikacji |
| GitHub Action | wejścia `upload-url` i `upload-token`; nieudany upload daje ostrzeżenie, wynik joba zależy od planu | Check pojawia się bez zmian w workflow poza dwoma wejściami |

## Czego tu nie ma

Aktualizacji Checka po akceptacji w aplikacji: Check opisuje przebieg, a zaakceptowana zmiana da PASS dopiero w kolejnym przebiegu z baseline'em (ADR 0008). Rejestracji aplikacji na GitHubie (nazwa, uprawnienia `checks: write` i `metadata: read`, zdarzenia `installation`, setup URL `/api/github/setup`, webhook `/api/github/webhook`, "Request user authorization during installation"); to lista dla założyciela na dzień wyboru domeny.

## Skutki

- Serwer bez kompletu zmiennych `GITHUB_APP_*` działa jak dotąd, a strona workspace'u mówi, że GitHub App nie jest skonfigurowana.
- Atrapa sprawdza podpis JWT kluczem publicznym i przypisuje instalacje do użytkowników, więc test "nie twoja instalacja" przechodzi przez tę samą kontrolę co na GitHubie. Zgodność z prawdziwym API (nazwy pól, kody) trzeba potwierdzić przy pierwszej rejestracji aplikacji.
