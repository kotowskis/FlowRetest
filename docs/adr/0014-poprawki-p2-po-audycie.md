# ADR 0014. Poprawki P2 z audytu warstwy płatnej

Data: 2026-09-25. Status: przyjęte.

## Kontekst

Ostatnia partia z `docs/audyt-2026-09-25.md`: drobne punkty P2, które zostały po ADR 0012 i 0013. Zmiany w bazie są w migracji `20261230000000_audit_p2.sql`. Dwa punkty zostają świadomie bez zmian; powody są niżej.

## Decyzje

| Temat | Decyzja | Powód |
|---|---|---|
| Licznik uploadów | tabela `upload_events` zapisywana w `ingest_run`; `org_plan` liczy z niej ostatnią dobę; wiersze starsze niż dwa dni znikają z nocnym czyszczeniem | usunięcie przebiegów zerowało limit, bo liczono wiersze `runs` |
| Miejsca | zaproszenie na adres obecnego członka jest odrzucane (23505, `hint = member`); `claim_invitations` odświeża `members.email`, a `run_recipients` bierze bieżący adres konta | zaproszenie zajmowało drugie miejsce, a maile szły na stary adres po jego zmianie |
| Okres łaski | subskrypcja `incomplete` albo `incomplete_expired` nie daje okresu łaski | nigdy nie była opłacona |
| `workspace_org` | odpowiada tylko członkom (oraz roli serwisowej, cronowi i wyzwalaczom, które nie mają `auth.uid()`) | zdradzała organizację obcego workspace'u; polityki działają jak wcześniej, bo `is_member(null)` to fałsz |
| Akceptacje | drugie wysłanie tej samej akceptacji (ten sam przebieg, te same przypadki, ta sama osoba, jeszcze nie zastosowana) zwraca pierwszą; blokada doradcza na przebieg | podwójne kliknięcie dawało dwie akceptacje do zastosowania |
| Macierz dryfu | widok `latest_upgrade_runs` filtruje przebiegi funkcją `drift_matrix_allowed` | ADR 0010 trzyma limity planów w bazie, nie tylko na stronie |
| Webhook Stripe | zdarzenie jest wstawiane do `stripe_events` przed obsługą; przy błędzie wiersz jest usuwany, żeby ponowienie Stripe zadziałało | dwa równoległe doręczenia tego samego zdarzenia obsługiwało się dwa razy |
| Idempotencja Stripe | klucz klienta zawiera skrót adresu e-mail; Checkout ma klucz w oknie 10 sekund; klient usunięty w Stripe jest zakładany na nowo przy następnym Checkoucie | dwóch właścicieli naraz dostawało błąd klucza, podwójne kliknięcie otwierało dwie sesje, a usunięty klient blokował Checkout na zawsze |
| `stripe-setup.mjs --webhook` | istniejący endpoint dla tego samego adresu jest uzupełniany o brakujące zdarzenia zamiast zakładania drugiego | drugi endpoint podpisywał sekretem, którego aplikacja nie zna |
| GitHub | token instalacji w pamięci na 50 minut per instalacja i repozytorium; jedno ponowienie po 401, 403, 429 albo 5xx; token OAuth osoby unieważniany zaraz po sprawdzeniu repozytoriów; `setup_action=update` bez `state` kończy na `/orgs` z komunikatem; zdarzenie `installation_repositories` (removed) zdejmuje repozytorium z listy | mniej zapytań, mniej zgubionych Checków, brak niepotrzebnego tokenu z dostępem do konta |
| Mail i Slack | temat bez znaków nowej linii; nagłówek `List-Unsubscribe` ze stroną ustawień; Slack przyjmuje też webhooki Workflow Buildera (`/triggers/...`, wiadomość jako zmienna `text`) | nagłówki maila i część zespołów używa Workflow Buildera zamiast incoming webhooks |
| CSP | stronom nonce na żądanie z `proxy.ts`, `script-src 'self' 'nonce-…' 'strict-dynamic'`; wszystkie strony renderowane przy żądaniu; odpowiedzi API z `default-src 'none'` | `'unsafe-inline'` nie chroniło przed wstrzykniętym skryptem |
| Drobne | `Retry-After: 3600` przy 429; PDF z `filename*` w UTF-8 i planem z `getRun`; macierz czyta widok stronami po 1000 wierszy; opis wejścia `values` w `action.yml`; pytanie o dane na stronie cennika wymienia wszystko, co zawiera raport; dokumentacja CLI, formatów i rozwoju; CI sprawdza, że `docs/formaty` zgadza się ze schematami | |

## Zostaje bez zmian

- `/auth/confirm` nie przenosi `next` z linku w mailu, a link z cudzym `token_hash` loguje na konto jego właściciela. Link działa na innym urządzeniu niż to, na którym zaczęto logowanie (ADR 0007), więc nie da się go związać z przeglądarką. Kod z maila (ten sam mail) przenosi `next`. Atak wymaga, żeby ofiara kliknęła link od atakującego i nie zauważyła cudzego adresu w nagłówku aplikacji; skutkiem jest praca na koncie atakującego, nie dostęp do konta ofiary.
- `pause_collection` w Stripe zostawia plan, bo status subskrypcji zostaje `active`. Pauzę zbierania płatności ustawia tylko operator w panelu Stripe; lista dla założyciela mówi, żeby tego nie robić, a subskrypcję anulować.

## Po stronie założyciela

- W ustawieniach GitHub App zasubskrybować zdarzenie `installation_repositories`.
- W Stripe ustawić ponawianie nieudanych płatności tak, żeby kończyło się anulowaniem subskrypcji (Settings, Billing, Subscriptions and emails), i nie używać pauzy zbierania płatności.
- Hosting musi przepuszczać nagłówek `Content-Security-Policy` z `proxy.ts` bez własnej, łagodniejszej polityki; dwie polityki na stronie działają jednocześnie.
