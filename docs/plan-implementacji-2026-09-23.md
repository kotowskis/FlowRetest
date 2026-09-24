# FlowRetest, plan implementacji (2026-09-23)

Plan techniczny do notatki decyzyjnej z 2026-09-23 ([analiza-pomyslu-2026-09-23.md](analiza-pomyslu-2026-09-23.md)). Obejmuje pierwsze 8 tygodni: spike wykonalności, CLI w wersjach 0.1 do 0.3 z GitHub Action i komendą `upgrade-check`, katalog regresji oraz przygotowanie decyzji o warstwie płatnej. Warstwa płatna (tygodnie 9 do 14) jest opisana na poziomie architektury i podziału na tygodnie, bo jej budowa zależy od bramki 5.

Fakty o n8n pochodzą z notatki decyzyjnej oraz z ponownego odczytu źródeł 2026-09-23: skrypt startowy obrazu, komenda `executeBatch`, referencja API wykonań (sekcja 15). Wszystko, co spike ma dopiero potwierdzić, jest oznaczone jako "do potwierdzenia" z numerem dnia.

Aktualizacja 2026-09-24 po przeglądzie: język interfejsu po angielsku; podmiana triggera dowolnego typu; odtwarzanie węzłów AI z nagrań; zasada danych w pilotażu z wcześniejszą redakcją fixture'ów; makieta raportu w harmonogramie; wersja n8n jako pytanie przesiewowe; protokół pilotażu; tydzień 0 z listą agencji, sprawdzeniem nazwy oraz decyzją o etacie E1; opinia prawna przed bramką 5.

## 1. Zakres, zespół, kalendarz

Co powstaje:

- runner CLI `flowretest` (npm, licencja MIT), uruchamiany u klienta, bez kodu n8n w środku;
- obraz proxy `flowretest-proxy` (GHCR), który przechwytuje ruch HTTP z sandboxa i odpowiada z reguł;
- GitHub Action publikująca wynik JUnit i komentarz z planem w pull requeście;
- katalog regresji: odtwarzalne przypadki "zielone, ale złe", które są zarazem testami e2e;
- dokumentacja: quickstart, opis formatów, decyzje architektoniczne (ADR).

Poza zakresem, tak jak w notatce: hostowane uruchamianie n8n, wykonywanie węzłów AI i ocena promptów (węzły AI są odtwarzane z nagrania, sekcja 6.2), węzły z zapisem poza HTTP (Postgres, MySQL, MongoDB, Redis, SMTP, SFTP, kolejki), węzeł Execute Sub-workflow w workflow nadrzędnym (sub-workflow testowany osobno jest wspierany), Wait, dane binarne, n8n 1.x, węzeł community, platformy inne niż n8n.

Zespół:

- E1, inżynier na pełny etat od 09-28 (decyzja w tygodniu 0; bez niej daty bramek nie obowiązują): cały kod runnera, proxy i CI;
- F, założyciel, około 2 dni w tygodniu: mail licencyjny, rozmowy z agencjami, przypadki do katalogu, cennik, testy ręczne na Windows;
- E2, opcjonalnie do 2 dni w tygodniu: eksperyment DIY, przegląd kodu, przypadki katalogu.

Kalendarz przy starcie w poniedziałek 2026-09-28; tydzień 0 to bieżący tydzień. Przesunięcie startu przesuwa daty, nie zmienia treści bramek.

| Tydzień | Daty | Wynik | Bramka |
|---|---|---|---|
| 0 | 09-24 do 09-27 | lista dziesięciu agencji z kontaktami, sprawdzenie kolizji nazwy, decyzja o etacie E1 | bez bramki |
| 1 | 09-28 do 10-02 | spike, dni 1 do 5 | bramka 1, piątek 10-02 |
| 2 | 10-05 do 10-09 | spike, dni 6 do 10 | bramka 2, piątek 10-09 |
| 3 | 10-12 do 10-16 | CLI 0.1: `init`, `pull`, `scan`, `run`, `diff` | bramka 3, piątek 10-16 |
| 4 | 10-19 do 10-23 | CLI 0.2: `accept`, `upgrade-check`, GitHub Action | bramka 4, piątek 10-23 |
| 5 do 8 | 10-26 do 11-20 | CLI 0.3: katalog 15 przypadków, macierz CI, redakcja, integracje | bramka 5, piątek 11-20 |
| 9 do 14 | 11-23 do 2027-01-08 | warstwa płatna, tylko po decyzji na bramce 5 | pierwsza faktura |

Słownik używany w kodzie i w raporcie:

- przypadek (case): jedno nagrane wykonanie użyte jako wejście testu;
- przebieg (run): wykonanie wszystkich przypadków na jednej wersji workflow i jednym obrazie n8n;
- plan: raport różnic między dwoma przebiegami, wzorowany na `terraform plan`;
- baseline: zaakceptowany, znormalizowany rejestr wywołań dla przypadku;
- zlew (sink): odpowiedź proxy udająca usługę, która nic nie zapisuje.

## 2. Stos technologiczny

Zasada: ten sam stos co Pstriq (npm workspaces, turbo, TypeScript, zod, node:test, Next.js z Supabase w części webowej), żeby jedna osoba przełączała się między projektami bez uczenia się nowych narzędzi.

| Element | Wybór | Powód |
|---|---|---|
| Monorepo | npm workspaces + turbo | jak `pstriq-monorepo`; zero nowych narzędzi |
| Język | TypeScript, ESM, `strict` | jeden język w runnerze i w proxy |
| Język interfejsu | angielski: CLI, help, README, raport, komunikaty błędów; po polsku tylko dokumenty wewnętrzne w `docs/` | klient jest globalny; tłumaczenie po fakcie kosztuje więcej niż decyzja teraz |
| Node do rozwoju | 24.x | jak `@pstriq/planner`; testy `.ts` bez transpilacji |
| Node u użytkownika CLI | 20 lub nowszy | bundel z tsup nie potrzebuje TypeScript w runtime |
| Framework CLI | commander | mały, stabilny, przewidywalny help |
| Walidacja | zod 4 | jak w Pstriq; schematy fixture'a, raportu, konfiguracji, reguł |
| Docker | wywołania `docker` przez execa | bez dockerode i bez wymogu compose; użytkownik ma Docker CLI |
| Proxy | mockttp w obrazie `node:22-alpine` | generowanie CA, MITM przez CONNECT, `forUnmatchedRequest().thenCloseConnection()`, zdarzenie `on('request')` |
| Proxy, rezerwa | mitmproxy z dodatkiem w Pythonie | gdy mockttp nie obsłuży jakiegoś wariantu TLS albo HTTP/2 |
| Testy | node:test + c8 | jak w Pstriq |
| Build | tsup | jeden bundel z shebangiem |
| JUnit XML | własny writer, około 80 linii | bez zależności |
| YAML | `yaml` | konfiguracja i stuby użytkownika |
| Kolory | picocolors | 1 kB, bez ESM-owych niespodzianek |
| Nazwy | npm `flowretest` (wolna 2026-09-23), `ghcr.io/skynappse/flowretest-proxy`, `skynappse/flowretest-action` | rezerwacja w dniu 1 |

Twarda reguła: żadnych pakietów n8n w zależnościach (`n8n`, `n8n-core`, `n8n-workflow`, `n8n-nodes-base`, `@n8n/*`). CI sprawdza lockfile skryptem `scripts/check-no-n8n-deps.mjs`. Runner zna n8n wyłącznie przez publiczne API, komendy CLI w obrazie i format JSON workflow.

## 3. Struktura repozytorium

```
flowretest/
  package.json              npm workspaces + turbo, engines node >= 24 (dev)
  turbo.json
  tsconfig.base.json
  packages/
    core/                   czyste funkcje bez IO: classifier, rewriter, normalizer, differ, scanner, model raportu
    cli/                    komendy, config, klient API n8n, orkiestracja dockera, renderery, baseline
    proxy/                  serwer mockttp + Dockerfile; czyta /rules/rules.json, pisze /capture/requests.jsonl
    services/               szablony zlewu, role operacji i zaślepki poświadczeń per usługa
    schemas/                schematy zod + wygenerowany JSON Schema: fixture, capture, rules, report, config
  action/                   GitHub Action (composite): uruchamia CLI, publikuje JUnit i komentarz
  catalog/                  katalog regresji: cases/<nr>-<nazwa>/{old.json,new.json,fixtures/,expected.json,README.md}
  docs/                     notatka decyzyjna, ten plan, adr/, formaty/
  scripts/                  check-no-n8n-deps.mjs, generowanie fixture'ów syntetycznych, pomiary czasu
  .github/workflows/        ci.yml (unit, lint, lockfile), e2e.yml (macierz obrazów n8n), release.yml (npm + GHCR)
```

Zasady podziału:

- `core` nie importuje niczego z `node:fs`, `node:child_process` ani z dockera. Każda funkcja dostaje dane i zwraca dane. To pozwala testować rewriter i diff bez Dockera i użyć tych samych funkcji w warstwie płatnej.
- `services` to dane plus małe funkcje: dla każdej usługi plik `roles.ts` (resource + operation do roli odczyt/zapis), `sink.ts` (szablony odpowiedzi), `credentials.ts` (zaślepki). Dodanie usługi nie dotyka `core`.
- `catalog` jest jednocześnie materiałem marketingowym i zestawem e2e. Każdy przypadek ma `expected.json` z oczekiwanym planem.

Decyzje architektoniczne zapisane w `docs/adr/` od dnia 1:

1. Przechwytywanie przez HTTPS_PROXY z własnym CA na obrazie klienta, bez forka i bez `n8n-core` w procesie runnera.
2. Każda komenda n8n jako osobne `docker run --rm` przez skrypt startowy obrazu, bez `docker exec` do uśpionego kontenera.
3. Odtwarzanie węzłów czytających węzłem Code z zachowanym `pairedItem`; Edit Fields plus Split Out jako rezerwa.
4. Sterowanie proxy przez pliki (reguły i przechwycenia na bind mountach), bez portu kontrolnego, bo sieć internal nie publikuje portów.
5. Punktem odniesienia jest wersja z nagrań, `accept` zapisuje baseline; oczekiwania ręczne tylko jako opcjonalny YAML.

