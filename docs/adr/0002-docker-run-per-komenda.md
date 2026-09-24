# ADR 0002. Każda komenda n8n jako osobne `docker run --rm`

Data: 2026-09-24. Status: przyjęte; uzupełnione po dniu 4: `executeBatch --concurrency=1 --snapshot` jako ścieżka podstawowa (1,5 s na przypadek zamiast 8 s), `execute` per przypadek jako rezerwa.

## Kontekst

Sandbox wykonuje kilka komend n8n na przebieg: `import:credentials`, `import:workflow`, `list:workflow`, `execute`. Alternatywą jest jeden uśpiony kontener i `docker exec`.

## Decyzja

Każda komenda to `docker run --rm` z tym samym wolumenem `/home/node/.n8n`. Skrypt startowy obrazu wykrywa `/opt/custom-certificates`, ustawia `NODE_OPTIONS=--use-openssl-ca` i `SSL_CERT_DIR`, uruchamia `c_rehash` i wykonuje `exec n8n "$@"`. Runner nie odtwarza tej logiki.

## Skutki

- Koszt startu procesu n8n na komendę; cel poniżej 10 s, mierzony w spike'u.
- Odporność na zmiany entrypointa w n8n 3.0.
- `executeBatch --concurrency=1` jako opcjonalna optymalizacja, jeśli skraca przebieg o ponad połowę.
