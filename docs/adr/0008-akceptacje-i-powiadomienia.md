# ADR 0008. Akceptacje w aplikacji, synchronizacja baseline'u, powiadomienia e-mail

Data: 2026-09-24. Status: przyjęte.

## Kontekst

Tydzień 10 planu (sekcja 11): akceptacja baseline'u w aplikacji z historią, synchronizacja baseline'u z runnerem przy `pull`, powiadomienia e-mail o DIFF i ERROR. Baseline zawiera prawdziwe ciała żądań nowej wersji, a warstwa płatna przechowuje tylko raporty po redakcji (ADR 0007). Aplikacja nie ma więc z czego zbudować baseline'u.

## Decyzje

| Temat | Decyzja | Powód |
|---|---|---|
| Co zapisuje akceptacja | decyzję: przebieg, przypadki, komunikat, kto i kiedy (`acceptances`); baseline pisze runner z pełnego lokalnego raportu tego przebiegu | wartości klientów nie opuszczają maszyny agencji; baseline powstaje tą samą funkcją co przy `flowretest accept` |
| Jak runner znajduje przebieg | po nazwie lokalnego katalogu przebiegu (`run` w raporcie po redakcji, `runs.local_run`) | nazwa katalogu jest znacznikiem czasu, nie niesie danych klienta |
| Synchronizacja | `flowretest sync` oraz automatycznie na końcu `pull`, gdy są `cloud.url` i `FLOWRETEST_TOKEN` (`--no-sync` wyłącza); akceptacja, której przebiegu nie ma na tej maszynie, zostaje oczekująca | przebieg z CI albo z laptopa innej osoby można zaakceptować tylko tam, gdzie leży jego raport |
| Kiedy przypadek można zaakceptować | status PASS albo DIFF i `stable: true` z `run --stabilize`; `accept_run` sprawdza to na serwerze, formularz tylko podpowiada | ta sama reguła co `flowretest accept` bez `--force`; bez `--force` w aplikacji |
| Stabilność w raporcie | pole `stability` (przypadek → true/false) w raporcie po redakcji | to jedyna informacja z rejestrów `calls`, której aplikacja potrzebuje |
| Stan zastosowania | `applied_at`, `applied_cases`, `applied_note` (powody odmowy z `accept`) ustawiane przez `mark_acceptance_applied`, raz | historia pokazuje, czy baseline naprawdę powstał i dla których przypadków |
| Odbiorcy powiadomień | tylko członkowie organizacji, każdy dla siebie (`notification_subscriptions`: workspace, statusy), adres z `members` | dowolny adres zrobiłby z usługi przekaźnik poczty; członek usunięty z organizacji przestaje dostawać maile |
| Treść maila | status, liczby przypadków i zmian, nazwa workflow i workspace'u, link | bez wartości i bez ścieżek; szczegóły są w aplikacji za logowaniem |
| Wysyłka | po odpowiedzi na upload (`after` z `next/server`), każda próba w `notification_log` | wolny albo niedziałający dostawca nie spowalnia ani nie psuje uploadu |
| Dostawca poczty | nie wybrany (decyzja założyciela odłożona); `lib/mail.ts` wybiera transport ze środowiska: Resend przy `RESEND_API_KEY`, Mailpit przy `MAILPIT_URL`, inaczej tylko log | każdy transport to jedno wywołanie HTTP, zmiana dostawcy to jedna funkcja |

## Czego tu nie ma

Przenoszenia baseline'u między maszynami. Rozważony wariant: runner wysyła do aplikacji kandydata na baseline zaszyfrowanego kluczem agencji, aplikacja oddaje go po akceptacji. Rozwiązuje to CI, ale dane klientów (zaszyfrowane) trafiają wtedy do Skynappse. To zmienia obietnicę prywatności i dotyczy umowy powierzenia, więc wymaga decyzji założyciela i opinii prawnej. Do tego czasu przebieg z CI akceptuje się ponownym przebiegiem lokalnym albo krokiem `sync` w jobie, który ma raport.

Webhook Slack jest w tygodniu 11 razem z GitHub App.

## Skutki

- CLI 0.3 bez pola `stability` wysyła raporty, których przypadków nie da się zaakceptować w aplikacji; formularz mówi, że trzeba uruchomić `run --stabilize` i wysłać raport ponownie.
- `acceptances` przeżywa usunięcie przebiegu (`run_id` na null, `local_run` zostaje), więc historia decyzji nie znika razem z raportem.
