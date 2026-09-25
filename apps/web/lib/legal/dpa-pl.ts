/**
 * Polish text of the Data Processing Agreement (ADR 0016). Same sections and blocks as the English one in
 * documents.ts, in the same order; a unit test compares the two shapes. The English version prevails (section 12).
 */
import type { LegalDocument } from './documents.ts';
import type { Provider } from './provider.ts';

const LOCAL_ONLY_PL =
  'Runner nigdy nie przesyła treści żądań, nagranych wykonań, fixture\'ów, baseline\'ów ani poświadczeń. Zostają one w katalogu .flowretest na komputerze albo w runnerze CI, na którym działał runner.';

const REDACTED_PL =
  'Raport po redakcji zawiera nazwy workflow i węzłów, etykiety wersji, metody HTTP, hosty, szablony adresów URL oraz nazwy pól. Każdą wartość tekstową zastępuje jej typ, długość i skrót, a obiekty i listy zastępuje ich rozmiar. Skrót powstaje z kluczem losowanym dla każdego raportu na komputerze z runnerem; klucz nie jest przesyłany, więc usługa nie może odtworzyć skrótu ze zgadniętej wartości. Liczby mniejsze niż milion, wartości logiczne true i false oraz null zostają czytelne, bo pokazują, jak zmiana wpływa na kwotę, licznik albo flagę; większe liczby zastępuje liczba ich cyfr. Nazwy pól i segmenty ścieżek zostają czytelne, chyba że zawierają adres e-mail, spację albo co najmniej siedem cyfr z rzędu. W komunikatach błędów adresy e-mail, cytowany tekst i długie liczby są zastąpione. Usługa odrzuca raport, w którym czytelna została wartość tekstowa, adres e-mail albo długa liczba. Pole wpisane w normalize.ignore w pliku .flowretest/config.yml w ogóle nie trafia do raportu.';

