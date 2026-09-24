# ADR 0007. Szkielet warstwy płatnej: dane, tokeny, przyjmowanie raportów

Data: 2026-09-24. Status: przyjęte.

## Kontekst

Plan (sekcja 11) opisuje warstwę płatną na poziomie tabel i tygodni. Tydzień 9 ma dać logowanie z organizacjami i workspace'ami. Do tego dochodzą tokeny z endpointem `POST /api/runs` oraz przeglądarka raportu. Założenie z notatki decyzyjnej: do Skynappse trafia tylko raport po redakcji, fixture'y i pełny raport zostają u agencji. Bramka 5 nie jest zamknięta (brak sesji z agencjami i odpowiedzi licencyjnej, `docs/bramka-5.md`); tydzień 9 powstał na prośbę założyciela przed jej zamknięciem, bez wdrożenia na produkcję.

## Decyzje

| Temat | Decyzja | Powód |
|---|---|---|
| Miejsce w repozytorium | `apps/web` jako workspace `@flowretest/web`, prywatny | plan sekcja 11; aplikacja importuje `@flowretest/core` (render planu, strażnik redakcji) i `@flowretest/schemas` |
| Logowanie | bez hasła: `signInWithOtp`, w mailu sześciocyfrowy kod i link `token_hash` | kod działa na innym urządzeniu niż przeglądarka, w której zaczęto logowanie; link z `token_hash` nie potrzebuje weryfikatora PKCE (sprawdzone curlem bez ciasteczek) |
| Członkostwo | tabela `members` (owner, member) i `invitations` po adresie e-mail; zaproszenie zamienia się w członkostwo przy następnym logowaniu (`claim_invitations`) | bez wysyłki maili z aplikacji w tygodniu 9 (Resend jest w tygodniu 10) i bez klucza serwisowego w akcjach użytkownika |
| Autoryzacja odczytu | RLS na każdej tabeli, funkcje `is_member`, `is_owner`, `workspace_org` jako `security definer` | polityki na `members` nie mogą czytać `members` przez RLS bez rekurencji |
| Tokeny workspace'u | `frt_` plus 32 losowe bajty base64url; w bazie tylko SHA-256 i pierwsze 8 znaków | token pokazany raz; wyciek tabeli nie daje tokenów; kolumna `token_hash` nie ma uprawnienia `select` dla `authenticated`, a `update` obejmuje tylko `revoked_at` |
| Zapis przebiegu | funkcja `ingest_run` (`security definer`, wykonanie tylko dla `service_role`) sprawdza token i w jednej transakcji zapisuje workflow, przebieg i `last_used_at` | cofnięty token jest odrzucany w tej samej transakcji; użytkownik z kluczem anon nie może jej wywołać |
| Walidacja uploadu | serwer parsuje `RedactedReportSchema`, uruchamia `redactionProblems` z `core` i liczy status z przypadków; 413 powyżej 5 MB, 422 gdy zostały wartości | obietnica "tylko raport po redakcji" nie może zależeć od uczciwości klienta ani od wersji CLI |
| Zakres raportu | kolumna `runs.report` (jsonb) trzyma raport po redakcji w całości; lista przebiegów czyta tylko metadane i `summary` | przeglądarka renderuje plan z tego samego obiektu co CLI (`renderPlan`, `engineSection`, `FLAG_TEXT`) |
| Lokalny Supabase | porty 553xx, `db:start` z wyłączonymi usługami, których warstwa nie używa (storage, realtime, studio, edge runtime, analityka) | port 54322 był zajęty przez inny projekt na maszynie założyciela; mniejszy stos startuje szybciej w CI |

## Znalezione przy okazji

- `redactPlanReport` zostawiał niesolony `bodyHash` (SHA-256 z ciała po kanonizacji razem ze ścieżką i zapytaniem). Dla małego ciała na znanym endpoincie, np. jednego numeru telefonu, taki skrót da się odwrócić zgadywaniem. Teraz `bodyHash` i `sha256` części multipart są przeliczane HMAC-iem z kluczem raportu, tak jak kształty wartości.
- Etykieta nowej wersji w raporcie to ścieżka pliku podana w `--new`, np. z nazwą użytkownika systemu. Raport po redakcji ma tylko nazwę pliku.

## Czego tu nie ma (następne tygodnie planu)

Historia akceptacji i synchronizacja baseline'u (tydzień 10), powiadomienia (10 i 11), GitHub App (11), Stripe i limity retencji (12), eksport PDF i macierz dryfu (13), DPA i testy obciążeniowe (14). Brak też limitu liczby uploadów na token; do dodania razem z planami w tygodniu 12. Domyślny adres warstwy płatnej w CLI nie istnieje, dopóki nie ma domeny: `upload` wymaga `--url`, `FLOWRETEST_URL` albo `cloud.url`.

## Skutki

- Każda zmiana schematu bazy to nowa migracja i regeneracja `lib/database.types.ts`; job `web` w CI stawia Supabase, sprawdza typy, buduje aplikację i uruchamia testy RLS oraz API.
- Zmiana formatu raportu po redakcji wymaga zgodnej zmiany `RedactedReportSchema`; stare CLI z nowym serwerem dostaną 400 z listą pól.
