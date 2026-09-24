# Bramka 5, materiał do decyzji o warstwie płatnej

Termin z planu: piątek tygodnia 8 (2026-11-20 przy starcie 09-28). Ten dokument zbiera stan techniczny na dzień przygotowania (2026-09-24) i wskazuje, których liczb jeszcze nie ma. Decyzja należy do założyciela; trzy warunki z planu muszą być spełnione łącznie, inaczej zostaje wersja OSS plus usługi.

## Warunki z planu

| Warunek | Stan | Źródło |
|---|---|---|
| dwie z trzech agencji zapłaciły za wdrożenie albo plan Team w 30 dni od pierwszego raportu | brak danych: sesje z agencjami nie odbyły się | `docs/dziennik.md`, tygodnie 3 do 7 |
| pisemna odpowiedź licencyjna bez wymogu umowy | brak danych: mail do license@n8n.io nie został wysłany (punkt tygodnia 0 odłożony) | notatka decyzyjna, sekcja 10 |
| pokrycie co najmniej 80% węzłów piszących na eksportach agencji | brak eksportów agencji; na katalogu 15 przypadków i instancji deweloperskiej pokrycie 100% dla węzłów HTTP | e2e katalogu, `docs/spike/wyniki.md` dzień 9 |

Wniosek: bramka 5 nie może być zamknięta bez rozmów z agencjami. Technicznie produkt jest gotowy do pilotażu; rynkowo nie zaczął.

## Co jest gotowe technicznie

- CLI `0.3.0-next.1`: `init`, `pull`, `scan`, `run`, `diff`, `accept`, `upgrade-check`, `redact`, `doctor`, `sandbox prune`; formaty terminal, JSON, JUnit, Markdown; GitHub Action.
- Sandbox: obraz klienta w sieci `--internal`, proxy z własnym CA, zero kodu n8n w runnerze, test szczelności w `doctor`.
- Pokrycie węzłów: HTTP Request, Slack, HubSpot, Google Sheets, Airtable, Notion, OpenAI (przez łańcuchy LangChain), Code przez helpery; odczyty Postgres i MySQL odtwarzane; zapisy do baz, SMTP, SFTP oraz Gemini nieobsługiwane z jasnym komunikatem.
- Katalog regresji: 15 przypadków, wszystkie zielone na 2.40.5; sześć pierwszych także na `v3-nightly`.
- Czasy: przebieg 3 przypadków ze stabilizacją na instancji deweloperskiej 49 s, `upgrade-check` na dwóch obrazach 53 s, przypadek w partii 1 do 2 s.
- Dokumentacja: notatka decyzyjna, plan, dziennik spike'u, dziennik tygodni 3 do 7, formaty ze schematami, integracje, README pakietu po angielsku.

## Czego brakuje do wersji 0.3.0 na npm

- publikacja pakietu i obrazu proxy (logowanie założyciela do npm i GHCR, tag `v0.3.0`); `release.yml` jest gotowy;
- przypięcie digestu obrazu proxy w `proxy.lock.json` po pierwszym pushu do GHCR (dziś CLI używa `flowretest-proxy:dev` z konfiguracji);
- test na eksporcie choć jednej agencji.

## Liczby, które trzeba zebrać w sesjach

- czas od `init` do pierwszego planu ze stoperem (cel poniżej 60 minut; na instancji deweloperskiej 3 minuty);
- pokrycie węzłów piszących per workflow (`Coverage` w stopce planu);
- liczba przypadków SKIPPED i ich powody (tabela wsparcia ze `scan`);
- ile znanych regresji agencji udało się odtworzyć (cel 4 z 5);
- czy agencja użyła narzędzia przy realnej zmianie bez naszej pomocy.

## Rekomendacja techniczna

Niezależnie od decyzji o SaaS: opublikować `0.3.0` jako OSS, bo koszt to dwa logowania i jeden tag, a bez publicznej paczki nie da się zebrać liczb z pierwszej listy ani wysłać PR-ów do n8n-as-code i n8n-mcp.
