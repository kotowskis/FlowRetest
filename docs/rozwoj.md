# Rozwój

Wymagania: Node 24, npm 11, Docker Desktop albo Docker Engine (do sandboxa).

```bash
npm install
npm run verify        # strażnik zależności, eslint, type-check, testy jednostkowe
npm run build         # CLI jako jeden plik dist/bin.js (esbuild), pozostałe pakiety przez tsc
docker build -t flowretest-proxy:dev packages/proxy
node packages/cli/dist/bin.js doctor --engine 2.40.5
npm run e2e -w packages/cli   # katalog regresji przez `flowretest run`, kilkanaście minut
```

`doctor` pobiera obraz `n8nio/n8n:2.40.5` (kilkaset MB przy pierwszym uruchomieniu), stawia sieć `--internal` z proxy, importuje workflow sondujący, wykonuje go przez proxy i sprawdza, że kontener bez proxy nie ma dostępu do internetu. `--keep` zostawia sandbox do oglądania, `sandbox prune` sprząta (pomija sandboxy z działającym proxy).

Test e2e buduje dla każdego z 15 przypadków katalogu osobny projekt `.flowretest` w katalogu tymczasowym (konfiguracja, opublikowana wersja, fixture) i uruchamia `run` tak jak użytkownik. Przypadek 01 przechodzi dodatkowo `accept` i `diff --against baseline`. Zmienne: `FLOWRETEST_ENGINE` (tag obrazu n8n, domyślnie 2.40.5), `FLOWRETEST_PROXY_IMAGE` (domyślnie `flowretest-proxy:dev`), `FLOWRETEST_E2E_CONCURRENCY` (ile przypadków naraz, domyślnie 3). Komenda `spike day7` robi to samo ścieżką ze spike'u i zostaje do szybkich prób (`--only 01,15`); jest ukryta w `--help`.

Pułapki:

- zmiana w `packages/proxy` działa dopiero po przebudowie obrazu `flowretest-proxy:dev`; stary obraz nie zgłasza błędu;
- `dist/bin.js` zawiera wklejony `core`, więc po zmianie w `core` trzeba uruchomić `npm run build`, zanim użyje się `node packages/cli/dist/bin.js`;
- obraz proxy instaluje zależności z własnego `packages/proxy/package-lock.json`; po zmianie zależności proxy trzeba go wygenerować na kopii `package.json` (`npm install --package-lock-only`) i skopiować z powrotem, inaczej `release-check` zatrzyma wydanie.

Instancja deweloperska do ręcznych prób: `docker run -d --name flowretest-dev-n8n -p 5678:5678 n8nio/n8n:2.40.5` plus odbiornik `node scripts/dev-receiver.mjs 8787` dla węzłów piszących (adres `http://host.docker.internal:8787/...` w workflow).

Układ repozytorium: `packages/core` (czyste funkcje: klasyfikacja, rewriter, normalizacja, diff, skaner, plan, redakcja), `packages/cli` (komendy, sandbox, klient API, katalog regresji), `packages/proxy` (obraz proxy), `packages/services` (role, szablony zlewu, zaślepki poświadczeń), `packages/schemas` (schematy zod i eksport do JSON Schema), `action/` (GitHub Action), `scripts/` (strażnik zależności, eksport schematów, kontrola wydania), `docs/`.

## Warstwa płatna (`apps/web`)

Next.js 16 z App Router i Supabase. Lokalnie Supabase działa w Dockerze na portach 553xx (API 55321, baza 55322, Mailpit 55324), żeby nie kolidować z innymi projektami na domyślnych 543xx.

```bash
npm run db:start -w @flowretest/web   # pierwszy raz kilka minut: pobiera obrazy Supabase
npm run db:env -w @flowretest/web     # zapisuje apps/web/.env.local z kluczami lokalnego stosu
npm run dev -w @flowretest/web        # http://127.0.0.1:3100
npm run test:integration -w @flowretest/web   # baza, API, Stripe, GitHub, Slack, PDF; wymaga db:start, działającej aplikacji i atrap
```

Logowanie jest bez hasła: mail z sześciocyfrowym kodem i linkiem. Lokalnie maile trafiają do Mailpita pod `http://127.0.0.1:55324`. Po każdej nowej migracji w `apps/web/supabase/migrations/` trzeba uruchomić `npm run db:reset -w @flowretest/web` i `npm run db:types -w @flowretest/web`, a potem zacommitować `lib/database.types.ts`; job `web` w CI sprawdza zgodność (`db-types.mjs --check`).

GitHub App i Slack lokalnie działają na atrapie: `node scripts/fake-services.mjs init` (w `apps/web`; klucz w `.fake-services/`, ustawienia dopisane do `.env.local`, po każdym `db:env` trzeba to powtórzyć), potem `node scripts/fake-services.mjs serve` i dopiero wtedy `npm run dev`. Atrapa zapisuje każde żądanie, `GET http://127.0.0.1:55390/__calls` je pokazuje.

