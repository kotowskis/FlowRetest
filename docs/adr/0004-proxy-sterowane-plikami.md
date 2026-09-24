# ADR 0004. Sterowanie proxy przez pliki, bez portu kontrolnego

Data: 2026-09-24. Status: przyjęte.

## Kontekst

Sieć Docker `--internal` nie publikuje portów na hoście, a proxy ma być tylko w tej sieci, żeby nie miało dokąd przekazać ruchu.

## Decyzja

Proxy czyta reguły z bind mountu `/rules/rules.json`, kontekst bieżącego przebiegu z `/capture/current.json` i dopisuje przechwycenia do `/capture/requests.jsonl`. Runner pisze i czyta te pliki na hoście.

Uzupełnienie po tygodniu 5 i audycie: w trybie partii (`executeBatch`, ADR 0002) `current.json` niesie tylko wersję (`old`, `new`, `old2`, `new2`), a `case` ma wartość `batch`. Przypadek wynika z okien czasowych wykonań w migawkach (każde żądanie należy do ostatniego wykonania rozpoczętego przed nim), a węzeł z nagłówka `X-FlowRetest-Node` (węzły HTTP Request, nazwa kodowana procentowo) albo z okna czasowego uruchomienia węzła. `{{seq}}` w odpowiedziach jest liczony per endpoint i per wersja z `current.json`.

## Skutki

- Proxy bez portu kontrolnego i bez dostępu do internetu.
- Współbieżność przypadków ograniczona do 1.
- Przypisanie żądań do węzłów po czasie z `runData` i po nagłówku węzła, bo proxy widzi tylko HTTP.
- Na Linuksie proxy działa jako użytkownik hosta, żeby mogło pisać do montowanych katalogów.
