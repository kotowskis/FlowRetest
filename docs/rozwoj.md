# Rozwój

Wymagania: Node 24, npm 11, Docker Desktop albo Docker Engine (do sandboxa).

```bash
npm install
npm run verify        # strażnik zależności, type-check, testy jednostkowe
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
