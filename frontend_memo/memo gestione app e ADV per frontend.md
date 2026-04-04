MEMO FRONTEND — IMPOSTAZIONI APP + ADV INTERNI (NestX)
A) IMPOSTAZIONI APP
Scopo

Gestisce SOLO preferenze UI + “Contesto contenuti” (priorità consigliati).
NON include: notifiche, messaggi, feed, token, privacy, sicurezza, verifica, creator.

Campi (salvati su user / appSettings)

theme: "light" | "dark" | "system"

uiLanguage: lingua UI (indipendente dalla lingua profilo)

timeFormat: "24h" | "12h"

contentContext: "standard" | "neutral" | "live_events"

Regole

contentContext NON blocca nulla. Influenza solo la priorità futura di: FED / ADV interni / Vetrina (colonna destra).

Testo UI fisso:

“Influenza la priorità dei contenuti consigliati. Alcune promozioni possono restare visibili.”

Se mancano settings (utenti vecchi) → usare default automaticamente (no error).

API (assunte)

GET /api/app-settings/me

ritorna settings correnti (con default se mancanti)

PUT /api/app-settings/me

aggiorna uno o più campi, valida enum, salva

UI

Schermata “Impostazioni App”

Selettore Tema (3 opzioni)

Lingua App (dropdown)

Formato orario (24/12)

Contesto contenuti (Standard / Neutro / Live & Eventi)

Microcopy sotto contesto contenuti (testo sopra)

B) ADV INTERNI (promozioni creator/VIP)
Concetto

ADV non esplicite create da utenti (VIP/Creator) per promuovere live/eventi/altro interno.
Solo link interni (niente http/https).
ADV esterni (brand) non c’entrano: quelli vanno tra i post con logica separata.

Placement (posizioni)

placement: "profile" | "feed" | "pre_event"

Stati

reviewStatus: "pending" | "approved" | "rejected"

billingType: "free" | "paid"

paidTokens: number (0 o 10)

(click/impressions contatori)

Regole creazione (utente)

Accesso: accountType === "creator" || accountType === "admin" || isVip === true

Free: max 2 ADV gratis al giorno per creator/VIP.

Dal 3° in poi: a pagamento.

Prezzo: 10 token

Pagamento NON automatico

Richiede conferma UI (“Accetta / Annulla”)

Flow 3° ADV (paid) — conferma obbligatoria

Utente compila e preme “Crea ADV”

Backend risponde con:

code: "ADV_PAYMENT_REQUIRED"

priceTokens: 10

messaggio: “Hai già usato i 2 ADV gratis di oggi. Questo ADV costa 10 token. Vuoi procedere?”

UI mostra popup:

“Questo ADV è a pagamento (10 token). Confermi?”

Bottoni: Accetta / Annulla

Se Accetta: UI reinvia creazione con flag confirmPaid: true

Se Annulla: nessuna creazione

Token insufficienti

Se non ha almeno 10 token:

errore code: "INSUFFICIENT_TOKENS"

nessuna creazione

Moderazione (admin)

Tutti gli ADV nascono pending.

Solo approved vengono serviti (feed/profilo).

Se paid: il pagamento avviene SOLO in approvazione admin.

Se in approvazione token non sufficienti → rejected automatico (no pending infinito).

Limite anti-spam

Max 1 ADV attiva (approved) per creator per ogni placement.

quindi 1 profile + 1 feed + 1 pre_event al massimo contemporaneamente.

Anche se paga, non può avere 2 nello stesso placement.

Notifiche ADV

Admin: notifica quando nasce un ADV pending (“Nuovo ADV da approvare”)

Utente: notifica quando ADV viene approved o rejected (con motivo).

Notifiche non persistenti (policy generale), salvo cambio futuro.

API ADV (riassunto frontend)
Creazione

POST /api/adv/campaign

body tipico:

title, text, mediaUrl, placement, targetType, targetId, targetUrl, startsAt, endsAt, languages, countries

confirmPaid (solo se serve)

possibili risposte:

success: crea ADV pending

errore: ADV_PAYMENT_REQUIRED (popup)

errore: INSUFFICIENT_TOKENS

Serving (mostra ADV)

GET /api/adv/serve?placement=feed

ritorna set ridotto ADV approved

ranking: paid sopra, contentContext influenza solo free

GET /api/adv/profile/active/:userId

ritorna ADV profilo attiva (o data: null)

Click tracking

POST /api/adv/:id/click

UI ADV (minimo)
Sezione “Crea ADV” (per VIP/Creator)

Form titolo, testo, mediaUrl (opzionale)

Placement selector (profile/feed/pre_event)

Target interno (event/page) → targetUrl interno

Submit

Se ADV_PAYMENT_REQUIRED → popup conferma

Stato dopo invio: “In revisione (pending)”

Sezione “ADV del profilo” (visibile a tutti)

Legge da profile/active/:userId

Se null → niente blocco

Fine memo.