## 4. Sandbox

### 4.1 Elementy

Jeden przebieg tworzy tymczasowy zestaw z identyfikatorem `<run>`:

- sieć `frt-<run>` utworzona z flagą `--internal`: kontenery widzą tylko siebie, nie mają trasy do internetu ani DNS dla hostów zewnętrznych;
- kontener `frt-<run>-proxy` z obrazu `flowretest-proxy`, w tej samej sieci, z dwoma bind mountami: `/rules` (tylko odczyt) i `/capture` (zapis) oraz `/ca` (certyfikat i klucz CA);
- wolumen `frt-<run>-n8n` montowany pod `/home/node/.n8n`: baza SQLite, logi;
- kontenery n8n uruchamiane na czas jednej komendy: `docker run --rm` z obrazem `n8nio/n8n:<tag klienta>`, z CA pod `/opt/custom-certificates` i katalogiem roboczym `/work` tylko do odczytu.

Dlaczego `docker run --rm` per komenda, a nie jeden uśpiony kontener z `docker exec`: skrypt startowy obrazu (`docker-entrypoint.sh`) sam wykrywa `/opt/custom-certificates`, ustawia `NODE_OPTIONS=--use-openssl-ca` oraz `SSL_CERT_DIR`, uruchamia `c_rehash` i wykonuje `exec n8n "$@"`. Każde `docker run n8nio/n8n:<tag> <komenda>` przechodzi tę ścieżkę, więc runner nie odtwarza logiki entrypointa i nie zależy od jej zmian w 3.0. Koszt to start procesu n8n na komendę, mierzony w dniach 3 i 4 (cel: poniżej 10 s).

### 4.2 Sekwencja komend jednego przebiegu

```
docker network create --internal frt-<run>
docker volume  create frt-<run>-n8n
docker run -d --name frt-<run>-proxy --network frt-<run> \
  -v <dir>/rules:/rules:ro -v <dir>/capture:/capture -v ~/.flowretest/ca:/ca \
  ghcr.io/skynappse/flowretest-proxy@sha256:<digest z proxy.lock.json>
# runner czeka, aż w ~/.flowretest/ca pojawi się flowretest-ca.pem i kopiuje go do <dir>/certs/

docker run --rm --network frt-<run> -v frt-<run>-n8n:/home/node/.n8n \
  -v <dir>/certs:/opt/custom-certificates:ro -v <dir>/work:/work:ro --env-file <dir>/n8n.env \
  n8nio/n8n:2.40.5 import:credentials --input=/work/credentials.json
docker run ... n8nio/n8n:2.40.5 import:workflow --separate --input=/work/cases/
docker run ... n8nio/n8n:2.40.5 list:workflow            # mapa nazwa -> id
# dla każdego przypadku:
#   runner zapisuje <dir>/capture/current.json = {"version":"new","case":"04"}
docker run ... n8nio/n8n:2.40.5 execute --id=<id> --rawOutput > runs/<ts>/new/case-04.raw.json

docker rm -f frt-<run>-proxy; docker volume rm frt-<run>-n8n; docker network rm frt-<run>
```

Wolumen i sieć są usuwane także po przerwaniu (SIGINT, wyjątek). `--keep-sandbox` zostawia je do debugowania, `flowretest sandbox prune` sprząta osierocone zestawy po prefiksie `frt-`.

Import przez `--separate` wczytuje wszystkie pliki z katalogu na raz. Jeden plik to jeden przypadek dla jednej wersji, nazwany `frt/<wersja>/<case>`, bo każdy ma inny wstrzyknięty fixture. `list:workflow` daje mapę nazwa do id, bo runner nie zakłada, że import zachowa id z pliku.

Optymalizacja do zmierzenia w dniach 3 i 4: `executeBatch --ids=<lista> --concurrency=1 --output=/work/out.json` wykonuje wszystkie przypadki w jednym procesie. Komenda istnieje na master z flagami `--ids`, `--concurrency`, `--output`, `--snapshot`, `--compare`, `--shallow`, `--retries`, `--shortOutput`; wymaga workflow w bazie. Wchodzi do 0.2 tylko wtedy, gdy skraca przebieg o ponad połowę i gdy jej wynik zawiera pełne `runData`; w innym razie zostaje `execute` per przypadek. Współbieżność zostaje na 1, bo plik `current.json` przypisuje przechwycenia do przypadku sekwencyjnie.

### 4.3 Zmienne środowiskowe kontenera n8n

Plik `n8n.env` generowany per przebieg. Lista do potwierdzenia na 2.40.5 i na obrazie 3.0 w dniu 1.

| Zmienna | Wartość | Po co |
|---|---|---|
| `N8N_ENCRYPTION_KEY` | losowa, per przebieg | spójne szyfrowanie zaślepek poświadczeń między `import` a `execute` |
| `HTTP_PROXY`, `HTTPS_PROXY` | `http://frt-<run>-proxy:8080` | globalne agenty proxy n8n 2.x w każdym procesie |
| `NO_PROXY` | `127.0.0.1,localhost` | broker task runnera |
| `N8N_LOG_OUTPUT`, `N8N_LOG_FILE_LOCATION` | `file`, `/home/node/.n8n/logs/n8n.log` | stdout zawiera tylko JSON z `--rawOutput`; log zostaje do diagnostyki |
| `N8N_LOG_LEVEL` | `info` (spike: `debug`) | linia "Installing global HTTP proxy agents" w spike'u |
| `N8N_DIAGNOSTICS_ENABLED`, `N8N_VERSION_NOTIFICATIONS_ENABLED`, `N8N_TEMPLATES_ENABLED` | `false` | brak prób wyjścia do internetu przy starcie |
| `N8N_ONBOARDING_FLOW_DISABLED`, `N8N_HIRING_BANNER_ENABLED`, `N8N_PERSONALIZATION_ENABLED` | `true`, `false`, `false` | mniej logiki startowej |
| `N8N_PUBLIC_API_DISABLED`, `N8N_COMMUNITY_PACKAGES_ENABLED`, `N8N_LICENSE_AUTO_RENEW_ENABLED` | `true`, `false`, `false` | sandbox nie jest serwerem |
| `N8N_SSRF_PROTECTION_ENABLED` | `false` | sandbox nie ma DNS; ochrona SSRF rozwiązuje nazwy hostów i by zablokowała wszystko |
| `N8N_RUNNERS_ENABLED`, `N8N_RUNNERS_MODE` | `true`, `internal` | węzeł Code w komendzie `execute`; do potwierdzenia w dniu 3 |
| `GENERIC_TIMEZONE`, `TZ` | z `config.yml` (`engine.timezone`) | daty jak na produkcji |
| `EXECUTIONS_TIMEOUT`, `EXECUTIONS_TIMEOUT_MAX` | `120`, `300` | twardy limit na przypadek; runner ma też własny limit na proces dockera |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `true` | `process.env` w Code kończy się błędem, skaner i tak to flaguje |

Sandbox nie dostaje kopii środowiska produkcyjnego. Jeśli workflow potrzebuje zmiennej środowiskowej, użytkownik dopisuje ją w `config.yml` w sekcji `engine.env`.

### 4.4 Szczelność

Trzy warstwy, każda wystarczająca sama:

1. Sieć `--internal`: brak trasy domyślnej i brak DNS dla hostów zewnętrznych. Żądanie poza proxy kończy się błędem połączenia.
2. Proxy nigdy nie przekazuje ruchu dalej: nie ma reguły `thenPassThrough`, a nieznane żądanie kończy `thenCloseConnection`. Proxy jest tylko w sieci internal, więc nie ma dokąd przekazać.
3. `flowretest doctor` wykonuje test dymny w prawdziwym sandboxie: workflow z HTTP Request do `https://example.com` musi trafić do przechwyceń, a `wget https://example.com` z kontenera n8n musi zakończyć się błędem. Wynik testu trafia do stopki raportu jako zdanie "0 żądań opuściło sandbox".

Task runner węzła Code (proces potomny) dostaje tylko dozwolone zmienne, więc `HTTP_PROXY` prawdopodobnie do niego nie dochodzi. `fetch` z Code kończy się wtedy błędem w sieci internal, `this.helpers.httpRequest` wraca przez RPC do procesu głównego i jest przechwycone. Do potwierdzenia w dniach 5 i 6; raport opisuje to w sekcji pokrycia.

### 4.5 Obraz proxy

Zachowanie serwera `packages/proxy/src/server.ts`:

- przy starcie wczytuje CA z `/ca` albo generuje je funkcją mockttp `generateCACertificate()` i zapisuje `flowretest-ca.pem` oraz `flowretest-ca.key`; certyfikat jest cachowany per maszyna w `~/.flowretest/ca/`, klucz nigdy nie trafia do kontenera n8n;
- nasłuchuje na `:8080` jako proxy HTTP z obsługą CONNECT i MITM dla wszystkich hostów;
- wczytuje `/rules/rules.json` przy starcie i przy zmianie pliku (fs.watch z debounce 200 ms);
- przy każdym żądaniu czyta `/capture/current.json` (wersja i przypadek), dopasowuje pierwszą pasującą regułę, potem odpowiada oraz dopisuje rekord do `/capture/requests.jsonl`;
- ciało żądania jest zapisywane do 256 kB; większe ma zapisany rozmiar oraz SHA-256; części multipart mają nazwę, nazwę pliku, rozmiar oraz skrót.

Kolejność reguł (pierwsza pasująca wygrywa):

