CONCEPT DEFINITIVO — USER NOTIFICATIONS (Fase 1)
1) Ruolo della sezione Notifications

La sezione Notifications è:

Inbox personale dell’utente

solo eventi che riguardano direttamente l’utente

niente moderazione

niente pending admin

niente rumore

È uno strumento passivo, non una chat, non un feed.

2) Accesso dalla colonna SX

Voce SX:

Notifications

badge numerico = notificationsUnreadCount

Click → pagina dedicata /notifications

3) Struttura pagina Notifications
Layout

Colonna centrale

Lista verticale

Nessuna colonna DX dedicata

UX semplice, stile inbox

Stati

Lista con notifiche

Empty state (spiegativo)

Loading skeleton

4) Tipologie di notifiche UTENTE (type)

Solo notifiche user-facing, generate dal backend Notification con userId = me.

Social

tag utente nei post

FOLLOW_REQUEST_RECEIVED

FOLLOW_REQUEST_ACCEPTED

NEW_FOLLOWER

Interazioni contenuti

POST_LIKED

POST_COMMENTED

EVENT_INTERESTED

EVENT_REMINDER (scheduled)

Live / Event

EVENT_STARTING_SOON

EVENT_CANCELLED

EVENT_UPDATED

Account / sistema

PROFILE_VERIFICATION_APPROVED

PROFILE_VERIFICATION_REJECTED

TOTEM_VERIFICATION_APPROVED

TOTEM_VERIFICATION_REJECTED

SECURITY_ALERT (login, reset password, ecc.)

❌ Esclusi:

ADV pending

Vetrina pending

Report

Qualsiasi notifica admin

5) Card notifica — struttura UI

Ogni notifica è una card compatta, cliccabile.

Elementi:

Icona (per categoria)

Testo (message)

Timestamp relativo (“2h ago”)

Stato letto/non letto (bold o dot)

Click behavior:

Naviga al target (profile / post / event / settings)

Marca isRead = true

6) CTA per tipo (minimali)
Tipo	Azione
Follow request	Accetta o rimane pendente (rifiuta no, per evitare che si facciano guerra)
Like / comment	Click → post
Event reminder	Click → evento
Verifica rifiutata	Click → Verification
Security alert	Click → Settings

Nessuna CTA complessa.
Niente modali pesanti in Fase 1 (tranne reject follow se già previsto).

7) Gestione “letto”

Apertura notifica → PATCH /api/notifications/:id/read

Possibile CTA futura: “Segna tutte come lette” (non obbligatoria ora)

Backend source of truth:

isRead

readAt

Badge SX:

basato solo su isRead:false

8) Empty state (importante)

Quando non ci sono notifiche:

No notifications yet
Here you’ll see updates about your profile, followers, events and activity.

Serve a educare, non solo a riempire.

9) Regole chiave (vincolanti)

Le notifiche non sono feed

Non sono ordinate per priorità, solo createdAt desc

Nessuna distinzione “Importanti / Altro” in Fase 1

Nessuna notifica duplicata (backend dedupe)

Nessuna notifica admin visibile agli utenti

10) Coerenza con SX (check)

📌 Integrazione MEMO — User Notifications (aggiunta)

Tag utenti nei post (Profile.me):

È possibile taggare utenti:

solo se li seguiamo oppure sono nostri follower

Niente autocomposizione

Niente click sul tag

Nessuna UI complessa

Effetto unico: invio notifica all’utente taggato

Notifica generata:

Tipo: POST_MENTIONED

Target: post

Comportamento:

appare nella User Notifications

click → apre il post

segue le stesse regole di lettura (isRead, badge SX)

Questo è coerente con:

filosofia “notifiche passive”

semplicità Fase 1

separazione netta tra feed / interazioni / chat

✅ Memo aggiornato anche lato Notifiche
✅ Chat ordinata
✅ Nessuna modifica extra richiesta

✔ SX legge solo notificationsUnreadCount
✔ Nessuna logica extra in sidebar
✔ Tutto il dettaglio vive in /notifications