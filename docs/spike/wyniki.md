# Spike wykonalności, wyniki

Dziennik dni 1 do 10 z planu implementacji (sekcja 8). Każdy wpis: co zrobiono, co zmierzono, co zostało do potwierdzenia.

## Dzień 1 (2026-09-24)

Zrobione:

- szkielet monorepo: npm workspaces z turbo, TypeScript z `erasableSyntaxOnly`, `node --test` na plikach `.ts`, pakiety `core`, `cli`, `proxy`, `services`, `schemas`;
- strażnik zależności `scripts/check-no-n8n-deps.mjs` w `npm run verify` i w CI (ubuntu, windows, macos);
- ADR 0001 do 0005 w `docs/adr/`;
- pakiet proxy na mockttp 4.6.3: silnik reguł z szablonami `{{seq}}`, `{{uuid}}`, `{{now}}`, `{{echo body.x}}` (całe napisy i interpolacja w tekście), reguły z `times`, parser multipart bez przechowywania bajtów, zapis `requests.jsonl` z flagą obecności nagłówka Authorization zamiast jego wartości, CA generowane do `/ca` i cachowane; Dockerfile na `node:22-alpine`;
- test w procesie: żądanie POST trafia w `generic-sink` i dostaje odpowiedź z szablonu, GET bez reguły kończy się zamknięciem połączenia, obie linie lądują w `requests.jsonl` z wersją i przypadkiem z `current.json`;
- CLI: wrapper na `docker` bez zależności, `buildN8nEnv` z listą zmiennych z planu (sekcja 4.3), `SandboxSession` (sieć `--internal`, wolumen, proxy, `docker run --rm` per komenda n8n przez entrypoint obrazu), workflow sondujący (Manual Trigger, HTTP Request GET), komenda `doctor` z testem szczelności, `sandbox prune`.

Zmierzone: 17 testów jednostkowych, `npm run verify` w około 3 s na Windows.

## Dzień 2 (2026-09-24), bramka 1 z planu (dzień 2) zaliczona

Uruchomienie `flowretest doctor --engine 2.40.5` na Windows 11 z Docker Desktop 29.1.3 (WSL 2):

| Kontrola | Wynik | Czas |
|---|---|---|
| obraz `n8nio/n8n:2.40.5` | pobrany, digest `sha256:9f693fd5…` | 63 s (pierwszy raz) |
| obraz `flowretest-proxy:dev` | zbudowany lokalnie w 41 s | |
| start sandboxa (sieć internal, wolumen, proxy, CA) | ok | 1,1 s |
| test szczelności: `wget https://example.com` z kontenera bez proxy | zablokowany, kod 1 | 6,2 s (timeout DNS) |
| `n8n import:workflow` | ok | 13,2 s |
| `n8n list:workflow` | zwraca nadane id `frtdoctorprobe01` | około 7 s |
| `n8n execute --rawOutput` przez proxy | węzeł Probe dostał `{"probe":"ok","seq":"1"}` z reguły proxy | 6,9 s |
| przechwycenie w `requests.jsonl` | `example.com/flowretest-probe`, reguła `probe`, wersja i przypadek z `current.json` | |
| log n8n | linia "Installing global HTTP proxy agents" z adresem proxy | |

Wnioski z uruchomienia, część zmienia plan:

