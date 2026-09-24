# ADR 0002. Każda komenda n8n jako osobne `docker run --rm`

Data: 2026-09-24. Status: przyjęte; uzupełnione po dniu 4: `executeBatch --concurrency=1 --snapshot` jako ścieżka podstawowa (1,5 s na przypadek zamiast 8 s), `execute` per przypadek jako rezerwa.

## Kontekst

Sandbox wykonuje kilka komend n8n na przebieg: `import:credentials`, `import:workflow`, `list:workflow`, `execute`. Alternatywą jest jeden uśpiony kontener i `docker exec`.

## Decyzja

Każda komenda to `docker run --rm` z tym samym wolumenem `/home/node/.n8n`. Skrypt startowy obrazu wykrywa `/opt/custom-certificates`, ustawia `NODE_OPTIONS=--use-openssl-ca` i `SSL_CERT_DIR`, uruchamia `c_rehash` i wykonuje `exec n8n "$@"`. Runner nie odtwarza tej logiki.

## Skutki

- Koszt startu procesu n8n na komendę; cel poniżej 10 s, mierzony w spike'u.
- Odporność na zmiany entrypointa w n8n 3.0.
- `executeBatch --concurrency=1 --snapshot` jest ścieżką podstawową od dnia 4 (skróciło przebieg z 49,5 s do 8,8 s dla 6 przypadków), `execute` per przypadek zostaje rezerwą (`run.executor: execute`).
- Każda komenda działa w kontenerze o nazwie `frt-<sandbox>-cmd-<n>`; po przekroczeniu czasu runner usuwa go po nazwie, bo zabicie klienta Dockera na Windows nie zatrzymuje kontenera.