| Priorytet | Reguła | Odpowiedź | `rule.kind` w raporcie |
|---|---|---|---|
| 1 | stub użytkownika (`--stub "<węzeł>=plik.json"`, wpis w `stubs.yml`) | z pliku | `user-stub` |
| 2 | szablon usługi (`packages/services`) | zależna od operacji, np. `201 {"id":"frt-7","properties":<echo>}` | `template` |
| 3 | endpoint tokenu OAuth (`/token`, `/oauth2/`, `/oauth/v2/`) | `200 {"access_token":"frt-mock","token_type":"Bearer","expires_in":3600}` | `token` |
| 4 | zapis do nieznanego hosta (POST, PUT, PATCH, DELETE) | `200 {"id":"frt-<seq>","ok":true}` | `generic-sink` |
| 5 | wszystko inne (GET, HEAD, OPTIONS do nieznanego hosta) | zamknięcie połączenia | `BLOCKED` |

Format `rules.json` generowany przez CLI; proxy jest celowo głupie, wszystkie wartości zależne od nagrania (np. wiersz nagłówków arkusza) wylicza CLI przed startem:

```json
{
  "schemaVersion": 1,
  "rules": [
    {
      "id": "user-stub:Upsert order",
      "match": { "host": "erp.example.com", "method": "POST", "path": "^/api/orders$" },
      "respond": { "status": 200, "json": { "id": "42", "status": "created" } }
    },
    {
      "id": "hubspot.contacts.create",
      "match": { "host": "api.hubapi.com", "method": "POST", "path": "^/crm/v3/objects/contacts$" },
      "respond": { "status": 201, "json": { "id": "{{seq}}", "properties": "{{echo body.properties}}" } }
    },
    {
      "id": "sheets.values.get",
      "match": { "host": "sheets.googleapis.com", "method": "GET", "path": "^/v4/spreadsheets/[^/]+/values/" },
      "respond": { "status": 200, "json": { "values": [["email", "name", "customer_id"]] } }
    },
    { "id": "generic-sink", "match": { "method": "POST|PUT|PATCH|DELETE" }, "respond": { "status": 200, "json": { "id": "frt-{{seq}}", "ok": true } } },
    { "id": "block", "match": {}, "respond": { "close": true } }
  ]
}
```

Funkcje szablonu: `{{seq}}` (licznik per reguła), `{{echo <ścieżka>}}` (fragment ciała żądania), `{{uuid}}`, `{{now}}`. Nic więcej; sekwencje odpowiedzi per usługa (np. najpierw wyszukiwanie, potem upsert) to lista reguł z polem `"times": 1`, zużywana po kolei.

Rekord przechwycenia (`requests.jsonl`, jedna linia na żądanie):

```json
{"ts":1759140000123,"version":"new","case":"04","method":"POST","host":"api.hubapi.com","port":443,
 "path":"/crm/v3/objects/contacts","query":{},"contentType":"application/json",
 "headers":{"content-type":"application/json","x-frt-has-authorization":"true"},
 "body":"{\"properties\":{\"email\":\"a@b.pl\",\"customer_id\":\"\"}}","bodyJson":{"properties":{"email":"a@b.pl","customer_id":""}},
 "bodyBytes":52,"bodySha256":"…","rule":{"id":"hubspot.contacts.create","kind":"template"},"response":{"status":201}}
```

Nagłówek `Authorization` nie jest zapisywany; zostaje flaga obecności.

### 4.6 Przypisanie wywołań do węzłów

Proxy widzi tylko HTTP, więc runner przypisuje żądania do węzłów po czasie. `--rawOutput` zwraca `runData` z `startTime` (epoka w ms) i `executionTime` (ms) dla każdego uruchomienia każdego węzła. n8n wykonuje węzły w obrębie jednego wykonania po kolei, więc przedziały czasowe węzłów się nie nakładają. Żądanie ze znacznikiem `ts` trafia do węzła, którego przedział je obejmuje; oba kontenery dzielą zegar jądra, także na Docker Desktop, gdzie oba żyją w tej samej maszynie wirtualnej. Żądanie bez pasującego przedziału (np. odświeżenie tokenu przed startem węzła) dostaje węzeł `?` i nie wchodzi do diffu, tylko do sekcji informacyjnej.

Dla węzła HTTP Request wersja 0.2 dodatkowo wstrzykuje nagłówek `X-FlowRetest-Node: <nazwa>` w `options.headers` jako kontrolę krzyżową; nagłówek jest usuwany przed normalizacją. Węzły aplikacyjne nie mają takiej opcji, więc czas pozostaje mechanizmem podstawowym.

## 5. Formaty danych

### 5.1 Katalog `.flowretest/`

```
.flowretest/
  config.yml                  URL instancji, wersja silnika, strefa czasowa, pola ignorowane, env sandboxa
  secrets.env                 FLOWRETEST_API_KEY (w .gitignore)
  <workflowId>/
    workflow.published.json   wersja z instancji w chwili pull
    fixtures/<executionId>.json
    stubs.yml                 stuby użytkownika dla węzłów bez nagrania albo poza HTTP
    volatile.json             pola uznane za zmienne po podwójnym przebiegu
    baseline/<case>.json      zaakceptowane rejestry
    runs/<ts>/                report.json, old/*.raw.json, new/*.raw.json, capture.jsonl, n8n.log
```

`init` dopisuje do `.gitignore`: `.flowretest/secrets.env`, `.flowretest/*/fixtures/`, `.flowretest/*/runs/`. Fixture'y zawierają dane klientów końcowych agencji, więc nie trafiają do gita bez `flowretest redact`.

### 5.2 `config.yml`

```yaml
schemaVersion: 1
instance:
  url: https://n8n.klient.example
engine:
  image: n8nio/n8n
  tag: 2.40.5
  timezone: Europe/Warsaw
  env: {}                       # dodatkowe zmienne dla sandboxa, np. własne stałe
proxy:
  image: ghcr.io/skynappse/flowretest-proxy
  digest: sha256:…              # z proxy.lock.json wersji CLI, nadpisywalne
normalize:
  ignore:                       # ścieżki JSONPath względem ciała żądania
    - $.properties.last_activity
  idSegments: [ "^\\d+$", "^[0-9a-f-]{36}$", "^rec[A-Za-z0-9]{14}$" ]
run:
  timeoutSeconds: 120
  stabilize: true               # pierwszy przebieg starej wersji wykonywany dwa razy
```

### 5.3 Fixture

```json
{
  "schemaVersion": 1,
  "source": { "instanceHost": "n8n.klient.example", "workflowId": "3fK…", "executionId": "18422",
              "workflowVersionId": "9e1c…", "startedAt": "2026-09-21T08:14:02.000Z", "mode": "webhook", "status": "success" },
  "workflowData": { "…": "wersja workflow, która wykonała to nagranie (z API, gdy includeData=true)" },
  "trigger": { "node": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
               "items": [ { "json": { "headers": {}, "params": {}, "query": {}, "body": { "email": "a@b.pl" } } } ] },
  "nodes": {
    "Lookup customer": { "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2,
      "runs": [ { "startTime": 1758442442100, "executionTime": 312,
                  "inputCount": 1, "items": [ { "json": { "id": "C-10442" }, "pairedItem": { "item": 0 } } ] } ] }
  },
  "sizeBytes": 18211,
  "redacted": false
}
```

`pull` zapisuje wyjścia wszystkich węzłów, także tych spoza roli odczytu, żeby zmiana klasyfikacji nie wymagała ponownego pobrania. Domyślny limit 5 MB na fixture (`--max-size`); większe są pomijane z komunikatem.

### 5.4 Raport (`report.json`)

Górny poziom: `schemaVersion`, `generatedAt`, `workflow` (id, nazwa, wersja stara i nowa), `engine` (obraz i digest dla każdej strony), `fixtures` (lista przypadków z id wykonań), `summary` (liczby wywołań, zmienione, dodane, usunięte, zablokowane, statusy przypadków), `coverage` (węzły piszące ogółem i przechwycone, węzły odtworzone, węzły nieobsługiwane), `static` (wynik skanera), `cases` (lista) oraz `sandbox` (wynik testu szczelności, wersja runnera).

Element `cases[].calls[]`: `op` (`=`, `~`, `+`, `-`, `!`), `node`, `runIndex`, `method`, `host`, `pathTemplate`, `fieldDiffs[]` (`path`, `old`, `new`), `flags[]` (`empty-value`, `missing-field`, `type-changed`, `count-per-item-changed`, `duplicate-bodies`, `expression-residue`, `replay-input-mismatch`, `stale-ai-replay`), `rule` (rodzaj reguły, która odpowiedziała).

Ten sam JSON zasila każdy renderer i jest jedynym formatem, który w przyszłości wysyła się do warstwy płatnej po redakcji (sekcja 6.13).

### 5.5 Baseline

`baseline/<case>.json`: znormalizowany rejestr wywołań przypadku, `acceptedAt`, `acceptedBy` (użytkownik systemowy), `message`, `workflowVersionId` nowej wersji, `engineDigest`, `runnerVersion`. Baseline jest odrzucany z ostrzeżeniem, gdy zmienił się `schemaVersion` normalizacji.

## 6. Moduły

### 6.1 Klient API n8n (`cli/src/api`)