1. Import na 2.40.5 wymaga pola `id` w JSON-ie workflow (`NOT NULL constraint failed: workflow_entity.id`) i zachowuje nadane id. Rewriter nadaje deterministyczne 16-znakowe id z nazwy przypadku (`workflowId(seed)`); `list:workflow` zostaje jako kontrola, nie jako źródło id.
2. Komendy CLI n8n piszą przez logger, nie na stdout: `list:workflow` na poziomie info, a `execute --rawOutput` też jako wpis loggera z obiektem wykonania w polu `message`. Z `N8N_LOG_OUTPUT=file` stdout jest pusty. Runner uruchamia te komendy z `N8N_LOG_OUTPUT=console`, `N8N_LOG_LEVEL=info`, `N8N_LOG_FORMAT=json` (flagi `-e` po `--env-file` mają pierwszeństwo) i parsuje linie JSON; wpis, którego `message` jest obiektem z `data` i `mode`, to wynik wykonania. Sekcja 4.3 planu o "czystym stdout" jest nieaktualna.
3. `execute` w trybie `cli` startuje brokera task runnera ("n8n Task Broker ready on 127.0.0.1, port 5679"), więc węzeł Code w JavaScript ma szansę działać bez dodatkowej konfiguracji; potwierdzenie z prawdziwym węzłem Code w dniu 3. Python runner nie startuje (brak Pythona w obrazie), zgodnie z zakresem.
4. Katalog `/opt/custom-certificates` musi być montowany do zapisu, bo entrypoint uruchamia w nim `c_rehash`; z bind mountem z Windows działa.
5. Proces n8n startuje 7 do 13 s na komendę (import z migracjami bazy najdłużej). Przy 20 przypadkach i dwóch wersjach to 5 do 9 minut na sam start procesów, więc `executeBatch` z dnia 4 ma realne znaczenie.
6. Docker Desktop nie da się uruchomić z sesji agenta (backend nie startuje); uruchamia go człowiek. `sandbox prune` sprząta osierocone zasoby po przerwanym przebiegu.

Do potwierdzenia w dniu 3: podmiana triggera i obu wariantów węzła odtwarzającego, zaślepki poświadczeń (nazwy pól z `export:credentials --decrypted`), Respond to Webhook w trybie `cli`, podmiana HubSpot Trigger.

## Dzień 3 (2026-09-24), podmiana triggera, odtwarzanie, zaślepki poświadczeń

Komenda `flowretest spike day3` (kod w `packages/cli/src/commands/spike-day3.ts`, wynik w `docs/spike/day3-results.json`): siedem syntetycznych scenariuszy, każdy w dwóch wariantach odtwarzania, jeden sandbox, import zaślepek poświadczeń i 14 workflow jedną komendą `import:workflow --separate`.

| Scenariusz | Oczekiwanie | Code | Edit Fields plus Split Out |
|---|---|---|---|
| trigger Webhook, `$('Webhook').item` w Edit Fields, POST z nagłówkiem z zaślepki | 2 POST z e-mailem i cid | ok | ok |
| trigger HubSpot Trigger (typ aplikacyjny) | 2 POST | ok | ok |
| trigger Schedule Trigger | 1 POST z nagranym `timestamp` | ok | ok |
| odtworzony węzeł czytający (GET) z `pairedItem`, potem `$('Webhook').item` | C-1 z a@b.pl, C-2 z c@d.pl | ok | powiązanie utracone: C-2 dostał a@b.pl |
| węzeł Code (JavaScript) wykonany naprawdę | 2 POST z polem `n` | ok | ok |
| Respond to Webhook zamieniony na No Operation | 2 POST | ok | ok |
| Loop Over Items z odczytem odtwarzanym per `$runIndex` (2 uruchomienia) | C-1, potem C-2 | ok | ok |

Czas wykonania przypadku: 6 do 9 s, w tym start procesu n8n. Żadne żądanie nie trafiło w regułę `block`; odczyty nie dotarły do proxy, bo były odtworzone.

Wnioski:

1. ADR 0003 przyjęty: wariant Code (Code v2, `runOnceForAllItems`, `RUNS[$runIndex]` z `pairedItem`) jest podstawowy. Wariant Edit Fields plus Split Out zostaje jako rezerwa z ostrzeżeniem o utracie powiązań; scenariusz z odczytem pokazał ten błąd wprost.
2. `execute` w trybie `cli` uruchamia task runnera w trybie internal i węzeł Code działa bez dodatkowej konfiguracji.
3. Podmiana triggera nie zależy od typu: Webhook, HubSpot Trigger i Schedule Trigger przeszły tą samą ścieżką (Manual Trigger `frt:start` plus węzeł odtwarzający o nazwie oryginału).
4. `import:credentials` przyjmuje listę `{id, name, type, data}` z danymi jawnym tekstem i zachowuje id; węzeł HTTP Request z `httpHeaderAuth` wysłał żądanie z nagłówkiem (proxy widzi flagę obecności Authorization). Nazwy pól zaślepek pochodzą z klas poświadczeń w obrazie 2.40.5 (`hubspotAppToken.appToken`, `slackApi.accessToken`, `airtableTokenApi.accessToken`, `notionApi.apiKey`, `googleApi.email/privateKey`, typy `*OAuth2Api` przez `oauthTokenData`). Zaślepki OAuth2 czekają na dzień 4 z węzłami Slack, HubSpot i Google Sheets.
5. Respond to Webhook: zamiana na No Operation działa; zachowanie węzła bez zamiany w trybie `cli` nie było sprawdzane, bo zamiana jest tańsza niż diagnoza.
6. Nagrania z wieloma uruchomieniami w pętli działają w obu wariantach; w wariancie Edit Fields wyrażenie z `$runIndex` po zamianie `}}` na `} }` nie łamie parsera wyrażeń.

