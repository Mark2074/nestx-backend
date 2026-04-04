MEMO FRONTEND — Admin Notifications (Inbox Pending)
Obiettivo UI

Schermata admin unica “Inbox / Pending” che mostra tutte le cose da moderare come coda unica.

Le notifiche admin non vanno agli utenti.

Sono record in Notification con:

userId: null

isRead: false

type: ADMIN_*_PENDING

dedupeKey per evitare duplicati

Quando l’admin risolve (approve/reject/actioned/reviewed/dismissed) → quella notifica sparisce (viene marcata isRead:true oppure cancellata in alcuni casi).

Endpoint da usare (definitivi)
1) Lista pending (inbox)

GET /api/admin/notifications/pending
Filtri backend:

userId: null

isRead: false
Sort:

createdAt desc
Limit:

100

UI:

lista con card/righe

mostra: type, message, createdAt, e piccoli badge (ADV/Vetrina/Verifica/Report)

2) Mark as read manuale (optional UI)

PATCH /api/admin/notifications/:id/read
Set:

isRead:true (+ readAt se esiste)

Uso UI: tasto “Segna come letto / Ignora”.

Tipologie (type) gestite nella Inbox
ADV pending

type: "ADMIN_ADV_PENDING"

targetId: advId
Azioni UI (usano le rotte admin adv):

Approva → PATCH /api/admin/adv/:id/approve

Rifiuta → PATCH /api/admin/adv/:id/reject

Effetto: dopo approve/reject la notifica pending sparisce.

Vetrina pending

type: "ADMIN_VETRINA_PENDING"

targetId: itemId
Azioni UI:

Approva → PATCH /api/admin/showcase/:id/approve

Rifiuta → PATCH /api/admin/showcase/:id/reject

Effetto: sparisce dalla pending.

Verifica profilo pending

type: "ADMIN_PROFILE_VERIFICATION_PENDING"

targetId: userId
Azioni UI:

Approva → PATCH /api/admin/verifications/:userId/profile/approve

Rifiuta → PATCH /api/admin/verifications/:userId/profile/reject (body: { reason })

Effetto: sparisce dalla pending (in backend viene pulita).

Verifica totem pending

type: "ADMIN_TOTEM_VERIFICATION_PENDING"

targetId: userId
Azioni UI:

Approva → PATCH /api/admin/verifications/:userId/totem/approve

Rifiuta → PATCH /api/admin/verifications/:userId/totem/reject (body: { reason })

Effetto: sparisce dalla pending.

Report pending

type: "ADMIN_REPORT_PENDING"

targetId: reportId
Azioni UI (rotte report):

Aggiorna status → PATCH /api/admin/reports/:id

dismissed / reviewed (non richiede severity)

actioned richiede severity: "grave" | "gravissimo"

opzionale: category, adminNote

Effetto: sparisce dalla pending quando status != pending (backend chiude la notifica).

Visualizzazione consigliata (UX semplice)

Per ogni item in lista:

Icona per categoria (ADV / Vetrina / Profile Verif / Totem / Report)

Testo da message

Data/ora

CTA contestuali:

ADV/Vetrina: Approva / Rifiuta

Verifiche: Approva / Rifiuta (con modale motivo solo per reject)

Report: dropdown status + (se actioned) select gravità + categoria + note + salva

Note pratiche

La Inbox è “source of truth” per pending: quando fai un’azione, dopo risposta OK → refresh lista.

Le vecchie liste separate (/admin/adv/pending, /admin/showcase/pending, /admin/reports, /admin/verifications) restano utili come schermate dedicate, ma per l’MVP basta Inbox.