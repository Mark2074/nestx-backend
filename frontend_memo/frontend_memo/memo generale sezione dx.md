MEMO DEFINITIVO — COLONNA DX (NestX / User mode)
0) Ruolo

Colonna DX = spazio piattaforma (discovery + promozioni + comunicazioni ufficiali).
Non è spazio “personale”, non sostituisce feed/DM/notifiche.

1) Struttura (ordine dall’alto verso il basso)

FED — Suggested posts

ADV interni — Promoted

Vetrina — Showcase

NestX Updates — News piattaforma

2) Preview visibile (scroll interno per ogni blocco)

FED: preview (numero libero, ma tipicamente 2–4), poi “View all” se serve (opzionale).

ADV: 5 card in preview (scroll interno).

Vetrina: 5 card in preview (scroll interno).

Updates: 1 item in preview (scroll interno / oppure singolo con “next”).

✅ Niente filtri su ADV e Vetrina (per ora).
✅ Ogni blocco può avere “View all” → apre pagina centrale dedicata (senza filtri).

3) Regole chiave

Block/mute/privacy applicati sempre (nessun bypass DX).

ADV interni non spegnibili: niente toggle “off”.
ContentContext influenza solo priorità/presenza, non garantisce rimozione totale.

Updates: comunicazioni ufficiali (sviluppo, manutenzioni, policy, messaggi generali).

Admin mode: layout separato → niente colonna DX.

4) Empty states

FED vuoto: messaggio breve (“No suggestions yet…”).

ADV/Vetrina vuoti: blocco nascosto o messaggio “No promotions right now / Showcase is coming soon”.

Updates vuoto: blocco nascosto (oppure “All good.”, ma meglio nasconderlo).

MEMO DEFINITIVO — SEZIONE DX
Empty state ADV (DV) e Vetrina
1️⃣ ADV / DV — Empty state (SOLO INFORMATIVO)
Stato

Lista ADV vuota

Nessuna azione cliccabile

Nessun collegamento a Rules

Nessun collegamento a creazione ADV

Motivazione (nota tecnica, non UI)

ADV non è creabile da qui.
La creazione avviene solo nel flusso di creazione Live (step 2).

Testo UI (inglese – definitivo)

Title

Promote your Live with ADV cards

Body text

ADV cards help increase visibility for your Live events.

ADV creation is available during Live setup. When you create a Live, you’ll be guided through the ADV step if you’re eligible.

Footer / hint (opzionale, una riga più piccola)

Some ADV may require VIP status or token payment.

Comportamento UI

Nessun bottone

Nessun hover

Nessun click

Solo testo statico

Card visiva “empty state”

2️⃣ VETRINA — Empty state (INFORMATIVO + AZIONE)
Stato

Lista vetrina vuota

Oggetto autonomo

CTA consentita

Testo UI (inglese – definitivo)

Title

Showcase your creations

Body text

Publish your handmade items, custom projects, or original creations.

The Showcase is a curated space reserved for VIP users and all items are reviewed before publication.

CTA (condizionale)
Caso utente VIP

Primary button

Create showcase item

Azione

Apre flusso creazione vetrina

Caso utente NON VIP

Primary button (enabled)

VIP required to publish

Azione

Porta alla pagina “Go VIP” / benefits VIP (quella già definita)

Note UI

Nessun link a Rules

Nessun testo legale aggiuntivo

Review/admin implied ma non dettagliata

3️⃣ Regole generali DX (da annotare nel memo)

Empty state mostrato solo se lista vuota

Se lista NON vuota:

empty state non visibile

ADV:

mai cliccabile

mai entry point di creazione

Vetrina:

unico entry point diretto per creazione item

Rules:

nessun richiamo esplicito in Fase 1

4️⃣ Stato decisione

✔️ Testi approvati
✔️ Comportamenti approvati
✔️ Pronti per implementazione frontend