Do dnia 4: zaślepki OAuth2 i konta usługi, reguła tokenu, szablony zlewu dla Slack v2, HubSpot v2 i Google Sheets, pomiar `executeBatch`.

## Dzień 4 (2026-09-24), węzły aplikacyjne, OAuth2, `executeBatch`

Komenda `flowretest spike day4` (wynik w `docs/spike/day4-results.json`): Webhook, Edit Fields spłaszczające ciało, węzeł aplikacyjny z zapisem; 2 elementy na przypadek; reguły zlewu z `packages/services/src/sinks.ts`; tryb `--explore` (odpowiadanie `{}` na nieznane GET) nie był potrzebny, bo wszystkie żądania trafiły w szablony.

| Scenariusz | Poświadczenie | Wynik | Sekwencja żądań per element |
|---|---|---|---|
| Slack 2.7, message post, kanał po id | `slackApi` (token) | success, 2 zapisy | `POST /api/chat.postMessage` |
| Slack 2.7 | `slackOAuth2Api` | success, 2 zapisy | jak wyżej, bez odświeżania tokenu |
| HubSpot 2.2, contact upsert | `hubspotAppToken` | success, 2 zapisy | `POST /contacts/v1/contact/createOrUpdate/email/<email>`, potem `GET /contacts/v1/contact/vid/<vid>/profile` |
| HubSpot 2.2 | `hubspotOAuth2Api` | success, 2 zapisy | jak wyżej |
| Google Sheets 4.7, append z automapowaniem | `googleSheetsOAuth2Api` | success, 2 zapisy | raz: `GET /v4/spreadsheets/<id>`, `GET .../values/'Sheet1'` (nagłówki); potem `POST <id>:batchUpdate` i `PUT .../values/Sheet1!2:3` |
| Google Sheets 4.7 | `googleApi` (konto usługi, klucz RSA z runnera) | success, 2 zapisy | jak wyżej, plus `POST oauth2.googleapis.com/token` (JWT) przed każdym żądaniem |

Czas na przypadek przez `execute`: 7,7 do 8,8 s. `executeBatch --ids=<6 id> --concurrency=1 --output=/out/batch.json --snapshot=/out/snap/`: 8,8 s na wszystkie sześć (1,5 s na przypadek) wobec 49,5 s po kolei.

Wnioski:

1. Zaślepki OAuth2 z `oauthTokenData` i odległym `expires_in` działają: Slack i HubSpot nie odświeżają tokenu. Konto usługi Google podpisuje JWT wygenerowanym kluczem RSA i wymienia go na token przez regułę `token`; w trybie `cli` robi to przed każdym żądaniem, co jest widoczne w przechwyceniach jako szum do odfiltrowania w normalizacji.
2. Szablony zlewu z sekcji 6.5 planu są wystarczające dla trzech usług. Google Sheets append w 4.7 nie używa `values:append`, tylko `:batchUpdate` (dopisanie wierszy) i `PUT values/<zakres>`; nagłówki z `values.get` muszą odpowiadać kluczom elementów wejściowych, dlatego CLI wylicza je z nagrania. HubSpot upsert kontaktu idzie przez API v1 (`createOrUpdate`, potem `profile`), nie przez `/crm/v3`.
3. ADR 0002 uzupełniony: podstawową ścieżką wykonania jest `executeBatch --concurrency=1 --snapshot=<katalog>`. Plik `--output` to tylko podsumowanie, ale snapshot `<id>-snapshot.json` ma pełne `data.resultData.runData` z `startTime` i `executionTime` per uruchomienie węzła oraz `startedAt` i `stoppedAt` wykonania. Przypisanie przechwyceń do przypadku odbywa się po oknie czasowym wykonania, do węzła po czasach z `runData`; plik `current.json` zostaje dla `doctor` i dla ścieżki rezerwowej z `execute` per przypadek.
4. Import 6 poświadczeń i 6 workflow jedną komendą każdy: 12 do 13 s na komendę; to stały koszt przebiegu, nie na przypadek.

