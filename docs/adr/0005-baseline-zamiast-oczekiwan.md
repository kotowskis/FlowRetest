# ADR 0005. Stara wersja jako punkt odniesienia, `accept` zapisuje baseline

Data: 2026-09-24. Status: przyjęte.

## Kontekst

Pierwotny pomysł zakładał ręcznie pisane oczekiwania co do pól i liczby operacji. Agencje nie piszą takich plików.

## Decyzja

Runner wykonuje starą i nową wersję na tych samych fixture'ach i porównuje znormalizowane rejestry wywołań, jak `terraform plan`. `accept` zapisuje rejestr nowej wersji jako baseline po dwóch identycznych przebiegach. Oczekiwania ręczne zostają jako opcjonalny YAML na przypadki brzegowe.

## Skutki

- Konfiguracja bez pisania oczekiwań; pola zmienne wykrywane podwójnym przebiegiem.
- Błąd obecny w obu wersjach nie jest widoczny jako diff; heurystyki łapią część.
- Format raportu i baseline'u to kontrakt między runnerem a warstwą płatną.
