# ADR 0003. Odtwarzanie węzłów czytających węzłem Code z zachowanym pairedItem

Data: 2026-09-24. Status: przyjęte 2026-09-24 po dniu 3 spike'u (wariant Code; scenariusz z odtworzonym odczytem pokazał utratę powiązań w wariancie rezerwowym).

## Kontekst

Trigger i węzły czytające są zastępowane nagranym wyjściem. Komenda `execute` ignoruje pinData w trybie `cli`, więc dane trzeba wstrzyknąć do JSON-a workflow. Węzły niżej używają `$('Węzeł').item`, które zależy od `pairedItem`.

## Decyzja

Wariant podstawowy: węzeł Code (JavaScript, "Run Once for All Items") o nazwie oryginału, zwracający `RUNS[$runIndex]` z elementami i `pairedItem` z nagrania. Wariant rezerwowy, gdy `execute` nie startuje task runnera: Edit Fields w trybie JSON z `executeOnce` i Split Out o nazwie oryginału, z ostrzeżeniem o utracie powiązań elementów.

## Skutki

- Poprawne powiązania elementów także przy wielu uruchomieniach w pętli.
- Zależność od task runnera w komendach `execute` i `executeBatch`; potwierdzona w dniu 3 spike'u (2.40.5) i w dniu 10 (`v3-nightly`).
- Limit 1 MB wstrzykniętych danych na węzeł.
- Nazwa węzła trafia do kodu tylko jako literał JSON bez znaków końca linii; prefiks `frt:` w nazwach jest zarezerwowany dla węzłów runnera.
- Wariant rezerwowy wstawia dane do wyrażenia, więc klamry w tekstach są zapisywane jako `\u007b` i `\u007d`, a sąsiednie klamry struktury rozdzielone spacją; żadne `{{` ani `}}` nie kończy wyrażenia przedwcześnie.
- Gdy nowa wersja podaje odtwarzanemu węzłowi inną liczbę elementów niż w nagraniu, przypadek dostaje ostrzeżenie `replay-input-mismatch`.
