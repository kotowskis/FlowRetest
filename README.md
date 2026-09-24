# FlowRetest

Narzędzie do testowania zmian w workflow n8n przed wdrożeniem. Odtwarza prawdziwe wykonania na starej i nowej wersji workflow w lokalnym sandboksie z przechwyconym ruchem HTTP i pokazuje różnicę w wywołaniach, które workflow próbowałby wysłać do zewnętrznych systemów.

Stan: wersja `0.1.0-next.1` po dziesięciodniowym spike'u wykonalności; pilotaże w tygodniu 3. Interfejs produktu jest po angielsku ([packages/cli/README.md](packages/cli/README.md)), dokumenty wewnętrzne po polsku.

- Notatka decyzyjna z 2026-09-23: [docs/analiza-pomyslu-2026-09-23.md](docs/analiza-pomyslu-2026-09-23.md)
- Plan implementacji z 2026-09-23: [docs/plan-implementacji-2026-09-23.md](docs/plan-implementacji-2026-09-23.md)
- Dziennik spike'u (dni 1 do 10): [docs/spike/wyniki.md](docs/spike/wyniki.md)
- Dziennik po spike'u: [docs/dziennik.md](docs/dziennik.md)
- Decyzje architektoniczne: [docs/adr](docs/adr)

## Rozwój

Wymagania: Node 24, npm 11, Docker Desktop (do sandboxa).

```bash
npm install
npm run verify        # strażnik zależności, type-check, testy jednostkowe
npm run build
docker build -t flowretest-proxy:dev packages/proxy
node packages/cli/dist/bin.js doctor --engine 2.40.5
npm run e2e -w packages/cli   # katalog regresji przez prawdziwy sandbox, kilka minut
```

`doctor` pobiera obraz `n8nio/n8n:2.40.5` (kilkaset MB przy pierwszym uruchomieniu), stawia sieć `--internal` z proxy, importuje workflow sondujący, wykonuje go przez proxy i sprawdza, że kontener bez proxy nie ma dostępu do internetu. `--keep` zostawia sandbox do oglądania, `sandbox prune` sprząta.

Instancja deweloperska do ręcznych prób: `docker run -d --name flowretest-dev-n8n -p 5678:5678 n8nio/n8n:2.40.5` plus odbiornik `node scripts/dev-receiver.mjs 8787` dla węzłów piszących (adres `http://host.docker.internal:8787/...` w workflow).

Układ repozytorium: `packages/core` (czyste funkcje: klasyfikacja, rewriter, normalizacja, diff, skaner, plan), `packages/cli` (komendy, sandbox, klient API), `packages/proxy` (obraz proxy), `packages/services` (role, szablony zlewu, zaślepki poświadczeń), `packages/schemas` (schematy), `docs/`.