- Nagłówek `X-N8N-API-KEY`, baza `/api/v1`. Klucz z `FLOWRETEST_API_KEY` albo z `secrets.env`. Wymagane zakresy: `workflow:read`, `execution:read`.
- `GET /workflows/{id}`: opublikowana wersja.
- `GET /executions?workflowId=&status=success&includeData=true&limit=25&cursor=`: stronicowanie po 25 (domyślne 100, maksimum 250; przy `includeData=true` duże strony kończyły się błędami 502 i 400 według relacji z forum). Odpowiedź daje `workflowVersionId`, `workflowData`, `data.resultData.runData`, `dataTooLargeToDisplay`, `jsonSizeBytes`. Przy `dataTooLargeToDisplay` runner pobiera pojedyncze wykonanie z `ignoreDataSizeLimit=true` i sprawdza limit rozmiaru.
- Filtry `startedAfter` i `startedBefore` dla `--since`.
- Komunikaty dla typowych ścian: brak zapisanych wykonań (ustawienie workflow albo `EXECUTIONS_DATA_SAVE_ON_SUCCESS`), API niedostępne na trialu Cloud, `redactExecutionData` (Enterprise), retencja 14 dni albo 10 000 wykonań na self-hosted.
- Ponowienia: 3 próby z wykładniczym odstępem dla 429, 502, 503, 504.
- Wersja instancji: najlepsza próba przez `GET /rest/settings` (endpoint wewnętrzny, pole `versionCli`); gdy niedostępny, `init` pyta o tag obrazu. `pull` drukuje wykrytą wersję w pierwszej linii i ostrzega poniżej 2.20, bo przechwytywanie opiera się na globalnym proxy w każdym procesie, które jest zachowaniem 2.x; instancja na 1.x wyklucza pilotaż do czasu aktualizacji.

### 6.2 Klasyfikator ról (`core/src/classify`)

Każdy węzeł dostaje rolę: `trigger`, `read`, `write`, `logic`, `replace`, `unsupported`.

- Triggery: podmienialny jest każdy węzeł, od którego zaczęło się nagranie (`fixture.trigger.node`), niezależnie od typu: Webhook, Schedule Trigger, Manual Trigger, ale też Gmail Trigger, HubSpot Trigger, Google Sheets Trigger oraz inne triggery aplikacyjne, bo rewriter zastępuje węzeł jego nagranym wyjściem. Execute Workflow Trigger jest podmieniany, gdy to on wystartował nagranie (test sub-workflow osobno, nagrania z wykonań w trybie `integrated`); w innym razie jest usuwany, bo komenda `execute` startuje od niego przed Manual Trigger. Form Trigger i Chat Trigger podlegają tej samej zasadzie, ale nie są w macierzy testów MVP.
- HTTP Request: `read` dla GET, HEAD, OPTIONS ustawionych statycznie; `write` dla pozostałych; metoda z wyrażenia daje `write` z flagą `do przeglądu`. Ustawiona opcja Proxy w węźle daje `unsupported`, bo ominęłaby sandbox.
- Węzły aplikacyjne z tabelą `resource + operation` w `services/<usługa>/roles.ts`: HubSpot v2, Slack v2, Airtable v2, Google Sheets v4.x, Notion v2. Przykład dla Google Sheets: `read` daje `read`; `append`, `update`, `appendOrUpdate`, `delete`, `clear` dają `write`.
- `logic` (biała lista, wykonywane naprawdę): Edit Fields, IF, Switch, Filter, Code (JavaScript), Merge, Split Out, Aggregate, Loop Over Items, Limit, Remove Duplicates, Sort, No Operation, Rename Keys, Date & Time, Crypto, Compare Datasets, Summarize.
- `replace`: Respond to Webhook jest zamieniany na No Operation z tą samą nazwą i połączeniami; w trybie `cli` nie ma odpowiedzi HTTP, a węzeł nie wysyła niczego na zewnątrz. Do potwierdzenia w dniu 3, czy bez zamiany węzeł kończy się błędem.
- Węzły AI (`replay-ai`, wersja 0.3): węzeł główny klastra (AI Agent, Basic LLM Chain, OpenAI, Information Extractor, Text Classifier, Sentiment Analysis) ma zapisane wyjście jak każdy węzeł, więc jest podmieniany jak węzeł czytający; sub-węzły podłączone przez połączenia `ai_languageModel`, `ai_memory`, `ai_tool`, `ai_outputParser`, `ai_embedding`, `ai_vectorStore` są usuwane razem z połączeniami. Gdy parametry węzła (prompt, model, opcje) różnią się między wersjami, przypadek dostaje flagę `stale-ai-replay`. Węzeł AI bez nagrania kończy jako BLOCKED. Ocena nowego promptu pozostaje poza zakresem.
- Odczyty spoza listy usług: odtwarzanie nie zależy od typu węzła, ogranicza je tylko wiedza, czy operacja jest odczytem. W 0.3 dochodzi tabela ról dla Postgres i MySQL: `select` jest odtwarzany z nagrania, `executeQuery` jest traktowany jak zapis, a zapisy kończą jako BLOCKED.
- Wszystko poza listami: `unsupported` (zapisy Postgres, MySQL, MongoDB, Redis, Send Email, FTP, SSH, Execute Command, Read/Write Files, Execute Sub-workflow w workflow nadrzędnym, Wait, Code w Pythonie, węzły community).
- Osiągalność: skaner liczy węzły osiągalne z triggera po `connections`; `unsupported` poza ścieżką to ostrzeżenie, na ścieżce to kod wyjścia 3 i pominięcie przypadku.

### 6.3 Rewriter (`core/src/rewrite`)

Wejście: JSON workflow, fixture, wynik klasyfikacji. Wyjście: JSON gotowy do importu, bez `id`, `versionId`, `pinData`, `tags`, `meta`, z `active: false` i nazwą `frt/<wersja>/<case>`.

1. Trigger. Zostaje ten, który wykonał nagranie (`fixture.trigger.node`), niezależnie od typu; pozostałe triggery i ich połączenia są usuwane, w tym Execute Workflow Trigger, chyba że to on jest startem nagrania. Trigger jest zastępowany parą: Manual Trigger `frt:start` i węzeł odtwarzający o nazwie oryginalnego triggera, z zachowaną pozycją i połączeniami wyjściowymi, więc `$('Webhook').item.json.body` dalej działa.
2. Węzeł odtwarzający, wariant podstawowy: Code (JavaScript, tryb "Run Once for All Items") zwracający `RUNS[$runIndex]` z elementami i `pairedItem` z nagrania. To zachowuje powiązania elementów dla węzłów niżej, także przy wielu uruchomieniach w pętli.
3. Węzeł odtwarzający, wariant rezerwowy (gdy `execute` nie startuje task runnera): Edit Fields w trybie JSON z tablicą elementów, `executeOnce: true`, potem Split Out o nazwie oryginału. `pairedItem` wskazuje wtedy zawsze element 0; raport dostaje ostrzeżenie "powiązania elementów utracone za węzłem X". Wybór wariantu w dniu 3.
4. Węzły `read` z nagraniem, a od 0.3 także węzły AI po usunięciu ich sub-węzłów, są zastępowane tak samo jak trigger. Gdy liczba elementów na wejściu węzła odtwarzanego różni się od nagrania, `pairedItem` jest przycinany do zakresu, a przypadek dostaje flagę `replay-input-mismatch` z liczbami; to samo w sobie jest sygnałem regresji przed węzłem piszącym.
5. Węzły `read` bez nagrania (gałąź, która nie wykonała się w nagraniu) zostają bez zmian. Jeśli nowa wersja do nich dotrze, proxy blokuje GET, przypadek kończy jako BLOCKED z podpowiedzią `--stub`.
6. Węzły `write` i `logic` zostają bez zmian.
7. Ustawienia: `executionTimeout` na wartość z `config.yml`, usunięcie `errorWorkflow`, zachowanie `executionOrder` i `timezone`.
8. Limit rozmiaru wstrzykniętych danych: 1 MB na węzeł; powyżej limitu węzeł jest oznaczany jako `unsupported: nagranie za duże` z podpowiedzią `--stub`.

Testy jednostkowe rewritera pracują na 6 workflow wzorcowych z katalogu (webhook, schedule, pętla, dwie gałęzie, merge, sub-workflow jako przypadek nieobsługiwany).

### 6.4 Zaślepki poświadczeń (`services/*/credentials.ts`)

Rewriter zbiera z workflow trójki `(typ, id, nazwa)` z pola `credentials` każdego węzła i generuje plik do `import:credentials` z tymi samymi id i nazwami. Dane per typ:

| Typ | Dane zaślepki |
|---|---|
| `httpHeaderAuth` | `{ name: "Authorization", value: "Bearer frt-mock" }` |
| `httpBasicAuth` | `{ user: "frt", password: "frt" }` |
| `httpQueryAuth` | `{ name: "api_key", value: "frt-mock" }` |
| `hubspotAppToken`, `slackApi`, `airtableTokenApi`, `notionApi` | pojedynczy token `frt-mock` |
| `*OAuth2Api` (HubSpot, Slack, Airtable, Google Sheets, Notion) | `clientId`, `clientSecret` i `oauthTokenData` z `access_token: "frt-mock"`, `refresh_token: "frt-mock"`, `token_type: "Bearer"`, `expires_in: 315360000` |
| `googleApi` (konto usługi) | e-mail testowy i klucz RSA generowany per przebieg (`node:crypto`); żądanie tokenu trafia w regułę tokenu |
| nieznany typ | `{}` i ostrzeżenie w raporcie |

Nazwy pól są potwierdzane w dniu 3 metodą: na instancji deweloperskiej utworzyć prawdziwe poświadczenia każdego typu, wyeksportować `export:credentials --all --decrypted`, przepisać nazwy pól do tabeli. Gdy węzeł mimo odległej daty wygaśnięcia odświeża token, odpowiada reguła tokenu z sekcji 4.5.

### 6.5 Szablony zlewu (`services/*/sink.ts`)

Każda usługa ma listę reguł z sekcji 4.5 oraz funkcję `prepare(fixture)`, która wylicza wartości zależne od nagrania. Przykłady:

- Google Sheets: `append` z automatycznym mapowaniem najpierw pobiera wiersz nagłówków (`values.get`); szablon zwraca nagłówki równe kluczom pierwszego elementu wejściowego węzła z nagrania. Bez tego regresja z przesunięciem kolumn nie jest odtwarzalna.
- HubSpot: `upsert` najpierw wyszukuje (`/search`), potem tworzy albo aktualizuje; szablon zwraca `total: 0` dla wyszukiwania i `201` z echem właściwości dla utworzenia. Opcja `prepare` może zwrócić `total: 1` z nagranym id, gdy nagranie pokazuje aktualizację.
- Slack: `chat.postMessage` daje `{ ok: true, ts: "<seq>", channel: <echo> }`; `conversations.list` (gdy węzeł rozwiązuje nazwę kanału) daje jeden kanał o nazwie z parametru węzła.
- Airtable: `records` POST/PATCH daje echo pól z `id: "rec<seq>"`.
- Notion: `pages` POST daje `{ object: "page", id: "<uuid>" }`.

