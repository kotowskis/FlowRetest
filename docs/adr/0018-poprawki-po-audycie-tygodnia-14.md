# ADR 0018. Poprawki po audycie tygodnia 14

Data: 2026-09-25. Status: przyjęte.

## Kontekst

Audyt tygodnia 14 (`docs/audyt-tydzien-14-2026-09-25.md`) znalazł 39 problemów. Najwięcej dotyczyło tekstów prawnych, które obiecywały więcej, niż robi kod, oraz wysyłki powiadomień o podprocesorach. Numery w tabeli to numery punktów audytu.

## Decyzje

| # | Temat | Decyzja | Powód |
|---|---|---|---|
| 1 | Redakcja w tekstach | teksty opisują to, co robi `core/redact.ts`: wartości tekstowe jako typ, długość i skrót, liczby poniżej miliona oraz `true`/`false`/`null` czytelne, `normalize.ignore` wyłącza pole z raportu; DPA zobowiązuje klienta do wpisania tam pól, które same ujawniłyby osobę albo szczególną kategorię danych; test jednostkowy porównuje tekst z `shapeOf` | zmiana kodu zabrałaby z raportu to, po co agencja go ogląda (kwota 100 zamiast 120, flaga, licznik); ADR 0012 już przyjął to ograniczenie |
| 10 | VAT | teksty mówią, że polska firma płaci polski VAT, a firma z innego kraju UE rozlicza odwrotne obciążenie; strona Billing pisze „plus VAT where due”; Checkout z kluczem `sk_live_` bez jawnego `STRIPE_AUTOMATIC_TAX` (`true` albo `false`) kończy się błędem | faktury bez VAT przy tekście „ceny netto” to błąd, którego nie widać, dopóki nie przyjdzie księgowa |
| 12 | Dane w DPA | punkt 3 i Załącznik 1 wymieniają nazwę gałęzi i nazwę konta GitHub podłączonej instalacji | oba pola są zapisywane (`runs.report.git.ref`, `github_installations.account_login`) |
| 13 | Koniec usługi | regulamin dostaje punkt 9 o czasie obowiązywania i wypowiedzeniu (30 dni z naszej strony), DPA punkt 10 mówi o usunięciu danych w 30 dni od końca | art. 28 ust. 3 lit. g wymaga usunięcia albo zwrotu po zakończeniu usługi; porzucone organizacje Free zostają pytaniem do prawnika |
| 14 | Transfery | punkt 7 DPA i Załącznik 3 podają podstawę dostępu spoza EOG (SCC, dla Vercela też Data Privacy Framework) | Supabase, Vercel i Resend należą do grup z USA; treść do sprawdzenia przez prawnika z ich umowami powierzenia |
| 28, 37 | Retencja i prywatność | strona retencji: dziennik logowania usługi auth (30 dni), adres osoby w zapisach, które zrobiła, logi hostingu (do 30 dni), rejestr powiadomień po usunięciu organizacji, zdanie o nocnym usuwaniu; informacja o prywatności: dane osoby akceptującej DPA, rejestr powiadomień, przekazanie do Stripe Inc., prawo do przenoszenia danych | teksty mają wymieniać wszystko, co usługa trzyma |
| 36 | Polski DPA | poprawione sformułowania (dalszy podmiot przetwarzający, „zastąpionym”, „nie może”), odwołanie do Regulaminu mówi, że jest po angielsku | tłumaczenie ma zobowiązywać tak samo jak tekst angielski |

Wersja DPA zostaje `2026-09-25`. Tekst jest wersją roboczą, nikt nie przyjął go na produkcji, więc zmiana bez nowej daty nikogo nie wiąże starszym brzmieniem. Pierwsza wersja po przeglądzie prawnika dostanie datę przeglądu.