Zaliczone z planu dnia 4: Slack v2 i HubSpot v2 wykonują zapis do zlewu, Google Sheets działa z odległą datą wygaśnięcia oraz z regułą tokenu, decyzja o `executeBatch` podjęta. Do dni 5 i 6: Airtable v2, Notion, OpenAI Chat Model, Gemini, Postgres, Code z `fetch` i z `this.helpers.httpRequest`, multipart w HTTP Request.

## Dni 5 i 6 (2026-09-24), macierz węzłów

Komenda `flowretest spike day5` (wynik w `docs/spike/day5-results.json`): każdy scenariusz to Webhook z nagrania, Edit Fields spłaszczające ciało i węzeł pod testem; role wymuszone, żeby każdy węzeł wykonał się naprawdę. Oczekiwanie "przechwycony" oznacza zapis widoczny w `requests.jsonl` i status `success`; "głośny błąd" oznacza brak przechwycenia i wykonanie zakończone błędem.

| Węzeł | Oczekiwanie | Wynik | Uwagi |
|---|---|---|---|
| Airtable 2.1, record create, automapowanie | przechwycony | ok | jedno `POST /v0/<base>/<table>`, bez odczytu schematu |
| Notion 3, database page create | przechwycony | ok po poprawce szablonu | `GET /v1/data_sources/<id>`, potem `POST /v1/pages`; odpowiedź musi mieć właściwości z polem `type`, bo węzeł upraszcza wynik po typie; identyfikator musi być UUID, inaczej walidacja przed startem |
| Basic LLM Chain 1.7 z OpenAI Chat Model 1.2 | przechwycony | ok | `POST api.openai.com/v1/chat/completions` przez dispatcher undici honorujący proxy; szablon zwraca `choices` |
| Basic LLM Chain z Gemini Chat Model 1.1 | głośny błąd | ok | "fetch failed" z SDK Google, które omija proxy; sieć internal blokuje wyjście |
| Postgres 2.5, insert | głośny błąd | ok | `getaddrinfo EAI_AGAIN db.frt.invalid` po 13 s (timeout DNS); zaślepka celowo wskazuje host nierozwiązywalny |
| Code z `fetch` | głośny błąd | ok | `fetch is not defined` w task runnerze 2.40.5, więc nie ma czego przechwytywać ani wyciekać |
| Code z `this.helpers.httpRequest` | przechwycony | ok | RPC do procesu głównego, żądanie widoczne w proxy |
| HTTP Request 4.2, multipart z polem tekstowym | przechwycony | ok | proxy zapisuje części: nazwa, rozmiar, SHA-256 |
| Convert to File, potem HTTP Request multipart z plikiem | przechwycony | ok | część `file` z `filename` i `contentType`; regresja z issue #26748 nie wystąpiła w workflow głównym (sub-workflow poza zakresem) |

Bramka dni 5 i 6 z planu (6 z 8 węzłów HTTP przechwyconych, Postgres i Gemini z głośnym błędem): zaliczona z nadwyżką, 7 z 7 węzłów HTTP przechwyconych.

Wnioski:

