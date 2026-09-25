/**
 * Polish text of the Data Processing Agreement (ADR 0016). Same sections and blocks as the English one in
 * documents.ts, in the same order; a unit test compares the two shapes. The English version prevails (section 12).
 */
import type { LegalDocument } from './documents.ts';
import type { Provider } from './provider.ts';

const LOCAL_ONLY_PL =
  'Runner nigdy nie przesyła treści żądań, nagranych wykonań, fixture\'ów, baseline\'ów ani poświadczeń. Zostają one w katalogu .flowretest na komputerze albo w runnerze CI, na którym działał runner.';

const REDACTED_PL =
  'Raport po redakcji zawiera nazwy workflow i węzłów, etykiety wersji, metody HTTP, hosty, szablony adresów URL i nazwy pól. Każdą wartość zastępuje jej typ, długość i skrót. Skrót powstaje z kluczem losowanym dla każdego raportu na komputerze z runnerem; klucz nie jest przesyłany, więc usługa nie może odtworzyć skrótu ze zgadniętej wartości. W komunikatach błędów adresy e-mail, cytowany tekst i długie liczby są zastąpione. Usługa odrzuca raport, w którym zostały wartości.';

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
          { p: `Umowę zawierają organizacja, która ją akceptuje (Klient), oraz ${p.name}, ${p.address}, ${p.companyId} (Dostawca). Umowa dotyczy danych osobowych, które Dostawca przetwarza dla Klienta, świadcząc usługę hostowaną FlowRetest na podstawie Regulaminu.` },
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
              'Klienci Klienta i ich kontakty, wyłącznie po redakcji: typy i długości wartości, które wysłałyby workflow n8n, oraz ich skróty z kluczem, a także nazwy, które Klient nadał workflow i węzłom oraz workspace\'om.',
              'Autorzy commitów, wyłącznie jako nazwa repozytorium, skrót commita i numer pull requesta, gdy runner przesyła raport z CI.',
            ],
          },
          { p: REDACTED_PL },
          { p: `${LOCAL_ONLY_PL} Klient nie umieszcza danych osobowych w przesyłanych nazwach workflow, węzłów ani workspace'ów i przesyła wyłącznie raporty zapisane przez flowretest upload albo flowretest redact --report.` },
        ],
      },
      {
        heading: '4. Polecenia',
        blocks: [
          { p: 'Poleceniami Klienta są ta umowa, Regulamin oraz ustawienia wybrane przez właścicieli organizacji w aplikacji (członkowie, workspace\'y, integracje, retencja). Dostawca niezwłocznie informuje Klienta, jeśli uzna, że polecenie narusza przepisy o ochronie danych.' },
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
          { p: 'Klient zgadza się, żeby Dostawca korzystał z dalszych podmiotów przetwarzających wymienionych na stronie /legal/subprocessors (Załącznik 3). Dostawca wiąże każdy z nich pisemną umową z obowiązkami ochrony danych nie słabszymi niż w tej umowie.' },
          { p: 'O nowym albo zmienionym dalszym podmiocie przetwarzającym Dostawca informuje na tej stronie oraz mailem do właścicieli organizacji co najmniej 30 dni przed rozpoczęciem przetwarzania. Klient może w tym terminie zgłosić sprzeciw na piśmie. Jeśli strony nie znajdą rozwiązania, Klient może wypowiedzieć plan płatny, którego zmiana dotyczy, i otrzymuje zwrot opłaty za niewykorzystany okres.' },
          { p: 'GitHub i Slack otrzymują dane tylko wtedy, gdy właściciel podłączy instalację GitHub albo doda webhook Slacka. Działają na polecenie Klienta na podstawie jego własnych umów z nimi i nie są dalszymi podmiotami przetwarzającymi Dostawcy.' },
        ],
      },
      {
        heading: '7. Przekazywanie poza EOG',
        blocks: [
          { p: 'Dostawca przechowuje dane Klienta w Unii Europejskiej. Przekazanie poza Europejski Obszar Gospodarczy następuje tylko do dalszego podmiotu z Załącznika 3, na podstawie decyzji stwierdzającej odpowiedni stopień ochrony albo standardowych klauzul umownych UE.' },
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
          { p: 'Gdy Klient usuwa organizację, jej dane znikają z bazy od razu, a z kopii zapasowych w ciągu 7 dni, chyba że przepisy wymagają od Dostawcy zachowania kopii. Faktury są przechowywane tak długo, jak wymagają tego przepisy podatkowe.' },
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
                ['Osoby, których dane dotyczą', 'Członkowie Klienta i osoby zaproszone; klienci Klienta i ich kontakty po redakcji; autorzy commitów jako identyfikatory repozytorium i commita'],
                ['Dane', 'Adresy e-mail, role, czasy logowania i adresy IP prób logowania, wiadomości przy akceptacjach; typy i długości wartości oraz ich skróty z kluczem; nazwy nadane przez Klienta'],
                ['Szczególne kategorie danych', 'Nie są przewidziane; wartości nigdy nie są przesyłane jawnym tekstem'],
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
              'Redakcja po stronie Klienta przed przesłaniem, ze skrótem z kluczem, który zostaje przy runnerze; usługa odrzuca raporty zawierające wartości.',
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
