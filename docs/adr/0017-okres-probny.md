# ADR 0017. Okres próbny planów płatnych

Data: 2026-09-25. Status: przyjęte; długość i wymóg karty do potwierdzenia przez założyciela.

## Kontekst

ADR 0010 zostawił okres próbny jako decyzję założyciela („Checkout przyjmuje `subscription_data[trial_period_days]`”). Założyciel poprosił o jego wprowadzenie przed startem sprzedaży. Plan Free w aplikacji już pozwala spróbować przepływu bez karty (1 workspace, bez Checka i Slacka), więc okres próbny dotyczy tego, czego Free nie daje: wielu workspace'ów, GitHub Checka, Slacka, a w Agency PDF i macierzy dryfu.

## Decyzje

| Temat | Decyzja | Powód |
|---|---|---|
| Długość | 14 dni, zmienna `STRIPE_TRIAL_DAYS` (0 do 90, 0 wyłącza, inna wartość daje 14) | dwa tygodnie to czas na podłączenie CI i kilka prawdziwych zmian w workflow; zmiana długości nie wymaga wdrożenia kodu |
| Plany | Team i Agency, miesięcznie i rocznie | cena po okresie próbnym jest ta sama co bez niego |
| Karta | Checkout zawsze pobiera kartę (`payment_method_collection=always`); `trial_settings.end_behavior.missing_payment_method=cancel` na wypadek subskrypcji bez karty | darmowy wariant bez karty już istnieje (Free); karta zmniejsza liczbę kont zakładanych tylko po to, żeby przez dwa tygodnie mieć Agency |
| Ile razy | raz na organizację: `billing_accounts.first_subscription_at` ustawia pierwsza zsynchronizowana subskrypcja, z okresem próbnym albo bez; organizacje z subskrypcją sprzed tej zmiany mają go uzupełnionego w migracji | kolejna subskrypcja po anulowaniu zaczyna się od płatności; porzucony Checkout nie zużywa okresu próbnego, bo nie powstała subskrypcja |
| Plan w trakcie | status `trialing` daje cały plan (tak było od ADR 0010: `subscription_gives_plan`) | limity, Check i Slack działają od pierwszego dnia |
| Zmiana planu w trakcie | przez to samo `changeSubscriptionPrice`; Stripe nie obciąża niczego i zostawia datę końca; komunikat mówi, do kiedy trwa okres próbny | proporcjonalna faktura za zmianę w trakcie okresu próbnego wynosi 0 |
| Koniec | pierwsza faktura za pełny okres; nieudana płatność daje `past_due`, dalej jak każde nieudane odnowienie (ponawianie przez Stripe, potem Free) | jedna ścieżka dla wszystkich nieudanych płatności |
| Zapis | `billing_accounts.trial_end` (koniec okresu próbnego, gdy status to `trialing`), zdarzenie `customer.subscription.trial_will_end` dodane do synchronizowanych | strona Billing pokazuje datę pierwszego obciążenia i kwotę |
| Teksty | strona Billing („Free trial until …, then the card is charged … unless you cancel”), przyciski „Try Team free for 14 days, then monthly”, cennik, strona główna, punkt 3 regulaminu | klient widzi datę i kwotę pierwszego obciążenia, zanim poda kartę i po jej podaniu |

## Czego tu nie ma

Maila od nas przed końcem okresu próbnego: Stripe wysyła go sam, jeśli w ustawieniach konta włączy się przypomnienie (Settings, Billing, Subscriptions and emails, „Send a reminder email … before a free trial ends”). Ochrony przed zakładaniem nowych organizacji dla kolejnych okresów próbnych: przy wymaganej karcie i 14 dniach koszt nadużycia to kilka godzin Agency, więc zostaje bez blokady.

## Lista dla założyciela

1. Potwierdzić 14 dni i wymóg karty albo ustawić `STRIPE_TRIAL_DAYS` inaczej (0 wyłącza okres próbny wszędzie, także w tekstach cennika).
2. W Stripe włączyć przypomnienie mailowe przed końcem okresu próbnego i sprawdzić jego treść.
3. W trybie testowym przejść Checkout z kartą testową, potem w Stripe „End trial now” na subskrypcji i sprawdzić fakturę 79 EUR oraz stronę Billing.

## Skutki

- Testy zmiany planu (`plan-change.test.ts`) ustawiają `trialDays: 0`, bo sprawdzają płatne przejścia; ścieżka z okresem próbnym ma własny plik `trial.test.ts`.
- Atrapa Stripe tworzy subskrypcję `trialing` z fakturą na 0 i kończy okres próbny przez `POST /__stripe/subscriptions/<id> {"end_trial": true}` (pierwsza faktura, udana albo nieudana przy `fail_payments`).
