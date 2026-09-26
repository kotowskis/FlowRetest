# Przegląd frontendu i przeprojektowanie (2026-09-26)

Zakres: `apps/web`, czyli strony publiczne (główna, cennik, logowanie, teksty prawne) i aplikacja po zalogowaniu (organizacje, workspace'y, przebiegi, porównanie, drift, billing, dane, konto). Ocena na podstawie kodu i zrzutów z trybu testowego (`npm run test-mode`), w jasnym i ciemnym motywie, na 1024 px i 375 px.

## Co było słabe

### Tożsamość i wygląd

1. Brak tożsamości wizualnej. Fonty systemowe (`ui-sans-serif`, na Windows Segoe UI), znak marki to słowo `flowretest` w systemowym monospace, brak favikony i koloru motywu przeglądarki. Stronę dało się pomylić z dowolnym szablonem Tailwinda.
2. Paleta z listy domyślnych wyborów: jasny motyw na kremowym tle `#fbfaf8` z ciepłymi szarościami, ciemny na ciepłej czerni `#151412`. Akcent `#2f5bd3` to typowy niebieski SaaS; w ciemnym motywie pastelowy `#8aa8ff` z ciemnym napisem wyglądał na wyblakły przycisk.
3. Jeden kształt na wszystko. Klasa `rounded-md border border-line bg-panel` wystąpiła kilkadziesiąt razy: kroki, funkcje, plany, kafelki, listy. Nic nie miało wagi większej od reszty.
4. Hero według szablonu: nagłówek, szary akapit, dwa przyciski, blok kodu. Najmocniejszy materiał produktu, czyli sam plan zmian, był zwykłym `<pre>` bez kolorów dla `+ ~ - !`, słabiej widocznym od tekstu nad nim.
5. Płaska skala typografii: h1 36 px, h2 20 px, prawie cała treść w 14 px w kolorze wyciszonym. Najważniejszy argument o prywatności („Co opuszcza Twoją maszynę”) był ścianą tekstu zamiast zestawienia.
6. Strona główna nie pokazywała produktu. Ani widoku przebiegu, ani macierzy dryfu, tylko opisy.
7. Cennik: trzy identyczne karty, plan Team wyróżniony wyłącznie ramką 1 px, trzy jednakowe główne przyciski, brak tabeli porównawczej, FAQ jako lista bez układu.
8. Logowanie: wąska kolumna, marka w postaci szarego napisu 14 px.

### Treść

9. Strona główna reklamowała komendę `flowretest plan`, której CLI nie ma: w tabeli komend w `packages/cli/README.md` jej nie ma. Trzeci krok procesu to `accept`.
10. Przykładowy plan w hero pokazywał jedną zmianę i nic więcej, więc legenda znaczników nie miała na czym się oprzeć.

### Aplikacja

11. Widok przebiegu otwierało sześć równych kafelków z dużymi liczbami. „Changed 2” miało tę samą wagę co „Blocked 0”. Linia w stylu `terraform plan` mieści to samo w jednym zdaniu, a niezerowe wartości da się w niej wyróżnić.
12. Tabela różnic pól rozróżniała starą i nową wartość głównie kolorem (czerwień kontra zieleń), a nagłówki `field old new` miały 12 px. Tej pary kolorów najgorzej używa się przy deuteranopii.
13. Akcje nieodwracalne jednym kliknięciem: Remove (członek), Make owner, Cancel (zaproszenie), Revoke (token), Unlink (GitHub), Remove (webhook Slack), Delete run. „Delete run” stał w nagłówku obok „Download PDF record”.
14. Nawigacja wewnątrz organizacji to szare linki po prawej stronie nagłówka (Engine drift, Data and DPA, Billing), bez stanu aktywnego. Strona workspace'u to sześć sekcji jedna pod drugą bez podziału na dane i ustawienia.
15. Formularz nowej organizacji układał wszystko w jednym wierszu `flex-wrap`, przez co checkbox z długim zdaniem o regulaminie lądował obok przycisku.
16. Przyciski w pięciu wariantach pisanych ręcznie, z różną wysokością; przyciski „quiet” miały ok. 24 px wysokości, na granicy WCAG 2.5.8.
17. Brak zaprojektowanego fokusu (tylko domyślny obrys przeglądarki), brak linku „Skip to content”, brak `color-scheme`, więc natywne kontrolki formularzy zostawały jasne w ciemnym motywie.
18. Tabele na telefonie przewijały się w poziomie bez żadnej wskazówki, ścieżka okruszków zawijała się na dwie linie.
19. Teksty prawne w 14 px na szerokości 768 px, czyli ok. 100 znaków w linii.

Kontrast kolorów tekstu przechodził próg 4.5:1, problemem był rozmiar (12 px dla informacji takich jak „waiting for flowretest pull”), nie kolor.

## Kierunek nowego projektu

Produkt drukuje plan (model `terraform plan`), a Agency dostaje zapis PDF do audytów. Stąd motyw: papier do drukarki wierszowej, tzw. green-bar.

| Element | Wybór | Uzasadnienie |
|---|---|---|
| Papier | `#f3f5f2`, panel `#fcfdfb` | chłodna, lekko zielona biel zamiast kremu |
| Pas | `#e4ece3` | co drugi wiersz planu, tabeli i listy, jak na papierze green-bar |
| Tusz | `#151a2c` | granatowa czerń taśmy barwiącej |
| Akcent | `#3a2db5` | fiolet kalki maszynowej: proxy zatrzymuje kopię każdego żądania |
| Statusy | `+` zielony, `~` bursztynowy, `-` czerwony, `!` petrol | kolory z `terraform plan`; `!` (blokada przez pieczęć sandboksa) odróżniony od akcentu |
| Nagłówek | Doto (matryca punktowa) | tylko w trzech miejscach: baner strony głównej, wynik przebiegu (`DIFF`), ceny |
| Tekst | Atkinson Hyperlegible Next | czytelność jako wymóg, nie ozdoba |
| Dane | Atkinson Hyperlegible Mono | ta sama rodzina, kod, hosty, wartości |

Element rozpoznawczy to wydruk planu na papierze perforowanym: otwory transportowe na obu marginesach, linia perforacji, znacznik operacji w osobnej kolumnie, pas co drugi wiersz. Pojawia się w hero strony głównej i w każdym przypadku (case) na stronie przebiegu. Reszta strony jest spokojna.

Znaczniki `+ ~ - ! =` rysuje SVG (`OpGlyph` w `components/ui.tsx`). Atkinson Mono, jak większość fontów monospace, rysuje `~` nisko i cienko, więc przy 18 px wyglądał jak `-`, a to dwa różne znaczenia (zmieniono i usunięto).

## Co się zmieniło

- `app/globals.css`: tokeny dla obu motywów, `color-scheme`, `accent-color`, jeden fokus dla wszystkich kontrolek, `prefers-reduced-motion`, narzędzia `printout`, `ledger`, `record-list`, `eyebrow`, `font-dot`, link „Skip to content”.
- `app/layout.tsx`: fonty przez `next/font/google` (pobierane przy buildzie i serwowane z własnej domeny, więc `font-src 'self'` w CSP zostaje), `themeColor` dla obu motywów. `app/icon.svg`: znak z falą `~` i otworami transportowymi.
- Strona główna: baner „What would this change send?”, polecenie `npx flowretest init` z przyciskiem kopiowania, plan na wydruku z legendą, sekwencja `pull`, `run`, `accept`, zestawienie „zostaje w `.flowretest/`” kontra „trafia do usługi”, przykład macierzy dryfu (z podpisem, że to przykład), lista funkcji w tabeli z pasami, blok onboardingu.
- Cennik: tabela porównawcza z kolumną na plan (na telefonie karty), pasek „Runner” nad tabelą, jeden główny przycisk (Team), FAQ w dwóch kolumnach.
- Widok przebiegu: status w nagłówku w Doto, metadane jako karta z etykietami, podsumowanie w jednym zdaniu z wyróżnionymi niezerowymi licznikami, pasek pokrycia z segmentem na każdy węzeł zapisu, przypadki na wydruku, kolumny `Before` i `After` z elementami `del`/`ins`.
- Nawigacja: zakładki organizacji (Workspaces and members, Engine drift, Data and DPA, Billing) i workspace'u (Workflows and settings, Engine drift) z `aria-current`.
- Sekcje ustawień w dwóch kolumnach na szerokich ekranach (tytuł i opis po lewej, treść po prawej).
- `ConfirmButton` w `components/forms.tsx` dla siedmiu akcji z punktu 13: pierwsze kliknięcie pyta i przenosi fokus na potwierdzenie, drugie wysyła formularz, „Keep”, Escape albo 5 sekund cofają.
- Przyciski w trzech wariantach o wysokości 40 px (główny, drugorzędny) i 32 px (cichy).
- Teksty prawne w 15 px, maks. 70 znaków w linii.

Sprawdzone: `eslint`, `tsc --noEmit`, 53 testy jednostkowe `apps/web`, zrzuty stron w obu motywach, brak przewijania w poziomie na 375 px, działanie `ConfirmButton` w przeglądarce.

## Czego nie ruszałem

- Zapis PDF przebiegu i DPA (`lib/pdf/*`) nadal używa Inter i Roboto Mono. Zmiana fontów w react-pdf wymaga osobnych testów (fontkit wywracał się na części plików TTF, notatki z tygodnia 13).
- Szablon maila logowania (`supabase/templates/sign-in.html`).
- Nie było buildu produkcyjnego (`next build`) w tej sesji, bo katalog `.next` używał działający serwer trybu testowego. CI robi build i przy okazji pobiera fonty.