Reguła projektowa: szablon ma odpowiadać na wewnętrzne odczyty węzła piszącego tak, żeby węzeł doszedł do zapisu; nie ma udawać całej usługi. Koszt 1 do 2 dni na usługę, zgodnie z notatką.

### 6.6 Executor (`cli/src/sandbox`)

- `SandboxSession`: tworzy sieć i wolumen, startuje proxy, czeka na CA, generuje `n8n.env`, wykonuje komendy z limitem czasu (`timeoutSeconds + 30` na proces), sprząta w `finally` i na SIGINT.
- Parser `--rawOutput`: wczytuje stdout, bierze ostatni kompletny obiekt JSON (na wypadek stronicowania logów, choć logi idą do pliku), waliduje zodem minimalny kształt `data.resultData.runData` i `data.resultData.error`.
- Obrazy: `docker pull` tylko gdy brak lokalnie; proxy zawsze po digestcie z `proxy.lock.json`; n8n po tagu z konfiguracji, digest zapisywany do raportu (`docker image inspect`).
- Pomiar czasu na przypadek i na start procesu, zapisywany w raporcie; budżet z notatki: przypadek poniżej 60 s.

### 6.7 Normalizacja (`core/src/normalize`)

Wejście: rekordy przechwycenia przypisane do węzłów. Wyjście: lista wywołań z kluczem i kanonicznym ciałem.

- Nagłówki: do porównania zostaje tylko `content-type` i flaga obecności autoryzacji; `Date`, `User-Agent`, `Content-Length`, `Idempotency-Key`, `X-Request-Id`, `traceparent` wypadają.
- Placeholdery typowane: daty ISO 8601 dają `<ts>`, epoka 10 i 13 cyfr w oknie przebiegu daje `<epoch>`, UUID daje `<uuid>`, wartości zaczynające się od `Bearer ` dają `<token>`.
- Ścieżka: segmenty pasujące do `idSegments` z konfiguracji dają `{id}`; parametry zapytania zachowują klucze, wartości podlegają tym samym placeholderom.
- Ciało: JSON z posortowanymi kluczami rekurencyjnie, liczby w formie kanonicznej, `application/x-www-form-urlencoded` parsowane do obiektu, multipart jako lista części z nazwą, nazwą pliku, rozmiarem oraz skrótem.
- Ścieżki ignorowane z `config.yml` (`normalize.ignore`) i pola z `volatile.json` są zastępowane przez `<ignored>`.
- Stabilizacja: przy pierwszym `run` dla workflow stara wersja wykonuje się dwa razy; pola różniące się między przebiegami trafiają do `volatile.json` i do sekcji raportu "pola uznane za zmienne", z możliwością edycji. `accept` wymaga dwóch identycznych przebiegów nowej wersji, inaczej pokazuje różnice i odmawia bez `--force`.
- Klucz wywołania: `(węzeł, metoda, host, ścieżka po szablonowaniu)`; skrót kanonicznego ciała osobno.

### 6.8 Diff i heurystyki (`core/src/diff`)

Dla każdego przypadku i węzła porównywane są dwa multizbiory wywołań, bo HTTP Request v3 i v4 wysyła żądania równolegle przez `Promise.allSettled`, a kolejność gałęzi zależy od układu na canvasie.

1. Pary identyczne (klucz i skrót ciała) wypadają jako `=`.
2. Reszta o tym samym kluczu jest parowana zachłannie po podobieństwie spłaszczonych ścieżek pól (indeks Jaccarda); pary dają `~` z listą różnic pól.
3. Pozostałe z nowej wersji dają `+`, ze starej `-`.
4. Wywołania, na które proxy odpowiedziało zamknięciem, dają `!`.

Flagi na wywołaniach nowej wersji i na różnicach:

- `empty-value`: `""`, `null`, `"undefined"`, `"null"`, `"NaN"`, `"[object Object]"` w polu, którego nazwa kończy się na `id`, `Id`, `_id`, `email`, albo które w starej wersji było niepuste;
- `missing-field`: pole obecne w starej wersji, nieobecne w nowej;
- `type-changed`: np. tekst zamiast obiektu;
- `count-per-item-changed`: liczba wywołań węzła podzielona przez liczbę elementów na jego wejściu różni się między wersjami (dwie operacje zamiast jednej);
- `duplicate-bodies`: co najmniej dwa identyczne kanoniczne ciała w jednym uruchomieniu węzła, których nie było w starej wersji;
- `expression-residue`: `{{`, ciągi zaczynające się od `=`, tekst `undefined` w wartościach;
- `replay-input-mismatch`: z rewritera;
- `stale-ai-replay`: węzeł AI odtworzony z nagrania, choć jego parametry zmieniły się między wersjami (od 0.3).

Status przypadku: `ERROR`, gdy nowa wersja zakończyła się błędem węzła, a stara nie (raport podaje węzeł i komunikat); `BLOCKED` przy jakimkolwiek `!`; `DIFF` przy `~`, `+`, `-` poza baseline'em; `SKIPPED` dla przypadków pominiętych przez skaner; inaczej `PASS`. Ponowienia węzła (`retryOnFail`) liczone są jako próby tylko wtedy, gdy proxy odpowiedziało kodem innym niż 2xx albo zamknięciem; przy zlewie n8n nie ponawia, więc powtórzone ciała to osobne operacje.

### 6.9 Skaner statyczny (`core/src/scan`)

Pracuje na dwóch JSON-ach bez wykonywania. Wynik trafia do sekcji `static` raportu i na początek wydruku `scan`:

- tabela wsparcia: węzeł, typ, `typeVersion`, rola, status (obsługiwany, odtwarzany, zamieniany, nieobsługiwany), osiągalność z triggera;
- zmiany `typeVersion` między wersjami;
- wiszące odwołania `$('Nazwa')`, `$("Nazwa")`, `$node["Nazwa"]`, `$items("Nazwa")` po zmianie nazwy węzła;
- zmiany id poświadczeń;
- przełączniki `executeOnce`, `alwaysOutputData`, `onError`, `retryOnFail`, `maxTries`, `waitBetweenTries`, `disabled`;
- użycie `.item` po Merge, Aggregate, Summarize albo Code oraz po wyjściu błędu, gdzie `pairedItem` ginie;
- dwa węzły IF o identycznych warunkach;
- `process.env` i `$env` w Code;
- opcja Proxy w HTTP Request;
- zmiany połączeń: dodane i usunięte krawędzie, zmiana indeksu wyjścia.

Każde znalezisko ma wagę (`info`, `warn`, `error`) i identyfikator reguły (`S001` do `S0xx`), żeby katalog mógł je cytować.

### 6.10 Renderery i kody wyjścia (`cli/src/report`)

Jeden model, cztery wyjścia: terminal (picocolors, szerokość 100 kolumn, bez tabel), JSON (`report.json` bez zmian), JUnit XML (jeden `testcase` na przypadek; `failure` dla DIFF i ERROR, `skipped` dla SKIPPED i BLOCKED z komunikatem), Markdown (nagłówek planu, tabela zmian, sekcje zwijane per przypadek, stopka z pokryciem; limit 60 kB dla komentarza w PR).

Wydruk terminalowy, po angielsku jak cały interfejs:

```
FlowRetest 0.1.0 · "Lead intake" (3fK…) · n8nio/n8n:2.40.5 (sha256:ab12…)
Cases: 10 (executions 2026-09-15 to 2026-09-22) · old: recorded version (9e1c…) · new: draft.json

Plan: 23 calls (old version: 21). 2 changed, 1 added, 0 removed, 3 blocked.

~ [04] HubSpot "Create contact"   POST api.hubapi.com/crm/v3/objects/contacts
       properties.customer_id: "C-10442" -> ""                      ! empty value in an id field
~ [07] HTTP Request "Push to ERP" POST erp.example.com/api/orders
       2 calls instead of 1 for the same item                       ! operation count changed
+ [02] Slack "Notify"             POST slack.com/api/chat.postMessage   (new in this version)
! [09] Postgres "Upsert order"    BLOCKED: non-HTTP node, no stub       (--stub "Upsert order"=file.json)

Coverage: 6 of 7 write nodes captured (86%) · nodes replayed from recordings: 3 · 0 requests left the sandbox
Result: DIFF (exit code 1) · accept: flowretest accept --run 2026-10-14T10-22
```

Kody wyjścia: 0 wszystkie przypadki PASS; 1 co najmniej jeden DIFF; 2 co najmniej jeden ERROR; 3 BLOCKED albo węzeł nieobsługiwany na ścieżce; 4 błąd środowiska (brak Dockera, brak dostępu do API, brak obrazu); 5 błąd wewnętrzny runnera. Kolejność ważności: 5, 4, 2, 3, 1, 0.

### 6.11 Baseline (`cli/src/baseline`)

`accept` bierze ostatni przebieg (albo `--run <ts>`), sprawdza stabilność (sekcja 6.7), zapisuje rejestr nowej wersji per przypadek jako baseline z metadanymi. Kolejny `run` porównuje nową wersję z baseline'em, gdy istnieje, a bez niego ze starą wersją; `--against old|baseline` wymusza wybór. Zmiana `workflowVersionId` fixture'ów względem baseline'u daje ostrzeżenie, nie błąd.

### 6.12 `upgrade-check` (`cli/src/commands/upgrade-check.ts`)

