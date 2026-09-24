# ADR 0004. Sterowanie proxy przez pliki, bez portu kontrolnego

Data: 2026-09-24. Status: przyjęte.

## Kontekst

Sieć Docker `--internal` nie publikuje portów na hoście, a proxy ma być tylko w tej sieci, żeby nie miało dokąd przekazać ruchu.

## Decyzja

Proxy czyta reguły z bind mountu `/rules/rules.json`, kontekst bieżącego przypadku z `/capture/current.json` i dopisuje przechwycenia do `/capture/requests.jsonl`. Runner pisze i czyta te pliki na hoście. Przebieg jest sekwencyjny, więc jeden plik kontekstu wystarcza.

## Skutki

- Proxy bez portu kontrolnego i bez dostępu do internetu.
- Współbieżność przypadków ograniczona do 1.
- Przypisanie żądań do węzłów po czasie z `runData`, bo proxy widzi tylko HTTP.