Stripe też jest w atrapie (ten sam `init` dopisuje `STRIPE_*`). Przycisk wyboru planu prowadzi na `http://127.0.0.1:55390/stripe/pay/<sesja>`, która od razu "płaci": zakłada subskrypcję i fakturę, wysyła podpisane webhooki do aplikacji i wraca na stronę Billing. `GET /__stripe` pokazuje stan atrapy, a `POST /__stripe/subscriptions/<id>` z `{"status":"past_due"}` albo `{"status":"canceled"}` udaje nieudaną kartę lub anulowanie. Nowa organizacja jest na planie Free (1 workspace); testy, które potrzebują więcej, wołają `setPlan` z `test/integration/helpers.ts`. Retencję uruchamia ręcznie `select public.purge_expired_runs();` w bazie (w `pg_cron` codziennie o 03:17 UTC).

Powiadomienia e-mail wychodzą lokalnie do Mailpita (`MAILPIT_URL` w `.env.local`, zapisuje go `db:env`). Akceptacja z aplikacji trafia na dysk przez `flowretest sync` albo `pull` w katalogu projektu z zaakceptowanym przebiegiem.

Upload z CLI do lokalnej aplikacji: token z ekranu workspace'u, potem `FLOWRETEST_TOKEN=frt_... node packages/cli/dist/bin.js upload --workflow <id> --url http://127.0.0.1:3100` w katalogu projektu po `run`.

Pułapki:

- Next 16 w trybie dev podaje HMR tylko originowi `localhost`; aplikacja działa na `127.0.0.1`, więc `next.config.ts` ma `allowedDevOrigins: ['127.0.0.1']`. Bez tego strona w ogóle się nie hydratowała. Formularze szły wtedy natywnym POST-em. Klient HMR co minutę przeładowywał stronę i wysyłał je ponownie (siedem tokenów z jednego Entera). Przyciski formularzy są dodatkowo nieaktywne do hydratacji (`useHydrated` w `components/forms.tsx`);
- w funkcji plpgsql z `returns table (...)` kolumny wyjściowe przesłaniają kolumny tabel o tej samej nazwie; `ingest_run` ma `#variable_conflict use_column`;
- PDF przebiegu (react-pdf 4.9): tekst z `render` (numer strony) znika, gdy `lineHeight` jest ustawione na stronie, i potrzebuje szerokości; fontkit pada na TTF JetBrains Mono i IBM Plex Mono z `@expo-google-fonts` ("Offset is outside the bounds of the DataView"), dlatego mono to Roboto Mono. Panel przeglądarki nie wyświetla PDF; wynik testu jednostkowego zapisuje `RUN_RECORD_OUT=<plik.pdf> node --test test/unit/run-record.test.ts`, a tekst stron najprościej wyciągnąć przez pdfjs;
- `process.exit()` tuż po `fetch` na Windows kończy Node asercją libuv (kod 127 zamiast kodu planu); `run --upload` ustawia `process.exitCode` i pozwala pętli zdarzeń się opróżnić;
- baza odrzuca każdą sesję otwartą hasłem (wyzwalacz na `auth.mfa_amr_claims`, ADR 0012), także w testach; `user()` z `test/integration/helpers.ts` loguje linkiem z `admin.generateLink`. Webhooków Slacka nie da się dodać kluczem użytkownika, testy wstawiają je kluczem serwisowym;
- migrację na działającej lokalnej bazie bez kasowania danych wgrywa `npx supabase migration up --local` (w `apps/web`); `db:reset` czyści wszystko. Plik już wgrany jest pomijany, więc część dopisaną do niego trzeba wgrać ręcznie przez `psql`;
- CSP stron ma nonce z `proxy.ts` (`lib/csp.ts`), więc każda strona renderuje się przy żądaniu (`dynamic = 'force-dynamic'` w `app/layout.tsx`). Strona zbudowana statycznie nie dostałaby nonce i jej skrypty by nie ruszyły; nowy `<script>` w kodzie też musi dostać nonce (`headers().get('x-nonce')`);
- testy integracyjne bez Supabase, aplikacji albo atrap pomijają się lokalnie, a przy ustawionym `CI` kończą błędem (`mustRun` w `test/integration/helpers.ts`). Uruchomienie z własną kopią aplikacji obok serwera deweloperskiego: `next build`, potem `next start --port 3101` i atrapa na 55391 z nadpisanymi zmiennymi adresów: `APP_URL`, `GITHUB_APP_API_URL`, `GITHUB_APP_WEB_URL`, `SLACK_WEBHOOK_HOSTS`, `STRIPE_API_URL`. Te same zmienne dostaje `npm run test:integration`.