1. Błędy walidacji przed startem ("Workflow has issues", np. niepoprawny identyfikator Notion) kończą wykonanie, zanim `execute` odbierze wynik; CLI wypisuje tylko "No active execution found", a `executeBatch --output` powtarza ten sam tekst. Prawdziwy komunikat leży w tabeli `execution_data` w SQLite sandboxa. Runner ma kopiować `database.sqlite` z wolumenu po przebiegu i czytać go modułem `node:sqlite` (Node 22.5 lub nowszy), żeby raport pokazał "workflow nie przeszedł walidacji: <treść>" zamiast ERROR bez opisu. Skaner statyczny powinien wcześniej sprawdzać format identyfikatorów w resource locatorach, gdy węzeł ma taką regułę.
2. Szablony zlewu wymagają wiedzy o tym, co węzeł robi z odpowiedzią, nie tylko o żądaniu: Notion czyta `properties.<pole>.type`, HubSpot czyta `vid` i pobiera profil, Sheets czytają nagłówki. Echo ciała żądania wystarcza dla HTTP Request i Airtable, nie dla węzłów z "uproszczeniem" wyniku.
3. Węzły LangChain: model OpenAI idzie przez proxy, Gemini nie. Węzeł główny (LLM Chain) i tak będzie odtwarzany z nagrania od 0.3 (punkt 6.2 planu), więc proxy dla modeli ma znaczenie tylko wtedy, gdy ktoś świadomie wykona łańcuch naprawdę.
4. Runner JavaScript 2.40.5 nie ma `fetch`, więc jedyną drogą z Code na zewnątrz są helpery n8n, które są przechwytywane. To zamyka niewiadomą 5 z sekcji 8 planu.
5. Czas przypadku w tym przebiegu 13 do 23 s (dwa razy więcej niż rano) przy obciążonej maszynie; pomiar nie jest miarodajny. `executeBatch` z dnia 4 pozostaje ścieżką podstawową.

Do dni 7 i 8: katalog regresji, przypadki 01 do 05, differ v0 z kluczem kanonicznym, normalizacja.

## Dzień 7 (2026-09-24), pierwszy plan: katalog 01 do 03, przypisanie, normalizacja, diff

Komenda `flowretest spike day7` (wynik i tekst planu w `docs/spike/day7-results.json`). Nowe moduły w `core`: `capture.ts` (okna czasowe z `runData`, przypisanie żądania do uruchomienia węzła), `normalize.ts` (placeholdery `<ts>`, `<uuid>`, `<epoch>`, `<token>`, szablon ścieżki `{id}` i `{email}`, kanoniczne ciało z posortowanymi kluczami i ścieżkami ignorowanymi, skrót), `diff.ts` (multizbiory per klucz węzeł, metoda, host, ścieżka; pary dokładne, pary po podobieństwie, pary resztek po czasie, dodane, usunięte, zablokowane; flagi `empty-value`, `missing-field`, `type-changed`, `expression-residue`, `duplicate-bodies`, `count-changed`), `render.ts` (plan tekstowy po angielsku, statusy, kody wyjścia). Przypadki katalogu jako kod w `packages/cli/src/catalog/cases.ts`.

Wynik na 2.40.5:

| Przypadek | Zmiana | Plan |
|---|---|---|
| 01 puste id po zmianie nazwy pola | mapowanie wskazuje `customerId` zamiast `id` z odczytu | 2 zmienione wywołania, `customer_id: "C-1" -> null`, flaga "empty value in an id field" |
| 02 pętla wysyła pierwszy rekord N razy | `$('Webhook').first()` zamiast `.item` w pętli | 1 zmienione wywołanie z różnicą e-maila i id, flaga "identical bodies sent more than once" |
| 03 Merge po pozycji obcina | Filter na jednym wejściu Merge | 1 usunięte wywołanie, flaga "operation count changed" |

Trzy poprawki po pierwszym przebiegu:

1. Przypisanie po czasie: okna węzłów są ciągłe (koniec jednego to początek następnego), a tolerancja 25 ms z zasadą "najpóźniejszy start" wybierała następny węzeł, gdy żądanie padło kilka ms przed jego startem. Teraz najpierw ścisłe zawieranie w oknie, tolerancja tylko przy braku trafienia. Zero nieprzypisanych żądań w sześciu przebiegach.
2. Parowanie resztek: dwa wywołania z tym samym kluczem i zerowym podobieństwem ciał (np. jedno pole o innej wartości) pokazywały się jako plus i minus; teraz resztki po obu stronach są parowane po czasie i pokazują różnice pól.
3. `null` jako wynik wyrażenia `undefined` w Edit Fields liczy się jako pusta wartość, nie jako zmiana typu.