Ta sama ścieżka co `run`, z dwiema różnicami: obie strony wykonują tę samą opublikowaną wersję workflow, a obrazy są dwa (`--engine-old 2.40.5 --engine-new 3.0.0`). Raport ma sekcję "Engine differences" i te same statusy. Sandbox jest tworzony osobno dla każdego obrazu, bo wolumen SQLite po migracji do wyższej wersji nie wraca do niższej. Dni 9 i 10 spike'u testują tę ścieżkę na `v3-nightly`; do potwierdzenia, czy komenda `execute` i skrypt startowy nie zmieniły się w 3.0.

### 6.13 Redakcja (`core/src/redact`; `--fixtures` w 0.2, raport w 0.3)

Dwa tryby:

- `flowretest redact --fixtures`: wartości tekstowe w fixture'ach zastępowane wartościami syntetycznymi o tym samym typie i długości (e-maile jako `user<n>@example.com`, telefony jako `+48 000 000 <n>`), z zachowaniem powtarzalności w obrębie fixture'a (ta sama wartość daje tę samą zamianę). Do katalogu i do zgłaszania błędów. Wersja 0.2, zanim jakikolwiek plik z pilotażu trafi poza maszynę agencji.
- redakcja raportu przed wysyłką (wersja 0.3, warunek warstwy płatnej): w `fieldDiffs` i w wywołaniach wartości są zastępowane przez typ, długość oraz 8 znaków skrótu SHA-256; nazwy pól, ścieżki, liczby oraz flagi zostają. Pełny raport zostaje lokalnie w `runs/<ts>/`.

## 7. Interfejs CLI

| Komenda | Najważniejsze flagi | Działanie |
|---|---|---|
| `flowretest init` | `--url`, `--api-key`, `--engine 2.40.5`, `--timezone` | zapisuje `config.yml` i `secrets.env`, dopisuje `.gitignore`, sprawdza Docker, próbuje wykryć wersję instancji |
| `flowretest doctor` | `--no-sandbox` | Docker, obrazy, test szczelności, test CA, test task runnera, wersje |
| `flowretest pull` | `--workflow <id>`, `--last 10`, `--since <data>`, `--max-size 5mb`, `--include-errors` | pobiera opublikowany JSON i fixture'y; stronicuje po 25; raportuje braki |
| `flowretest scan` | `--old <plik>`, `--new <plik>` | tabela wsparcia i diff statyczny; kod 3 przy nieobsługiwanym węźle na ścieżce |
| `flowretest run` | `--new <plik>`, `--old <plik>` albo `--old published` albo `--old recorded` (domyślne), `--engine`, `--cases 01,04`, `--stub "<węzeł>=<plik>"`, `--no-stabilize`, `--keep-sandbox`, `--format terminal,json,junit,md`, `--out <dir>` | wykonuje oba przebiegi, zapisuje `runs/<ts>/`, drukuje plan |
| `flowretest diff` | `--run <ts>`, `--against old,baseline`, `--format` | renderuje ponownie bez wykonania |
| `flowretest accept` | `--run <ts>`, `--case`, `--message`, `--force` | zapisuje baseline po sprawdzeniu stabilności |
| `flowretest upgrade-check` | `--engine-old`, `--engine-new`, `--workflow` | ta sama wersja na dwóch obrazach |
| `flowretest redact` | `--fixtures`, `--report <plik>` | `--fixtures` od 0.2, `--report` od 0.3 |
| `flowretest sandbox` | `prune`, `export --compose` | sprzątanie; eksport zestawu jako compose do debugowania |

Flagi globalne: `--json` (wyjście maszynowe na stdout, logi na stderr), `--verbose`, `--no-color`, `--cwd`. Domyślna wartość `--old recorded` bierze wersję workflow z `workflowData` fixture'ów, gdy wszystkie mają ten sam `workflowVersionId`; przy różnych wersjach runner prosi o `--old published` albo `--old <plik>`.

Przepływ z notatki, cel poniżej godziny: `npx flowretest init`, `flowretest pull --workflow <id> --last 10`, `flowretest scan --new draft.json`, `flowretest run --new draft.json`, `flowretest diff`, `flowretest accept`.

## 8. Harmonogram tygodni 1 do 8

Zasada spike'u: kod od pierwszego dnia powstaje w docelowej strukturze repozytorium (`packages/core`, `packages/cli`, `packages/proxy`), z testami tam, gdzie są tanie. Spike ma dać odpowiedzi, ale bez przepisywania w tygodniu 3. Dokument `docs/spike/wyniki.md` zbiera pomiary i decyzje z każdego dnia.

### Tydzień 1 (09-28 do 10-02)

| Dzień | E1 | F / E2 | Wynik |
|---|---|---|---|
| 1, pon | bootstrap repo: workspaces, turbo, tsconfig, lint, `check-no-n8n-deps`, CI unit; rezerwacja nazw npm i GHCR; szkielet `packages/proxy` z mockttp i generowaniem CA; ADR 1 do 5 | F: mail do license@n8n.io z opisem architektury i pytaniem o klauzulę o benchmarkingu; umówienie 10 rozmów z listy z tygodnia 0, z pytaniem przesiewowym o wersję n8n; F albo E2: makieta raportu (statyczny HTML z przykładowym planem po angielsku), gotowa na dzień 3 | repo publiczne (puste), ADR-y |
| 2, wt | `SandboxSession` v0: sieć internal, proxy, `docker run` n8n z CA; workflow testowy z HTTP Request do `https://example.com`; `doctor` z testem szczelności | E2: start eksperymentu DIY (integration-mock plus diff w jq na jednej regresji, pomiar godzin); dokończenie makiety raportu | log "Installing global HTTP proxy agents", żądanie w `requests.jsonl`, `wget` z kontenera kończy błędem |
| 3, śr | rewriter v0: podmiana triggera; oba warianty węzła odtwarzającego; `import:workflow`, `execute --rawOutput`, parser; test task runnera w `execute`; zaślepki poświadczeń wg `export:credentials --decrypted` z instancji dev | F: 2 rozmowy z makietą raportu | wybór wariantu odtwarzania (ADR 3 uzupełniony); tabela pól poświadczeń; podmiana triggera sprawdzona na Webhook, Schedule oraz HubSpot Trigger |
| 4, czw | zaślepki OAuth2 i konta usługi; reguła tokenu; pomiar czasu startu procesu; test `executeBatch` na 5 przypadkach | F: 2 rozmowy | Slack v2 i HubSpot v2 wykonują zapis do zlewu; Google Sheets działa z odległą datą wygaśnięcia albo z regułą tokenu; decyzja o `executeBatch` |
| 5, pt | macierz węzłów, część 1: HTTP Request 4.x, Slack v2, HubSpot v2, Google Sheets, Airtable v2 | F: 1 rozmowa; E2: wynik DIY zapisany | bramka 1 |

Bramka 1: HTTP Request plus dwa węzły aplikacyjne przechwycone przy zerowym wyjściu z sieci. Brak oznacza stop.

### Tydzień 2 (10-05 do 10-09)

| Dzień | E1 | F / E2 | Wynik |
|---|---|---|---|
| 6, pon | macierz węzłów, część 2: Notion, OpenAI Chat Model, Gemini, Postgres, Code z `fetch`, Code z `this.helpers.httpRequest`, HTTP Request z multipart; zapis wyników w `docs/spike/matrix.md` | F: 2 rozmowy | 6 z 8 węzłów HTTP przechwyconych; Postgres i Gemini kończą głośnym błędem |
| 7, wt | katalog: przypadki 01 do 03 (wiszące odwołanie po zmianie nazwy, pętla odwołująca się do triggera, Merge "combine by position"); differ v0 z kluczem kanonicznym | E2: przypadki 04 i 05 jako JSON (Execute Once, filtr w Code zerujący 8 elementów) | 3 regresje widoczne w diffie |
| 8, śr | przypadki 04 i 05 w runnerze; flagi `empty-value`, `count-per-item-changed`, `duplicate-bodies`; normalizacja v0 | F: 2 rozmowy | 4 z 5 regresji w diffie |
| 9, czw | stabilizacja (dwa przebiegi), `volatile.json`, `accept` v0; przebieg na `v3-nightly`; pomiar czasu na przypadek | F: 1 rozmowa; przygotowanie cudzego eksportu do testu konfiguracji | identyczne baseline'y; `execute` istnieje na 3.0 |
| 10, pt | konfiguracja na cudzym eksporcie ze stoperem; `docs/spike/wyniki.md`; lista blokerów do 0.1 | F: podsumowanie 10 rozmów w `docs/rozmowy-2026-10.md`; protokół pilotażu na jedną stronę w `docs/pilotaz-protokol.md` (mierzone: czas konfiguracji ze stoperem, pokrycie, liczba odtworzonych błędów, decyzja o zapłacie; role; zasada: dane agencji nie opuszczają jej maszyny) | bramka 2 |

Bramka 2: 4 z 5 regresji w diffie, dwa identyczne przebiegi, konfiguracja poniżej 60 minut na cudzym eksporcie, przypadek poniżej 60 s, co najmniej dwie agencje deklarujące zainteresowanie wdrożeniem, wynik DIY zapisany. Brak oznacza stop.

### Tydzień 3 (10-12 do 10-16), CLI 0.1

