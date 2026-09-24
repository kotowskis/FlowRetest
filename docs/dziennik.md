# Dziennik po spike'u

Postępy względem planu implementacji (sekcja 8) po dniu 10. Spike jest opisany w `docs/spike/wyniki.md`.

## Tydzień 3 (start 2026-09-24), CLI 0.1

Zrobione:

- skaner statyczny w `core/scan.ts`: tabela wsparcia (trigger, odtwarzany, wykonywany, zamieniany, nieobsługiwany, osiągalność), reguły S000 (nieobsługiwany na ścieżce), S001 (typeVersion), S002 (wiszące odwołanie), S003 (id poświadczeń), S004 (przełączniki węzła), S005 (`.item` za Merge, Aggregate, Summarize albo Code), S006 (opcja Proxy), S008 (`process.env` w Code), S009 (dodane i usunięte węzły oraz połączenia), S010 (zmiana nazwy węzła po id), S011 (węzeł wyłączony), S012 (zmiana parametrów), S013 (adres `localhost` w HTTP Request);
- komendy `scan`, `diff` (ponowne renderowanie przebiegu, także wobec baseline'u) i `accept` (baseline per przypadek z autorem i komunikatem);
- `run` w trybie partii z wyłącznym przypisaniem przechwyceń do wykonań, sprzątanie sandboxa po Ctrl+C, rejestry wywołań i pola zmienne w `report.json`, odczyt błędów walidacji sprzed startu z bazy SQLite sandboxa (`node:sqlite`);
- wersja `0.1.0-next.1`, README pakietu po angielsku, CHANGELOG, `npm pack --dry-run` (58 kB, 65 plików), test e2e katalogu (`npm run e2e -w packages/cli`).

Sprawdzone na instancji deweloperskiej: `run` daje DIFF wobec nagranej wersji, `accept` zapisuje trzy baseline'y, `diff --against baseline` daje PASS i pozostaje PASS po kolejnym przebiegu.

Do zrobienia w tym tygodniu (bramka 3, piątek):

- publikacja `0.1.0-next.1` na npm z kanałem `next` i obrazu proxy w GHCR (wymaga logowania założyciela: `npm login`, `docker login ghcr.io`);
- macierz e2e w CI (`.github/workflows/e2e.yml`) na obrazach 2.40.5 i `v3-nightly`;
- sesje z trzema agencjami na ich eksportach; lista blokerów;
- reguła w `scan` ostrzegająca, gdy fixture'y pochodzą z innej wersji workflow niż opublikowana.

Znane skróty wersji 0.1:

- `accept` nie wymusza dwóch identycznych przebiegów nowej wersji; `--stabilize` maskuje pola zmienne przed zapisem;
- `init` wymaga `--engine`, bo anonimowy `GET /rest/settings` nie zwraca wersji;
- brak redakcji fixture'ów (0.2) i renderera JUnit oraz Markdown (0.2);
- workflow wołający własną instancję przez `localhost` kończy w sandboxie błędem połączenia; `scan` to ostrzega, `run` pokazuje ERROR.

## Tydzień 4 (2026-09-24), CLI 0.2

Zrobione:

- `run --stabilize` wykonuje obie wersje dwa razy: pola zmienne z obu par, znacznik `stable` per przypadek w `report.json`; `accept` odmawia bez sprawdzonej stabilności albo przy niestabilnej nowej wersji, chyba że `--force`;
- `run --format terminal,json,junit,md`: `junit.xml` (jeden testcase na przypadek, DIFF oraz ERROR jako failure, BLOCKED oraz SKIPPED jako skipped) i `plan.md` (tabela, sekcje zwijane per przypadek, limit 60 kB) w katalogu przebiegu;
- `upgrade-check --engine-old --engine-new`: ta sama wersja workflow na dwóch obrazach w dwóch sandboxach; na instancji deweloperskiej 2.40.5 przeciw `v3-nightly` dało PASS w 53 s;
- `redact --workflow` (w planie `redact --fixtures`, zob. ADR 0006): kopie fixture'ów z podmienionymi e-mailami, nazwiskami oraz telefonami, z zachowanymi identyfikatorami, datami oraz liczbami; ta sama wartość dostaje tę samą zamianę, więc złączenia między węzłami działają;
- GitHub Action (`action/action.yml`, composite): `init`, `pull`, `run` z formatami, artefakt z raportem, komentarz w PR aktualizowany w miejscu, porażka zadania przy ERROR i BLOCKED;
- wersja `0.2.0-next.1`.

Odkrycie warte zapamiętania: Docker Desktop na Windows zwraca `EIO` przy listowaniu katalogu z bind mountu, gdy ścieżka hosta ma około 180 znaków lub więcej (156 znaków działa, 182 nie), a Git Bash pokazuje w takich katalogach niepełne listy plików. Katalogi montowane do sandboxa (reguły, przechwycenia, certyfikaty, praca, wyjście) leżą teraz w katalogu tymczasowym systemu (`frt-<losowe>`), a w `.flowretest/<id>/runs/<czas>/` zostają tylko `report.json`, `plan.txt`, `junit.xml` oraz `plan.md`.

Poza sesją: publikacja `0.2.0-next.1` (npm, GHCR), sesje z agencjami, pierwsze płatne wdrożenie, przypomnienie do license@n8n.io.

## Tydzień 5 (2026-09-24), CLI 0.3 w toku

Zrobione:

- katalog regresji do 12 przypadków: 07 zamienione wyjścia IF (zamówienia VIP na zwykłym endpoincie), 08 Limit przed węzłem piszącym, 09 zmiana formatu daty, 10 zmiana metody z PUT na POST, 11 zmiana nazwy pola w ciele, 12 usunięty parametr zapytania; oczekiwania w teście e2e;
- luka w diffie: parametry zapytania nie były porównywane (dwa wywołania z tym samym ciałem i innym `?dry_run` wyglądały jak zmiana bez różnic); teraz wchodzą do porównania jako ścieżki `?nazwa`;
- nagłówek `X-FlowRetest-Node` dodawany przez rewriter do węzłów HTTP Request z rolą zapisu (tylko przy nagłówkach klucz-wartość, nie przy JSON), zapisywany przez proxy i preferowany przy przypisaniu; indeks uruchomienia nadal z okien czasowych; potwierdzone na instancji deweloperskiej po przebudowie obrazu proxy;
- reguła skanera S007 (IF albo Filter z identycznymi warunkami).

Uwagi operacyjne: `sandbox prune` usuwało dotąd wszystkie zasoby `frt-*`, także sandbox innego trwającego przebiegu (tak padł jeden test e2e); teraz pomija działające kontenery, chyba że `--force`. Zmiana w pakiecie proxy wymaga przebudowy obrazu (`docker build -t flowretest-proxy:dev packages/proxy`); stary obraz zachowuje się jak dawniej bez komunikatu. W wydaniu obraz jest przypięty digestem, w rozwoju łatwo o to zapomnieć.

Do końca tygodni 5 do 8 według planu: przypadki 13 do 15 (w tym z węzłem AI), odtwarzanie węzłów AI, tabela ról Postgres i MySQL dla odczytów, redakcja raportu przed wysyłką, PR do n8n-as-code, dokumentacja formatów, makieta warstwy płatnej.

## Tydzień 6 (2026-09-24), CLI 0.3 w toku

Zrobione:

- odtwarzanie węzłów AI: klasyfikator rozpoznaje węzeł główny klastra LangChain (ma połączenie `main`) jako odczyt, a sub-węzły podłączone przez `ai_*` jako logikę; rewriter po podmianie węzła głównego usuwa jego modele, pamięć, narzędzia oraz parsery, także zagnieżdżone; `aiReplayWarnings` porównuje parametry węzła głównego oraz jego sub-węzłów między wersjami i dodaje ostrzeżenie `stale-ai-replay` do przypadku (renderowane w planie jako linia `?` i w Markdown jako "Warning"); nowy węzeł AI bez nagrania dostaje ostrzeżenie o wykonaniu przeciw zlewowi;
- tabela ról Postgres i MySQL: `select` odtwarzany z nagrania, `executeQuery` oraz zapisy nieobsługiwane z notatką "database write does not go over HTTP"; przypadek z takim węzłem na ścieżce kończy jako SKIPPED zamiast czekać 13 s na błąd DNS;
- redakcja raportu przed wysyłką: `redact --report [przebieg]` zapisuje `report.redacted.json`, w którym wartości pól i parametrów zapytania są zastąpione kształtem `<string 13 #a1b2c3d4>`, a ścieżki, liczby, flagi oraz szablony ścieżek zostają; to format dla warstwy płatnej z planu (punkt 6.13);
- katalog do 15 przypadków: 13 łańcuch LLM odtworzony po zmianie promptu (PASS z ostrzeżeniem), 14 Postgres `select` odtworzony i nowy `insert` (SKIPPED), 15 HubSpot z pustą właściwością po zmianie nazwy pola.

Decyzja odnotowana: przy węźle AI bez nagrania nie blokujemy przypadku, tylko wykonujemy go przeciw szablonowi zlewu (OpenAI odpowiada stałą treścią) i ostrzegamy; plan przewidywał BLOCKED, ale wtedy każdy dodany węzeł AI zatrzymywałby cały przypadek, a tak widać pozostałe wywołania.

Poza sesją według planu tygodni 5 do 8: publikacja wyników `upgrade-check`, PR do n8n-as-code, dokumentacja formatów, makieta warstwy płatnej, opinia prawna.

## Tydzień 7 (2026-09-24), dokumentacja formatów, integracje, FAQ

Zrobione:

- `packages/schemas` przestał być zaślepką: schematy zod (4.6) dla konfiguracji, fixture'a, reguł proxy, przechwycenia, raportu oraz baseline'u, funkcja `parseOrThrow` z czytelnymi komunikatami, eksport do JSON Schema (draft 2020-12) przez `npm run schemas` do `docs/formaty/*.schema.json`; `loadConfig` w CLI waliduje `config.yml` tym schematem;
- `docs/formaty/README.md`: kto pisze i czyta każdy plik, znaczenie pól, lista flag diffu;
- `docs/integracje.md`: co runner udostępnia integracjom (wejścia plikowe, wyjścia maszynowe, brak stanu poza `.flowretest/`), szkic subkomendy `test` dla n8n-as-code i narzędzia `flowretest_replay` dla n8n-mcp, kolejność wysyłania PR-ów po publikacji na npm;
- README pakietu: sekcje "Privacy" (nic nie opuszcza maszyny, zero telemetrii, redakcja) i "Licensing" (MIT, zero kodu n8n, obraz klienta na jego maszynie).

Poza sesją: publikacja wyników `upgrade-check` dla 3.0 na forum, makieta warstwy płatnej dla trzech agencji, opinia prawna (tydzień 6 w planie), licznik 30 dni od pierwszego raportu u każdej agencji. Bramka 5 (piątek tygodnia 8) wymaga tych trzech rzeczy plus pokrycia co najmniej 80% na eksportach agencji, więc bez sesji z agencjami nie da się jej zamknąć od strony technicznej.

## Tydzień 8 (2026-09-24), przygotowanie 0.3.0 i bramki 5

Zrobione:

- wersja `0.3.0-next.1` we wszystkich pakietach, CHANGELOG z sekcją wydania;
- `packages/cli/proxy.lock.json`: obraz proxy i digest z wydania; `init` używa obrazu z digestem, gdy lock go ma, a w rozwoju `flowretest-proxy:dev`; digest wpisuje dopiero `release.yml` od poprawek po audycie (wcześniej tylko go wypisywał);
- `docs/bramka-5.md`: trzy warunki bramki ze stanem (wszystkie czekają na sesje z agencjami i mail licencyjny), lista gotowych elementów, braki do publikacji, liczby do zebrania w sesjach, rekomendacja publikacji `0.3.0` jako OSS niezależnie od decyzji o SaaS.

Lista wydania dla założyciela: `npm login`, `docker login ghcr.io`, tag `v0.3.0` na `main` (uruchamia `release.yml`: verify, build, obraz proxy do GHCR, `npm publish --provenance` na kanał `latest`; tagi z `-next` idą na kanał `next`). Po wydaniu: wpisać digest obrazu do `proxy.lock.json`, uzupełnić README o `npx flowretest@latest`, wysłać PR do n8n-as-code według `docs/integracje.md`.

## Po audycie (2026-09-24), poprawki P0

Audyt tygodni 1 do 8 jest w `docs/audyt-2026-09-24.md`. Poprawione punkty P0:

- kody wyjścia: wyjątek z komendy albo błąd użycia kończy się kodem 4, błąd programu kodem 5; kod 1 znaczy już tylko DIFF;
- Action nazywa kod 4 ENVIRONMENT i oblewa zadanie przy każdym wyniku poza PASS oraz DIFF;
- SKIPPED (węzeł nieobsługiwany na ścieżce) daje wynik BLOCKED i kod 3;
- pakiet `flowretest` jest publikowalny: esbuild wkleja trzy pakiety robocze `@flowretest/*` do `dist/bin.js` (te pakiety zostają prywatne i nie idą na npm), `bin` to `dist/bin.js`, `proxy.lock.json` jest w paczce; sprawdzone instalacją tarballa w pustym katalogu (`npx flowretest --version`, import biblioteki);
- `release.yml` przez `scripts/release-check.mjs`: tag musi być równy wersji wszystkich pakietów i `CLI_VERSION`, dist-tag wynika z wersji (`-next` idzie na `next`), digest obrazu proxy trafia do `proxy.lock.json` przed `npm publish`, publikacja staje, gdy pakiet jest prywatny albo digestu brak; lock z digestem zostaje jako artefakt `proxy-lock`.

Lista wydania dla założyciela, poprawiona:

1. Zająć scope `@flowretest` na npm (organizacja), żeby nikt nie wystawił paczek pod nazwami pakietów roboczych.
2. Sekret `NPM_TOKEN` w repozytorium; `GITHUB_TOKEN` wystarcza do GHCR.
3. Tag równy wersji z `package.json`: dziś `v0.3.0-next.1` (kanał `next`). Dla `v0.3.0` najpierw podnieść wersję we wszystkich pakietach i w `packages/cli/src/index.ts`.
4. Po pierwszym pushu ustawić pakiet `flowretest-proxy` w GHCR jako publiczny (nowe pakiety są prywatne).
5. Pobrać artefakt `proxy-lock` z przebiegu i zacommitować `packages/cli/proxy.lock.json` na `main`.

Przed publikacją warto jeszcze naprawić punkty 6 do 16 z audytu (diff przepuszcza zmianę ID w ścieżce, duże ciała, zapisy HTTP Request v1, polskie nazwy węzłów w nagłówku), bo bez nich pilotaż pokaże PASS tam, gdzie jest regresja.

## Po audycie (2026-09-24), punkty 6 do 23

Punkty 6 do 16 (diff) są w commicie `acbe51f`, punkty 17 do 23 (odporność, Action, prywatność) w następnym. Szczegóły są w `CHANGELOG.md`, stan każdego punktu w `docs/audyt-2026-09-24.md`.

Wnioski warte zapamiętania:

- porównanie konkretnej ścieżki URL wyciągnęło problem z `{{seq}}`: numer liczony z ciała żądania zmieniał `vid` HubSpota po zmianie ciała, a razem z nim ścieżkę następnego GET, więc przypadek 15 pokazywał 4 zmiany zamiast 2; numer jest teraz liczony per endpoint i wersję;
- domyślne operacje węzłów wzięte z opisów w obrazie `n8nio/n8n:2.40.5` (`dist/types/nodes.json`); tabela ról miała przy okazji nieistniejącą operację `user.get` w Slacku v2;
- e2e katalogu po zmianach: 15 z 15 zgodnie z oczekiwaniami na 2.40.5;
- punkt 18 (uprawnienia na Linuksie) jest poprawiony w kodzie, ale nie był uruchomiony na runnerze GitHuba; pierwszy przebieg `e2e.yml` to sprawdzi.

## Pierwszy przebieg CI na GitHubie (2026-09-24)

Po wypchnięciu `main`: `ci` zielone na Ubuntu, Windows i macOS; `e2e` przez `flowretest run` zielone na 2.40.5 i `next`. Na Linuksie `doctor` przeszedł, więc poprawka uprawnień z audytu (punkt 18) działa na runnerze GitHuba (uid 1001).

`v3-nightly` z tego dnia (raportuje 2.41.0) padł na `import:credentials` z komunikatem "No active encryption key found". n8n włącza domyślnie rotację kluczy szyfrowania (`N8N_ENV_FEAT_ENCRYPTION_KEY_ROTATION`, wyłączana tylko wartością `false`): poświadczenia szyfruje klucz danych zapisany w bazie, a tworzą go wyłącznie procesy serwera (`n8n start` oraz tryby webhook i worker, pole `seedsInstanceIdentity`). Sandbox ma świeżą bazę i używa tylko komend CLI, więc klucza nie było. Sandbox ustawia teraz tę flagę na `false`; n8n szyfruje wtedy kluczem instancji jak w 2.40. Gdy n8n usunie flagę, trzeba będzie jednorazowo zasiać klucz (np. krótkim `n8n start` na wolumenie sandboxa); macierz e2e z `v3-nightly` pokaże to od razu.

## Stuby i szczelność w każdym przebiegu (2026-09-24)

Dwa brakujące elementy planu z ADR 0006:

- `run` sprawdza szczelność każdego sandboxa przed wykonaniem czegokolwiek: sieć ma `Internal=true`, proxy jest podpięte tylko do niej, a `wget` z obrazu n8n bez proxy nie dochodzi do `example.com`. Przy nieudanym sprawdzeniu przebieg kończy się kodem 4 bez uruchomienia workflow. Wynik jest w `report.json` (`sandbox`), a stopka planu pisze o szczelności tylko wtedy, gdy sprawdzenie przeszło. Stare raporty bez tego pola są renderowane jako niesprawdzone.
- Stuby na poziomie węzła: `--stub "<węzeł>=<plik>"` i `.flowretest/<workflow>/stubs.yml`. Rewriter zastępuje węzeł węzłem Code z podanymi elementami, więc stub działa także dla węzłów spoza HTTP (Postgres, SMTP), dla odczytów bez nagrania i dla nagrań ponad 1 MB. Przypadek dostaje ostrzeżenie `stub:`, a `coverage.stubbed` wymienia takie węzły.

E2E przez `run`: 15 z 15 przypadków z potwierdzoną szczelnością, a przypadek 14 ze stubem dla nowego zapisu `Audit` daje PASS zamiast SKIPPED. Sprawdzenie szczelności wydłuża każdy przebieg o kilka sekund (test `wget` czeka na odmowę); pełne e2e trwa lokalnie około 12 minut.

## Reszta planu z ADR 0006 (2026-09-24)

Uzupełnione: `expectations.yml` (ręczne kontrole wywołań nowej wersji, ADR 0005), sekcja "Engine differences" w `upgrade-check` (węzły tylko na jednym silniku, liczby uruchomień i elementów, klucze wyjścia, nowe błędy), pole `static` w raporcie z linią w planie, `diff --format`, `sandbox export --compose`, flagi globalne `--json`, `--verbose`, `--no-color`, `--cwd` z kolorami w terminalu, eslint w `verify` i CI, próg pokrycia 80% w `core` (wbudowany pomiar Node zamiast c8) oraz `npm audit --audit-level=high` w CI.

Sprawdzone na żywo: `upgrade-check` przypadku 01 z 2.40.5 na `v3-nightly` z `--keep` dał PASS z sekcją "Engine differences" i sprawdzonymi oczekiwaniami; `sandbox export --compose` z zachowanego sandboxa przeszedł `docker compose config`, po `up` edytor odpowiedział na 127.0.0.1:5678 (`/healthz` 200), a n8n w tym zestawie nadal nie miał połączenia z internetem.

eslint przy pierwszym uruchomieniu znalazł w teście proxy wyrażenie `'^.*\.googleapis\.com$'` w zwykłym stringu: backslashe znikały, więc kropka pasowała do dowolnego znaku. Poprawione.

## Tydzień 9: szkielet warstwy płatnej (2026-09-24)

Zakres z planu (sekcja 11, tydzień 9): logowanie, organizacje, workspace'y, tokeny, `POST /api/runs`, przeglądarka raportu. Bramka 5 nie jest zamknięta, więc aplikacja nie jest wdrożona; decyzje są w ADR 0007.

Zrobione:

- `apps/web` (Next.js 16.3, React 19.3, Tailwind 4, `@supabase/ssr`): logowanie kodem z maila, organizacje z zaproszeniami po adresie, workspace'y, tokeny `frt_...` pokazywane raz, lista workflow, historia przebiegów workflow, widok przebiegu z kafelkami, przypadkami, zmianami pól, flagami, sekcją "Engine differences", znaleziskami skanera i planem tekstowym jak w terminalu;
- migracja `20261123000000_organizations_workspaces_runs.sql`: siedem tabel z RLS, `create_organization`, `claim_invitations`, `ingest_run`;
- `POST /api/runs`: 201 z adresem przebiegu, 401 dla złego albo cofniętego tokenu, 400 dla innego formatu, 413 powyżej 5 MB, 422 gdy raport ma wartości zamiast kształtów;
- CLI: `flowretest upload`, `run --upload`, `upgrade-check --upload`, `cloud.url` w `config.yml`, `FLOWRETEST_TOKEN` ze zmiennej albo z `.flowretest/secrets.env` (`init` go nie nadpisuje);
- `@flowretest/schemas`: `RedactedReportSchema` i `docs/formaty/redacted-report.schema.json`; `core`: `redactionProblems` i solone skróty ciał w raporcie po redakcji;
- CI: job `web` (Supabase w kontenerach, zgodność typów bazy, build, testy integracyjne), reguły `react-hooks` w eslint.

Sprawdzone na żywo na Windows 11: logowanie kodem i linkiem (link także z innego klienta bez ciasteczek), organizacja, workspace, token, potem `run --upload` przypadków katalogu 01 i 15 na 2.40.5. Oba przebiegi trafiły do widoku jako DIFF, CLI zakończyło się kodem 1. Widok nie przewija się poziomo przy 375 px; sprawdzony w trybie jasnym i ciemnym. Testy: 5 jednostkowych w `apps/web`, 8 integracyjnych (RLS: obca organizacja nie widzi niczego, nie zapisze workspace'u ani tokenu, nikt nie odczyta `token_hash`, tylko `service_role` wywoła `ingest_run`; API: kody odpowiedzi, cofnięty token, przekierowanie niezalogowanych).

Błędy znalezione w trakcie:

- `ingest_run` padał na "column reference workspace_id is ambiguous": kolumny wyjściowe `returns table` przesłaniały kolumny tabel; poprawione dyrektywą `#variable_conflict use_column`;
- jedno wciśnięcie Entera w formularzu tokenu dało pięć tokenów: formularz poszedł natywnym POST-em przed hydratacją, a każde przeładowanie karty wysyłało go ponownie; przyciski są nieaktywne do hydratacji;
- `run --upload` na Windows kończył się kodem 127 z asercją libuv (`process.exit` tuż po `fetch`); teraz kod planu przechodzi przez `process.exitCode`.

Do decyzji założyciela: domena warstwy płatnej (od niej zależy domyślny `cloud.url`), projekt Supabase w chmurze i region (dane agencji z UE), dostawca maili do logowania na produkcji (lokalnie Mailpit).