Obserwacja: Edit Fields 3.4 dla wyrażenia zwracającego `undefined` przy typie string wysyła `null`, nie pomija pola; heurystyka pustej wartości obejmuje `null`.

Do dnia 8: przypadki 04 (Execute Once) i 05 (filtr w Code zerujący elementy), flaga `count-per-item-changed` z liczbą elementów na wejściu węzła, stabilizacja (podwójny przebieg starej wersji), `accept` v0.

## Dzień 8 (2026-09-24), katalog 04 do 06, liczniki, stabilizacja, `accept`

Ta sama komenda `flowretest spike day7` (wynik w `docs/spike/day8-results.json`). Nowe w `core`: `inputCounts` z pola `source` w `runData` (elementy na wejściu węzła, sumowane po uruchomieniach), flagi `count-per-item-changed` i `node-not-executed`, moduł `baseline.ts` (`toBaseline`, `fromBaseline`, `detectVolatile`, `maskVolatile`, `runsIdentical`).

| Przypadek | Zmiana | Plan |
|---|---|---|
| 04 Execute Once włączone na węźle piszącym | 1 zamiast 2 wywołań | 1 usunięte, flagi "operation count changed" i "calls per input item changed" |
| 05 filtr w Code zostawia zero elementów | workflow kończy się zielono i nic nie wysyła | 2 usunięte, flaga "node did not run in the new version" |
| 06 bez zmian, losowy `nonce` w ciele | brak zmiany | bez stabilizacji DIFF; po drugim przebiegu starej wersji ścieżka `nonce` uznana za zmienną, po maskowaniu PASS, oba przebiegi starej wersji identyczne |

`accept` na przypadku 01: baseline z 2 wywołań, nowa wersja wobec własnego baseline'u PASS, stara wersja wobec tego baseline'u DIFF.

Stan bramki 2 z planu (piątek dnia 10) po dniu 8:

- 4 z 5 regresji w diffie: 5 z 5, plus przypadek kontrolny 06;
- dwa identyczne przebiegi: tak, z wykrywaniem pól zmiennych;
- przypadek poniżej 60 s: 8 s przez `execute`, 1,5 s przez `executeBatch`;
- konfiguracja poniżej 60 minut na cudzym eksporcie i przebieg na `v3-nightly`: do dni 9 i 10, wymagają `pull` z prawdziwej instancji i obrazu 3.0.

Obserwacje:

1. Liczba elementów na wejściu z `source[0].previousNode` wystarcza dla łańcuchów i pętli; dla Merge z dwoma wejściami `source` ma dwa wpisy i liczony jest tylko pierwszy. Do poprawy przy skanerze statycznym (suma po wszystkich wejściach).
2. Case 05 pokazuje wartość flagi `node-not-executed`: bez niej "2 usunięte" wygląda jak celowa zmiana, z nią widać, że węzeł piszący w ogóle nie dostał danych.
3. Stabilizacja kosztuje jeden dodatkowy przebieg starej wersji i wykrywa tylko pola, które zmieniają się między dwoma przebiegami; wartości zależne od dnia (daty bez placeholdera) wymagają jawnego `normalize.ignore`.

Do dni 9 i 10: `pull` z publicznego API (fixture z prawdziwego wykonania), test konfiguracji na cudzym eksporcie ze stoperem, przebieg tego samego zestawu na obrazie 3.0 albo `v3-nightly`, `docs/spike/wyniki.md` jako podstawa bramki 2.

## Dzień 9 (2026-09-24), `init`, `pull`, `run` na prawdziwej instancji

Instancja deweloperska: `n8nio/n8n:2.40.5` w Dockerze poza sandboxem (`flowretest-dev-n8n`, port 5678), właściciel i klucz API założone przez `POST /rest/owner/setup` i `POST /rest/api-keys` (zakresy `workflow:read` oraz `execution:read` z pochodnymi), dwa workflow przez publiczne API: odbiornik oraz "Lead intake" (Webhook, HTTP Request GET `healthz`, Edit Fields, HTTP Request POST do odbiornika na hoście `host.docker.internal:8787`, skrypt `scripts/dev-receiver.mjs`). Sześć wykonań przez webhook, trzy z ostatniej wersji.