| Zadanie | Dni | Właściciel |
|---|---|---|
| `init` i `config.yml` z walidacją zod; `secrets.env`; `.gitignore` | 0,5 | E1 |
| klient API: stronicowanie po 25, `--since`, `dataTooLargeToDisplay`, komunikaty ścian (sekcja 6.1) | 1 | E1 |
| `pull` z formatem fixture'a i limitem rozmiaru; `workflowData` jako domyślna stara wersja | 0,5 | E1 |
| `scan`: tabela wsparcia i pierwsze 6 reguł statycznych (S001 do S006: typeVersion, wiszące odwołania, id poświadczeń, przełączniki, `.item` po Merge, Proxy w HTTP Request) | 1 | E1 |
| `run` i `diff`: renderer terminalowy i JSON; kody wyjścia; `--keep-sandbox`; sprzątanie na SIGINT | 1 | E1 |
| testy jednostkowe `core` na 6 workflow wzorcowych; e2e na 5 przypadkach katalogu na 2.40.5 | 0,5 | E1 |
| README quickstart; `npm publish --tag next` (0.1.0-next.1); GHCR obraz proxy z digestem w `proxy.lock.json` | 0,5 | E1 |
| uruchomienie na jednym prawdziwym workflow u każdej z 3 agencji (na maszynie agencji przez screen share, z ich eksportem i ich fixture'ami) | 3 sesje | F z E1 |

Zasada pilotażu, zapisana w protokole z dnia 10: sesje odbywają się na maszynie agencji przez screen share; Skynappse nie otrzymuje eksportów ani fixture'ów z danymi klientów końcowych; do wersji 0.2 zgłoszenia błędów są opisowe, od 0.2 pliki przechodzą przez `flowretest redact --fixtures`.

Bramka 3: trzy agencje uruchomiły narzędzie na własnym eksporcie; lista blokerów; co najmniej 4 z 5 znanych błędów odtworzone na ich workflow. Tydzień jest napięty. Jeśli spike zostawi mniej niż 60% kodu do ponownego użycia, 0.1 przesuwa się o tydzień, a bramki 3 do 5 o tydzień, bez zmiany ich treści.

### Tydzień 4 (10-19 do 10-23), CLI 0.2

| Zadanie | Dni | Właściciel |
|---|---|---|
| `accept` z metadanymi i sprawdzeniem stabilności; `--against` | 0,5 | E1 |
| renderery JUnit i Markdown; limit 60 kB | 0,5 | E1 |
| GitHub Action (composite): wejścia `instance-url`, `api-key`, `workflow-id`, `new-file`, `old-file`; kroki: `npx flowretest@<wersja> pull`, `run --format junit,md`, publikacja JUnit, komentarz w PR z `github-script`; przykład dla układu n8n-as-code (`--old` z gałęzi bazowej, `--new` z PR) | 1 | E1 |
| `upgrade-check` na 2.40.x i na obrazie 3.0 (gdy nie ma wydania, `v3-nightly`); sekcja "Engine differences" | 1 | E1 |
| `redact --fixtures` (sekcja 6.13), zanim agencje prześlą jakiekolwiek pliki | 1 | E1 |
| poprawki po blokerach z bramki 3 | 0,75 | E1 |
| `npm publish` 0.2.0; przypomnienie do license@n8n.io; pierwsze płatne wdrożenie | 0,25 | E1 / F |

Bramka 4: dwie agencje użyły narzędzia przy realnej zmianie albo przy próbie aktualizacji do 3.0; jedna zapłaciła za wdrożenie; odpowiedź licencyjna albo eskalacja przez sales@n8n.io.

### Tygodnie 5 do 8 (10-26 do 11-20), CLI 0.3

| Zadanie | Dni | Tydzień |
|---|---|---|
| katalog do 15 przypadków z `expected.json` i README per przypadek; fixture'y syntetyczne | 4 | 5 do 6, E1 z E2 |
| macierz e2e w CI: obrazy 2.20.x, 2.30.x, 2.40.5, `next`; cron tygodniowy na `next` z automatycznym issue przy regresji | 1,5 | 5 |
| nagłówek `X-FlowRetest-Node` dla HTTP Request; `executeBatch`, jeśli dzień 4 dał zielone światło | 0,5 | 5 |
| odtwarzanie węzłów AI: usuwanie sub-węzłów `ai_*`, flaga `stale-ai-replay`, przypadek katalogu z AI Agent | 2 | 6 |
| tabela ról Postgres i MySQL dla odczytów (`select` odtwarzany z nagrania) | 0,5 | 6 |
| zamówienie opinii prawnej o Sustainable Use License i o umowie powierzenia danych, gotowej na bramkę 5 | 0 (F) | 6 |
| redakcja raportu (sekcja 6.13) | 1,5 | 6 |
| skaner: reguły S007 do S012 (duplikaty IF, `process.env`, zmiany połączeń, `.item` po wyjściu błędu, `disabled`, Respond to Webhook) | 1 | 6 |
| publikacja wyników `upgrade-check` dla 3.0 na forum (wątki 306721, 313427, 254023) i w katalogu | 1 | 6, F |
| PR do n8n-as-code z subkomendą `test` wywołującą runner; propozycja narzędzia `flowretest_replay` w n8n-mcp | 2 | 7 |
| dokumentacja formatów (`docs/formaty/`), FAQ o licencji i o tym, co runner wysyła (nic) | 1 | 7 |
| makieta warstwy płatnej (HTML statyczny na danych z prawdziwego raportu) pokazana 3 agencjom; licznik 30 dni od pierwszego raportu | 1,5 | 7 do 8, F |
| bufor na blokery od agencji i na zmiany w 3.0 | 4 | 5 do 8 |
| wydanie 0.3.0; przygotowanie decyzji na bramkę 5 (`docs/bramka-5.md`) | 1 | 8 |

Suma dla E1 to 19 dni na 20 roboczych, z buforem 4 dni w środku. Gdy bufor się wyczerpie, odtwarzanie węzłów AI przechodzi do wersji 0.4, a bramka 5 zostaje bez zmian.

Bramka 5: dwie z trzech agencji zapłaciły za wdrożenie albo za plan Team; pisemna odpowiedź licencyjna bez wymogu umowy; pokrycie na ich eksportach co najmniej 80%. Wszystkie trzy warunki dają decyzję o warstwie płatnej z budżetem 6 tygodni; inaczej wersja wyłącznie OSS plus usługi, w tym audyt migracji do 3.0.

## 9. Testy i CI

- Jednostkowe (`node --test`, c8, próg 80% w `core`): rewriter, klasyfikator, normalizacja, diff, skaner, parser `--rawOutput`, parser JSONL. Fixture'y testowe są syntetyczne i leżą w `packages/core/test/fixtures/`.
- Kontraktowe dla `services`: każda reguła szablonu ma test "żądanie z nagrania z katalogu daje odpowiedź, którą węzeł akceptuje" uruchamiany w e2e, plus test jednostkowy funkcji `prepare`.
- E2E (`e2e.yml`, ubuntu-latest, Docker dostępny): dla każdego obrazu z macierzy runner wykonuje wszystkie przypadki katalogu i porównuje `report.json` z `expected.json` po usunięciu pól zmiennych; dodatkowo test szczelności z `doctor` i test determinizmu (dwa przebiegi identyczne). Obrazy cachowane przez `actions/cache` na warstwach dockera; jeden przebieg macierzy ma zmieścić się w 20 minutach.
- Windows i macOS: testy jednostkowe na `windows-latest` i `macos-latest`; e2e na Windows ręcznie przez F przy każdym wydaniu (Docker Desktop, bind mounty, ścieżki).
- Wydajność: e2e zapisuje czas na przypadek; regresja powyżej 60 s na 2.40.5 blokuje wydanie.
- Bezpieczeństwo: `check-no-n8n-deps`, `npm audit` na poziomie high, brak sekretów w raportach (test: raport z fixture'a zawierającego token nie zawiera go w żadnym formacie), `.gitignore` sprawdzany przez `init` w teście.
- Statyczne: eslint (konfiguracja z Pstriq), `tsc --noEmit`, sprawdzenie, że `core` nie importuje modułów IO (reguła eslint `no-restricted-imports`).

## 10. Wydania i dystrybucja

- Semver 0.x; tag `v0.x.y` uruchamia `release.yml`: testy z buildem, publikacja `npm publish --provenance`, budowa obrazu proxy z pushem do GHCR pod tagiem wersji oraz digestem, aktualizacja `proxy.lock.json` w tym samym commicie wydania. CLI odmawia pracy z obrazem proxy o innym digestcie niż w locku, chyba że `config.yml` nadpisuje.
- Kanały: `latest` po bramce 3 (0.1.0), `next` dla wersji między bramkami.
- Wspierane wersje n8n: od 2.20 wzwyż, w macierzy CI; 3.0 po wydaniu. Polityka: nowa wersja minor n8n co tydzień, cron na obrazie `next` co poniedziałek, regresja tworzy issue z etykietą `engine`.
- Telemetria: żadnej w wersji OSS. Jedyne wyjścia sieciowe runnera to instancja klienta (API) i rejestry obrazów.
- Nazewnictwo: produkt to "FlowRetest for n8n"; nazwa n8n nie jest częścią nazwy pakietu ani obrazu. Przed rezerwacją nazw 30 minut na sprawdzenie kolizji (npm, GitHub, domeny, bazy znaków towarowych EUIPO i USPTO); kolizja oznacza zmianę nazwy przed pierwszym commitem, nie po.
- Changelog w `CHANGELOG.md` (Keep a Changelog), sekcja "Zmiany w n8n, które wymusiły zmianę" per wydanie.

## 11. Warstwa płatna, tygodnie 9 do 14 (po decyzji na bramce 5)

Stos jak w Pstriq: Next.js 16 z App Router, Supabase (Postgres, auth, storage), Stripe, Resend, Tailwind 4. Osobna aplikacja `apps/web` w tym samym monorepo, korzystająca z `packages/core` do renderowania raportów i z `packages/schemas` do walidacji.

Model danych: `organizations`, `members` (role owner, member), `workspaces` (jedna instancja klienta agencji: host, tag silnika), `workflows`, `runs` (raport po redakcji jako JSONB, metadane, digesty), `acceptances` (kto, kiedy, komunikat, `workflowVersionId`), `github_installations` (GitHub App), `notifications` (kanał, adres), `plans` (Team, Agency, limity, retencja).

Przepływy:

- `flowretest run --upload` wysyła raport po redakcji tokenem workspace'u (`FLOWRETEST_TOKEN`), dostaje URL raportu; pełny raport zostaje lokalnie.
- Przeglądarka raportu: ten sam plan co w terminalu, z historią per workflow i porównaniem dwóch przebiegów.
- Akceptacja baseline'u w aplikacji zapisuje wpis w `acceptances`; runner synchronizuje baseline przy `pull`.
- GitHub App tworzy Check z wynikiem i linkiem; blokada merge to konfiguracja gałęzi po stronie klienta.
- Powiadomienia e-mail i Slack (webhook) o DIFF i ERROR.
- Eksport PDF "co by wysłano" per przebieg (react-pdf albo satori z Pstriq).
- Macierz dryfu silnika: wyniki `upgrade-check` per workspace i wersja, jako pierwsza wersja widoku "co się zmieni po aktualizacji".

Podział:

| Tydzień | Zakres |
|---|---|
| 9 | auth, organizacje, workspace'y, tokeny; endpoint `POST /api/runs`; przeglądarka raportu |
| 10 | akceptacje z historią; synchronizacja baseline'u z runnerem; powiadomienia e-mail |
| 11 | GitHub App i Check; webhook Slack |
| 12 | Stripe: Team 79 EUR i Agency 199 EUR, limity workspace'ów i retencji, faktury |
| 13 | eksport PDF; macierz dryfu v0; strona cennika |
| 14 | dokument powierzenia danych (DPA) i polityka retencji; testy obciążeniowe uploadu; start sprzedaży |

Warunki wstępne: pisemna odpowiedź licencyjna, opinia prawnika o Sustainable Use License i o umowie powierzenia danych (zamówiona w tygodniu 6, gotowa na bramkę 5), redakcja raportu w runnerze (0.3), co najmniej trzy agencje z aktywnym użyciem.

## 12. Ryzyka techniczne i plany awaryjne

| Moduł | Ryzyko | Wykrycie | Plan awaryjny |
|---|---|---|---|
| Poświadczenia | węzły `requestWithAuthentication` albo OAuth2 odrzucają zaślepki | dni 3 i 4 | reguła tokenu; adapter per typ poświadczeń; jeśli więcej niż 3 adaptery, koniec tezy o niskim utrzymaniu (kryterium zamknięcia) |
| Zlew | HubSpot albo Google Sheets wymagają sekwencji odczytów, których szablon nie zna | dni 5 i 6 | reguły sekwencyjne z `times`; `--stub` jako obejście; węzeł oznaczony "częściowo" w pokryciu |
| Rewriter | Code w `execute` nie ma task runnera | dzień 3 | wariant Edit Fields plus Split Out z ostrzeżeniem o utracie powiązań |
| Rewriter | Respond to Webhook kończy błędem w trybie `cli` | dzień 3 | zamiana na No Operation (zaplanowana) |
| Executor | start procesu n8n powyżej 10 s | dzień 4 | `executeBatch --concurrency=1`; uśpiony kontener z `docker exec` i ręcznie ustawionymi `NODE_OPTIONS` i `SSL_CERT_DIR` jako ostatnia opcja |
| Proxy | mockttp nie obsłuży jakiegoś wariantu TLS albo multipart (regresja z issue #26748 pod globalnym agentem) | dzień 6 | obraz z mitmproxy o tym samym kontrakcie plików; multipart oznaczany "nieobsługiwane" do czasu potwierdzenia |
| Szczelność | Docker Desktop na Windows obsługuje sieć internal inaczej | dzień 2 i test F | `doctor` wymusza stop, gdy `wget` z kontenera się powiedzie; dokumentacja wymagań |
| Przypisanie | dwa węzły z żądaniami w tej samej milisekundzie | e2e determinizm | nagłówek `X-FlowRetest-Node` dla HTTP Request; węzeł `?` w raporcie zamiast zgadywania |
| Normalizacja | szum diffu z pól zmiennych | stabilizacja | `volatile.json`, `normalize.ignore`, placeholdery; raport pokazuje, które pola zignorowano |
| API | brak zapisanych wykonań, trial Cloud, retencja | `pull` | komunikaty z instrukcją; ręczny fixture z YAML jako wejście alternatywne (0.3) |
| Pokrycie | agencje pilotażowe na n8n 1.x | pytanie przesiewowe w rozmowach, pierwsza linia `pull` | pilotaż po aktualizacji instancji albo inna agencja z listy |
| Dane | fixture'y z danymi klientów końcowych trafiają do Skynappse | protokół pilotażu | sesje na maszynie agencji; `redact --fixtures` od 0.2; zgłoszenia opisowe do tego czasu |
| 3.0 | zmiana skryptu startowego, komendy `execute` albo task runnera | dni 9 i 10, cron na `next` | wersja runnera z gałęzią `engine-3`; `upgrade-check` jako pierwszy wykrywacz |
| Licencja | odpowiedź wymagająca umowy | tydzień 4 do 8 | runner zostaje OSS; warstwa płatna wstrzymana; usługi wdrożeniowe |
| Zespół | E1 zajęty Pstriq | co tydzień | plan ma bufor 4 dni w tygodniach 5 do 8; bramki przesuwają się o tydzień bez zmiany treści |

## 13. Definicja ukończenia

Wersja 0.1 (bramka 3):

- `init`, `pull`, `scan`, `run`, `diff` działają na Linux, macOS i Windows z Docker Desktop;
- 5 przypadków katalogu przechodzi e2e na 2.40.5 z oczekiwanym planem;
- `doctor` potwierdza szczelność; raport ma stopkę pokrycia;
- README prowadzi od `npx flowretest init` do pierwszego planu w mniej niż godzinę na cudzym eksporcie;
- README, help CLI, raport i komunikaty błędów po angielsku;
- pakiet na npm w kanale `latest`, obraz proxy w GHCR z digestem w locku.

Wersja 0.2 (bramka 4):

- `accept`, JUnit, Markdown, GitHub Action z komentarzem w PR, `redact --fixtures`;
- `upgrade-check` na dwóch obrazach z sekcją "różnice silnika";
- e2e na 2 obrazach; czas na przypadek poniżej 60 s.

Wersja 0.3 (bramka 5):

- 15 przypadków katalogu, macierz 4 obrazów, cron na `next`;
- redakcja fixture'ów i raportu; test "brak sekretów w raporcie";
- reguły skanera S001 do S012;
- odtwarzanie węzłów AI z flagą `stale-ai-replay`; tabela ról Postgres i MySQL dla odczytów;
- dokumentacja formatów i FAQ licencyjne; `docs/bramka-5.md` z liczbami do decyzji.

## 14. Checklista tygodnia 0 i dnia 1

- [ ] tydzień 0: lista dziesięciu agencji z kontaktami (pięć nicków z forum, trzy z experts.n8n.io, dwie z Polski), z pytaniem o wersję n8n w pierwszej wiadomości;
- [ ] tydzień 0: sprawdzenie kolizji nazwy FlowRetest (npm, GitHub, domeny, EUIPO, USPTO);
- [ ] tydzień 0: decyzja o pełnym etacie E1 od 09-28;
- [ ] dni 1 i 2: makieta raportu po angielsku (statyczny HTML) na rozmowy od dnia 3;
- [ ] słownik terminów produktu po angielsku (plan, case, baseline, sink, blocked, replayed) w `docs/formaty/glossary.md`;
- [ ] repo `skynappse/flowretest` publiczne, licencja MIT, `CODE_OF_CONDUCT` i `SECURITY.md`;
- [ ] nazwa `flowretest` na npm zarezerwowana wydaniem 0.0.1 (pusty pakiet z README);
- [ ] pakiet `ghcr.io/skynappse/flowretest-proxy` utworzony;
- [ ] `check-no-n8n-deps` w CI;
- [ ] ADR 1 do 5 w `docs/adr/`;
- [ ] mail do license@n8n.io wysłany, kopia w `docs/licencja/`;
- [ ] instancja deweloperska n8n 2.40.5 z poświadczeniami każdego typu z sekcji 6.4 do eksportu nazw pól;
- [ ] lista zmiennych środowiskowych z sekcji 4.3 sprawdzona w dokumentacji 2.40.5;
- [ ] `docs/spike/wyniki.md` założony z tabelą dni 1 do 10.

## 15. Źródła

- [notatka decyzyjna](analiza-pomyslu-2026-09-23.md), sekcje 5 do 8 i 11;
- [docker-entrypoint.sh](https://raw.githubusercontent.com/n8n-io/n8n/master/docker/images/n8n/docker-entrypoint.sh): obsługa `/opt/custom-certificates` i `exec n8n "$@"`;
- [execute-batch.ts](https://raw.githubusercontent.com/n8n-io/n8n/master/packages/cli/src/commands/execute-batch.ts): flagi `executeBatch`;
- [execute.ts](https://raw.githubusercontent.com/n8n-io/n8n/master/packages/cli/src/commands/execute.ts): tylko `--id` i `--rawOutput`;
- [API wykonań](https://docs.n8n.io/connect/n8n-api/executions.md): parametry `limit`, `cursor`, `includeData`, `ignoreDataSizeLimit`, `status`, `workflowId`, `startedAfter`; pola `workflowVersionId`, `workflowData`, `dataTooLargeToDisplay`;
- [CLI n8n](https://docs.n8n.io/deploy/host-n8n/configure-n8n/use-the-command-line): `import:workflow --separate`, `import:credentials`, `export:credentials --decrypted`;
- [http-proxy.ts](https://raw.githubusercontent.com/n8n-io/n8n/master/packages/@n8n/backend-network/src/http/http-proxy.ts): globalne agenty proxy;
- [mockttp](https://github.com/httptoolkit/mockttp): generowanie CA, `forUnmatchedRequest`, `thenCloseConnection`, `on('request')`;
- [issue #26748](https://github.com/n8n-io/n8n/issues/26748): multipart pod globalnym agentem proxy;
- [rejestr npm](https://registry.npmjs.org/flowretest): nazwa wolna 2026-09-23.
