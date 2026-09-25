# ADR 0016. Powiadomienia o zmianie podprocesorów, DPA po polsku

Data: 2026-09-25. Status: przyjęte, teksty prawne nadal czekają na prawnika (ADR 0015).

## Kontekst

ADR 0015 zostawił dwie rzeczy na później. Pierwsza to maile do właścicieli o zmianie podprocesora, które obiecuje punkt 6 DPA: 30 dni wyprzedzenia i prawo sprzeciwu. Druga to DPA po polsku. Założyciel poprosił o obie przed startem sprzedaży, bo pierwsze agencje z listy to dwie firmy z Polski (notatka, sekcja 9), a lista podprocesorów zmieni się przy każdej późniejszej zmianie hostingu albo poczty.

## Decyzje

| Temat | Decyzja | Powód |
|---|---|---|
| Zapis zmiany | tabela `subprocessor_notices` (data ogłoszenia, data wejścia w życie, opis, lista zmian: `add`, `remove`, `change` z nazwą, celem, danymi i lokalizacją); ograniczenie `check` wymaga co najmniej 30 dni między ogłoszeniem a zmianą | termin z DPA pilnuje baza, nie skrypt; krótszego ogłoszenia nie da się zapisać nawet ręcznie |
| Kto widzi | ogłoszenia czyta każdy (także bez logowania), zapisuje tylko rola serwisowa; rejestr wysyłki tylko rola serwisowa | ogłoszenie jest publiczne z definicji; rejestr ma adresy właścicieli |
| Kto dostaje mail | właściciele organizacji z co najmniej jedną akceptacją DPA, jeden mail na osobę z nazwami wszystkich jej organizacji (`subprocessor_notice_recipients`) | tak mówi strona podprocesorów; osoba z pięcioma organizacjami nie dostaje pięciu identycznych maili |
| Wysyłka | skrypt `scripts/subprocessor-notice.ts` (`announce`, `send`, `send --dry-run`, `list`), bez panelu administratora; rejestr `subprocessor_notice_deliveries` z wynikiem; ponowne `send` pomija wysłane i ponawia nieudane | aplikacja nie ma roli administratora, a zmiana podprocesora zdarza się kilka razy w roku; ponawianie bez duplikatów pozwala spokojnie uruchomić skrypt drugi raz po awarii poczty |
| Sprzeciw | mail podaje datę, zmiany, stronę z listą i adres do sprzeciwu (`LEGAL_EMAIL`, także jako Reply-To) | punkt 6 DPA: sprzeciw na piśmie w 30 dni, potem wypowiedzenie planu ze zwrotem |
| Gdzie widać | sekcja „Announced changes” na `/legal/subprocessors` (także zmiany, które już weszły) i ramka nad akceptacją DPA na stronie Data organizacji, póki zmiana nie weszła | właściciel, który akceptuje DPA po wysłaniu maili, też musi się o zmianie dowiedzieć |
| Retencja | rejestr wysyłki znika rok po wejściu zmiany w życie (nocne czyszczenie), ogłoszenie zostaje jako historia listy; wiersz w tabeli retencji | rejestr jest dowodem wysłania na czas sporu o sprzeciw; rok wystarcza, bo sprzeciw ma 30 dni |
| Po dacie zmiany | listę `SUBPROCESSORS` w `lib/legal/documents.ts` poprawia się ręcznie | zmiana listy to zmiana treści Załącznika 3; nie może się dziać sama o północy |
| DPA po polsku | `lib/legal/dpa-pl.ts`, ta sama wersja i ta sama struktura co tekst angielski (test porównuje sekcje, bloki, listy i tabele); `/legal/dpa?lang=pl`, PDF kopii `?lang=pl` z polskimi etykietami; polskie opisy podprocesorów w polu `pl` każdego wpisu | akceptacja dotyczy wersji umowy, nie języka, więc każdy członek pobiera kopię w obu językach bez drugiej akceptacji |
| Pierwszeństwo | punkt 12 w obu wersjach: w razie rozbieżności rozstrzyga wersja angielska | jedna wersja wiążąca dla klientów z wielu krajów; pytanie dla prawnika w `docs/sprzedaz.md` |
| Filtr markerów AI | test jednostkowy przepuszcza polski tekst przez reguły filtra (długi myślnik, „nie tylko … ale”, trójki słów) | tekst dla ludzi po polsku podlega tym samym regułom co dokumentacja |
| Nagłówki w PDF | nagłówek punktu i pierwszy blok w jednym niepodzielnym `View` | nagłówek zostawał sam na dole strony; `minPresenceAhead` w react-pdf 4.9 tego nie naprawił |

## Sprawdzone

`announce` z datą za 29 dni odrzucone, z datą za 30 dni przyjęte; `send --dry-run`, potem `send` (12 odbiorców w lokalnej bazie, 12 maili w Mailpicie) i drugie `send` (0 wysłanych, 12 pominiętych); treść maila obejrzana w Mailpicie. Strona Data z ramką zmian i linkiem „PDF (PL)”, `/legal/dpa?lang=pl` przy 375 px bez przewijania w poziomie, PDF po polsku obejrzany jako obrazy stron.

## Skutki

- Zmiana tekstu DPA to zmiana w dwóch plikach (`documents.ts` i `dpa-pl.ts`) i nowa data wersji; test struktury nie przepuści zmiany w jednym języku bez drugiego.
- Dopóki nikt nie przyjął DPA na produkcji, listę kandydatów poprawia się bez ogłoszenia (wybór hostingu i poczty w ADR 0015). Ogłoszenia dotyczą zmian po pierwszej akceptacji.
