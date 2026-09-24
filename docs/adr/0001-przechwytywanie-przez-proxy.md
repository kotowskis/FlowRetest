# ADR 0001. Przechwytywanie przez HTTPS_PROXY z własnym CA

Data: 2026-09-24. Status: przyjęte.

## Kontekst

Runner ma pokazać, co zmieniony workflow n8n wysłałby do zewnętrznych usług, bez wysyłania czegokolwiek. Rozważane mechanizmy: proxy z własnym CA na obrazie klienta; `n8n-core` jako biblioteka w procesie runnera; fork albo patch n8n; hook preload w procesie n8n; sam diff statyczny.

## Decyzja

Runner uruchamia oficjalny obraz `n8nio/n8n:<tag klienta>` w sieci Docker `--internal` i ustawia `HTTP_PROXY` oraz `HTTPS_PROXY` na kontener proxy z własnym CA, zamontowanym pod `/opt/custom-certificates`. n8n 2.x instaluje globalne agenty proxy w każdym procesie, a skrypt startowy obrazu sam ładuje CA.

## Skutki

- Zero kodu n8n w runnerze; licencja Sustainable Use nie obejmuje runnera.
- Pokrycie tylko dla ruchu HTTP. Węzeł z zapisem przez sterownik (Postgres, MySQL, SMTP, SFTP) na ścieżce oznacza przypadek SKIPPED, a cały przebieg kończy się wynikiem BLOCKED i kodem 3. Wywołanie HTTP, którego żadna reguła nie obsługuje, jest zamykane i widoczne w planie jako `!` (BLOCKED).
- Utrzymanie sprowadza się do macierzy obrazów w CI, bez śledzenia wewnętrznych API n8n.