Nowe komendy w `packages/cli`: `init` (config.yml, secrets.env, reguły .gitignore, sprawdzenie Dockera), `pull` (klient publicznego API: workflow, wykonania stronicowane po 25 z `includeData`, fixture per wykonanie z `workflowData` oraz `workflowVersionId`, komunikaty o brakach), `run` (wersja stara z nagrań albo z pliku, nowa z pliku, klasyfikacja, rewriter, sandbox, `execute` per przypadek, przypisanie, normalizacja z `normalize.ignore`, opcjonalna stabilizacja, diff oraz plan, pliki `report.json` oraz `plan.txt` w `runs/<czas>/`, kod wyjścia).

Przebieg ze stoperem w świeżym katalogu:

| Krok | Czas | Wynik |
|---|---|---|
| `init --url --api-key --engine 2.40.5` | 2 s | config, sekrety, 3 reguły .gitignore |
| `pull --workflow <id> --last 3` | 4 s | 3 fixture'y z 3 wykonań, jedna wersja workflow |
| szkic: `customer_id` czyta `body.customerId` | | |
| `run --new draft.json --stabilize` | 148 s | 9 wykonań w sandboxie (stara, nowa, stara ponownie na 3 przypadki), plan: 3 zmienione, `customer_id: "C-1" -> null` z flagą, 3 z 3 węzłów piszących przechwycone, 3 odczyty (`healthz`) odtworzone z nagrań |

Łącznie poniżej 3 minut od pustego katalogu do planu; kryterium "konfiguracja poniżej 60 minut na cudzym eksporcie" jest spełnione na instancji deweloperskiej, a na eksporcie agencji do sprawdzenia w tygodniu 3.

Wnioski i poprawki:

1. Workflow z publicznego API zawiera pola `activeVersionId`, `shared`, `sourceWorkflowId`, `versionCounter`, `nodeGroups`, `staticData`, `isArchived` oraz znaczniki czasu; import do sandboxa kończył się `FOREIGN KEY constraint failed`. Rewriter zwraca teraz tylko `id`, `name`, `active`, `nodes` (z białą listą pól węzła), `connections`, `settings`.
2. Anonimowy `GET /rest/settings` nie zwraca `versionCli` (pokazuje go dopiero po zalogowaniu), więc `init` wymaga `--engine <tag>`; komunikat błędu to mówi. Automatyczne wykrywanie wersji wymagałoby logowania hasłem, czego runner nie robi.
3. `localhost` jest w `NO_PROXY`, więc workflow wołający własną instancję (np. `http://localhost:5678/webhook/...`) w sandboxie omija proxy i kończy błędem połączenia; raport pokaże to jako ERROR z komunikatem węzła. Do rozważenia: reguła w skanerze ostrzegająca o adresach `localhost` i `127.0.0.1` w węzłach HTTP.
4. Czas przebiegu przez `execute` per przypadek (około 15 s na wykonanie przy trzech wykonaniach na przypadek ze stabilizacją) uzasadnia przejście na `executeBatch --snapshot` w wersji 0.1.
5. Fixture'y z instancji deweloperskiej mają 3 do 4 kB; limit 5 MB jest daleko.

Do dnia 10: ten sam zestaw na obrazie 3.0 (`next` albo `v3-nightly`), decyzja o `executeBatch` w `run`, podsumowanie do bramki 2.

## Dzień 10 (2026-09-24), obraz 3.0, `executeBatch` w `run`, bramka 2

Obraz `n8nio/n8n:v3-nightly` z 2026-09-24 (digest `sha256:2d4136…`): `doctor` przeszedł wszystkie kontrole (import 61 s z migracjami, wykonanie 30 s, entrypoint ładuje CA jak w 2.x, linia o agentach proxy obecna, komendy `execute` oraz `list:workflow` bez zmian). Sześć przypadków katalogu na tym obrazie daje ten sam plan co na 2.40.5 (`docs/spike/day10-v3-results.json`).