export function dpaPl(p: Provider, version: string, subprocessorRows: string[][]): LegalDocument {
  return {
    slug: 'dpa',
    title: 'Umowa powierzenia przetwarzania danych osobowych',
    version,
    summary: 'Warunki, na jakich FlowRetest przetwarza dane osobowe w imieniu organizacji, zgodnie z art. 28 RODO.',
    sections: [
      {
        heading: '1. Strony i zakres',
        blocks: [
          { p: `Umowę zawierają organizacja, która ją akceptuje (Klient), oraz ${p.name}, ${p.address}, ${p.companyId} (Dostawca). Umowa dotyczy danych osobowych, które Dostawca przetwarza dla Klienta, świadcząc usługę hostowaną FlowRetest na podstawie Regulaminu (Terms of Service, dostępnego po angielsku).` },
          { p: 'Klient działa jako administrator albo jako podmiot przetwarzający dla własnych klientów. Gdy Klient jest podmiotem przetwarzającym, Dostawca jest jego dalszym podmiotem przetwarzającym, a Klient przenosi na Dostawcę obowiązki z własnej umowy, które dotyczą usługi.' },
          { p: 'Runner open source (CLI flowretest i GitHub Action) działa na komputerach Klienta i nie jest objęty tą umową. Dostawca nie ma dostępu do danych, które runner czyta albo przechowuje.' },
        ],
      },
      {
        heading: '2. Przedmiot, charakter i cel',
        blocks: [
          { p: 'Dostawca przechowuje przesłane przez Klienta raporty przebiegów po redakcji i pokazuje je członkom Klienta. Zapisuje akceptacje, wysyła skonfigurowane przez Klienta powiadomienia (e-mail, Slack, GitHub Check) oraz przechowuje członków i ustawienia organizacji.' },
          { p: 'Dostawca przetwarza dane wyłącznie po to, żeby świadczyć usługę, i nie w żadnym własnym celu. Nie sprzedaje danych, nie używa ich do trenowania modeli i nie łączy ich z danymi innych klientów.' },
        ],
      },
      {
        heading: '3. Dane i osoby, których dane dotyczą',
        blocks: [
          {
            ul: [
              'Członkowie Klienta i osoby zaproszone: adres e-mail, rola, czasy logowania, adres IP prób logowania, wiadomości wpisane przy akceptacji przebiegu.',
              'Klienci Klienta i ich kontakty, wyłącznie po redakcji: typy i długości wartości tekstowych, które wysłałyby workflow n8n, oraz ich skróty z kluczem, a także liczby mniejsze niż milion i wartości logiczne spośród tych wartości, nazwy pól oraz nazwy, które Klient nadał workflow i węzłom oraz workspace\'om.',
              'Autorzy commitów jako nazwa repozytorium, nazwa gałęzi, skrót commita i numer pull requesta, gdy runner przesyła raport z CI, oraz nazwa konta GitHub podłączonej instalacji GitHub.',
            ],
          },
          { p: REDACTED_PL },
          { p: `${LOCAL_ONLY_PL} Klient nie może umieszczać danych osobowych w przesyłanych nazwach workflow, węzłów, workspace'ów ani gałęzi. Musi wpisać w normalize.ignore pola, których liczby albo wartości logiczne same ujawniłyby osobę albo szczególną kategorię danych, a przesyłać może wyłącznie raporty zapisane przez flowretest upload albo flowretest redact --report.` },
        ],
      },
      {
        heading: '4. Polecenia',
        blocks: [
          { p: 'Dostawca przetwarza dane wyłącznie na udokumentowane polecenie Klienta, także w sprawie przekazywania poza EOG, chyba że obowiązek przetwarzania nakłada na niego prawo Unii lub państwa członkowskiego; wtedy informuje Klienta przed rozpoczęciem przetwarzania, o ile to prawo tego nie zabrania. Poleceniami Klienta są ta umowa, Regulamin oraz ustawienia wybrane przez właścicieli organizacji w aplikacji (członkowie, workspace\'y, integracje, retencja). Dostawca niezwłocznie informuje Klienta, jeśli uzna, że polecenie narusza przepisy o ochronie danych.' },
        ],
      },
      {
        heading: '5. Poufność i bezpieczeństwo',
        blocks: [
          { p: 'Osoby po stronie Dostawcy z dostępem do danych Klienta są zobowiązane do zachowania poufności. Dostęp mają tylko osoby obsługujące usługę. Środki techniczne i organizacyjne wymienia Załącznik 2; Dostawca może zastąpić środek innym, który chroni dane co najmniej tak samo.' },
        ],
      },
      {
        heading: '6. Dalsze podmioty przetwarzające',
        blocks: [
          { p: 'Klient zgadza się, żeby Dostawca korzystał z dalszych podmiotów przetwarzających wymienionych na stronie /legal/subprocessors (Załącznik 3). Dostawca wiąże każdy z nich pisemną umową z obowiązkami ochrony danych nie słabszymi niż w tej umowie i odpowiada wobec Klienta za ich działania.' },
          { p: 'O nowym albo zastąpionym dalszym podmiocie przetwarzającym Dostawca informuje na tej stronie oraz mailem do właścicieli organizacji co najmniej 30 dni przed rozpoczęciem przetwarzania; termin liczy się od dnia wysłania maila. Klient może w tym terminie zgłosić sprzeciw na piśmie. Jeśli strony nie znajdą rozwiązania, Klient może wypowiedzieć plan płatny, którego zmiana dotyczy, i otrzymuje zwrot opłaty za niewykorzystany okres.' },
          { p: 'GitHub i Slack otrzymują dane tylko wtedy, gdy właściciel podłączy instalację GitHub albo doda webhook Slacka. Działają na polecenie Klienta na podstawie jego własnych umów z nimi i nie są dalszymi podmiotami przetwarzającymi Dostawcy.' },
        ],
      },
      {
        heading: '7. Przekazywanie poza EOG',
        blocks: [
          { p: 'Dostawca przechowuje dane Klienta w Unii Europejskiej. Część dalszych podmiotów przetwarzających z Załącznika 3 należy do grup z siedzibą w Stanach Zjednoczonych i może mieć dostęp do danych spoza Europejskiego Obszaru Gospodarczego na potrzeby wsparcia i utrzymania usług. Takie przekazanie następuje tylko do dalszego podmiotu przetwarzającego z Załącznika 3, na podstawie decyzji stwierdzającej odpowiedni stopień ochrony, w tym EU-US Data Privacy Framework dla firmy z certyfikacją, albo standardowych klauzul umownych UE zawartych w warunkach przetwarzania danych tego podmiotu.' },
        ],
      },
      {
        heading: '8. Pomoc',
        blocks: [
          { p: 'Dostawca pomaga Klientowi odpowiadać na żądania osób, których dane dotyczą. Aplikacja pozwala właścicielom eksportować dane organizacji oraz usuwać przebiegi, workspace\'y i organizację, a każdemu członkowi usunąć konto; w pozostałych sprawach Klient pisze na adres ' + p.email + '. Dostawca przekazuje też informacje potrzebne Klientowi do oceny skutków dla ochrony danych albo do konsultacji z organem nadzorczym.' },
        ],
      },
      {
        heading: '9. Naruszenia ochrony danych osobowych',
        blocks: [
          { p: 'Dostawca zawiadamia właścicieli organizacji bez zbędnej zwłoki, nie później niż 48 godzin po stwierdzeniu naruszenia dotyczącego danych Klienta. Zawiadomienie opisuje zdarzenie, dotknięte dane i liczbę osób w zakresie, w jakim są znane, prawdopodobne skutki oraz podjęte środki. Kolejne informacje Dostawca przekazuje w miarę ich uzyskiwania.' },
        ],
      },
      {
        heading: '10. Usunięcie i zwrot danych',
        blocks: [
          { p: 'Przebiegi są usuwane po okresie przechowywania z planu albo po krótszym okresie ustawionym przez właściciela, zgodnie z opisem na stronie /legal/retention. Właściciel może w każdej chwili wyeksportować wszystkie dane organizacji (strona Data organizacji).' },
          { p: 'Gdy Klient usuwa organizację, jej dane znikają z bazy od razu, a z kopii zapasowych w ciągu 7 dni, chyba że przepisy wymagają od Dostawcy zachowania kopii. Faktury są przechowywane tak długo, jak wymagają tego przepisy podatkowe. Rejestr maili o zmianach dalszych podmiotów przetwarzających wysłanych do właścicieli zostaje przez rok po zmianie jako dowód zawiadomienia (/legal/retention).' },
          { p: 'Gdy Regulamin przestaje obowiązywać z innego powodu, właściciele mogą wyeksportować dane w okresie wypowiedzenia, a Dostawca usuwa organizację i jej dane w ciągu 30 dni od zakończenia, chyba że przepisy wymagają zachowania kopii.' },
        ],
      },
      {
        heading: '11. Audyty',
        blocks: [
          { p: 'Dostawca udostępnia informacje potrzebne do wykazania przestrzegania tej umowy. Klient albo audytor zobowiązany do poufności może przeprowadzić audyt raz w roku, po 30 dniach od zawiadomienia, w godzinach pracy i na koszt Klienta, a po naruszeniu częściej. Dostawca może najpierw odpowiedzieć dokumentami i pisemnym kwestionariuszem.' },
        ],
      },
      {
        heading: '12. Czas trwania, odpowiedzialność oraz pierwszeństwo',
        blocks: [
          { p: 'Umowa obowiązuje tak długo, jak Dostawca przetwarza dane dla Klienta. Odpowiedzialność określa Regulamin. W sprawach danych osobowych ta umowa ma pierwszeństwo przed Regulaminem. Prawem właściwym jest prawo polskie. Umowa jest dostępna po angielsku i po polsku; w razie rozbieżności rozstrzyga wersja angielska.' },
        ],
      },
      {
        heading: 'Załącznik 1. Szczegóły przetwarzania',
        blocks: [
          {
            table: {
              head: ['Element', 'Opis'],
              rows: [
                ['Przedmiot', 'Przechowywanie raportów przebiegów FlowRetest po redakcji oraz historii akceptacji Klienta'],
                ['Czas trwania', 'Okres obowiązywania Regulaminu oraz terminy usunięcia z punktu 10'],
                ['Osoby, których dane dotyczą', 'Członkowie Klienta i osoby zaproszone; klienci Klienta i ich kontakty po redakcji; autorzy commitów jako identyfikatory repozytorium, gałęzi oraz commita'],
                ['Dane', 'Adresy e-mail, role, czasy logowania i adresy IP prób logowania, wiadomości przy akceptacjach; typy i długości wartości tekstowych oraz ich skróty z kluczem, liczby mniejsze niż milion i wartości logiczne; nazwy nadane przez Klienta; nazwy repozytoriów oraz gałęzi, nazwy kont GitHub'],
                ['Szczególne kategorie danych', 'Nie są przewidziane. Wartości tekstowe nigdy nie są przesyłane jawnym tekstem; pola, których liczby albo wartości logiczne ujawniałyby szczególną kategorię danych, Klient wyłącza z raportu przez normalize.ignore'],
                ['Operacje', 'Przechowywanie, wyświetlanie, porównywanie przebiegów, powiadomienia, eksport, usuwanie'],
                ['Okres przechowywania', 'Zgodnie z listą na stronie /legal/retention'],
              ],
            },
          },
        ],
      },
      {
        heading: 'Załącznik 2. Środki techniczne i organizacyjne',
        blocks: [
          {
            ul: [
              'Redakcja po stronie Klienta przed przesłaniem, ze skrótem z kluczem, który zostaje przy runnerze; usługa odrzuca raporty, w których czytelne zostały wartości tekstowe, adresy e-mail albo długie liczby.',
              'TLS dla każdego połączenia z aplikacją oraz między aplikacją a jej bazą danych.',
              'Szyfrowanie bazy danych i jej kopii zapasowych w spoczynku przez dostawcę hostingu (AES-256).',
              'Zabezpieczenia na poziomie wierszy w bazie: członkowie czytają tylko własne organizacje; przebiegi zapisuje tylko serwer, po sprawdzeniu raportu.',
              'Tokeny workspace\'ów przechowywane wyłącznie jako skróty SHA-256; unieważnienie działa od następnego żądania.',
              'Logowanie jednorazowymi kodami i linkami wysyłanymi mailem, bez haseł; limity kodów na adres i na adres IP.',
              'Content Security Policy z jednorazowym nonce na żądanie; w aplikacji nie ma skryptów stron trzecich ani narzędzi śledzących.',
              'Adresy webhooków Slacka ograniczone do hooks.slack.com; GitHub Check tylko dla repozytoriów podłączonej instalacji.',
              'Codzienne kopie zapasowe przechowywane przez 7 dni; nocne usuwanie danych po terminie.',
              'Dostęp do środowiska produkcyjnego tylko dla osób obsługujących usługę, z uwierzytelnianiem dwuskładnikowym na kontach hostingu, bazy danych i płatności.',
            ],
          },
        ],
      },
      {
        heading: 'Załącznik 3. Dalsze podmioty przetwarzające',
        blocks: [{ table: { head: ['Firma', 'Cel', 'Dane', 'Lokalizacja'], rows: subprocessorRows } }],
      },
    ],
  };
}