`run` wykonuje teraz każdą stronę jedną komendą `executeBatch --concurrency=1 --output --snapshot` (partie: stara, nowa, opcjonalnie stara ponownie), a `execute` per przypadek zostaje jako ścieżka rezerwowa, gdy brakuje snapshotu. Przechwycenia są przypisywane do wykonania wyłącznie: rekord należy do ostatniego wykonania z partii, które zaczęło się przed nim (`startedAt` ze snapshotu); do węzła jak dotąd po oknach z `runData`. Pomiar na instancji deweloperskiej, 3 przypadki:

| Tryb | Czas |
|---|---|
| `execute` per przypadek, ze stabilizacją (9 wykonań) | 148 s |
| `executeBatch`, ze stabilizacją (3 partie) | 49 s |
| `executeBatch`, bez stabilizacji (2 partie) | 48 s |

Koszt stały (sandbox, import poświadczeń, import workflow) to około 30 s; koszt na przypadek w partii to 1 do 2 s, więc stabilizacja jest teraz prawie darmowa i może być domyślnie włączona.

Dwie pułapki `executeBatch` znalezione i obejście:

1. `--ids` jest filtrowane wyrażeniem `/\d+/`: identyfikator bez cyfry wypada z partii bez komunikatu (jeden z trzech naszych identyfikatorów tak wypadł). `workflowId()` kończy się teraz zawsze cyfrą.
2. Tolerancja czasowa na oknie wykonania nie może być dodatnia: kolejny przypadek w partii startuje kilka ms po poprzednim, więc rekord z jego początku trafiał do dwóch przypadków. Stąd przypisanie wyłączne.

### Bramka 2 (plan, sekcja 8, tydzień 2)

| Kryterium | Stan | Dowód |
|---|---|---|
| 4 z 5 regresji w diffie | 5 z 5 plus przypadek kontrolny | dzień 7 i 8, `day8-results.json` |
| dwa identyczne przebiegi | tak, z wykrywaniem pól zmiennych | przypadek 06, dzień 8 |
| konfiguracja poniżej 60 minut na cudzym eksporcie | poniżej 3 minut na instancji deweloperskiej; eksport agencji do sprawdzenia w tygodniu 3 | dzień 9 |
| przypadek poniżej 60 s | 8 s przez `execute`, 1 do 2 s w partii | dzień 4 i 10 |
| `execute` istnieje na 3.0 | tak, `doctor` i katalog na `v3-nightly` | dzień 10 |
| co najmniej dwie agencje deklarujące zainteresowanie, wynik DIY zapisany | poza zakresem sesji technicznej; punkty tygodnia 0 odłożone przez założyciela | |

Wniosek techniczny: żaden z warunków zamknięcia projektu (pokrycie poniżej 80%, niedziałające zaślepki poświadczeń, brak `execute` na 3.0) nie wystąpił. Pokrycie na instancji deweloperskiej 100%, na katalogu 83% (jedyny brak to celowo pominięty węzeł piszący, który nie wykonał się w nowej wersji). Techniczna część bramki 2 jest zaliczona; część rynkowa czeka na rozmowy.

Lista blokerów i skrótów do wersji 0.1 (tydzień 3):

- `init`: wykrywanie wersji wymaga `--engine`; opis w README i w komunikacie.
- błędy walidacji przed startem ("Workflow has issues") są niewidoczne dla `execute` i `executeBatch`; odczyt z `execution_data` w SQLite sandboxa po przebiegu.
- skaner statyczny: brak; pierwsze reguły w 0.1 według planu, w tym ostrzeżenie o `localhost` w URL węzłów.
- `accept` i `diff` jako komendy CLI: logika jest w `core/baseline.ts`, komend jeszcze nie ma.
- redakcja fixture'ów i raportu: brak (0.2).
- renderery JUnit i Markdown: brak (0.2).
- tabela ról usług obejmuje Slack, HubSpot, Google Sheets, Airtable i Notion; szablony zlewu również OpenAI i Gemini.
- instancja deweloperska (`flowretest-dev-n8n`, port 5678) i odbiornik (`scripts/dev-receiver.mjs`, port 8787) zostają uruchomione na potrzeby tygodnia 3.
