MEMO FRONTEND — NOTIFICHE (NestX)
1) Dove compaiono

Sezione Social → Notifiche: usa solo le notifiche del model Notification.

Sezione Messaggi: NON usa Notification per il “nuovo messaggio”.

Il badge “numerino” messaggi è calcolato da Message.readAt (endpoint dedicato).

2) API Notifiche (backend già pronto)
Lista notifiche (paginata)

GET /api/notifications
Query:

limit=20 (max 50)

cursor=<ISO createdAt> (paginazione: prendi l’ultimo elemento ricevuto e rimandalo come cursor)

unreadOnly=1 (solo non lette)

Risposta:

items[] ordinati per createdAt desc

nextCursor = createdAt dell’ultimo item (ISO) oppure null

Badge non lette (notifiche social)

GET /api/notifications/unread-count

restituisce quante notifiche hanno isRead=false

Segna come letta una notifica

PATCH /api/notifications/:id/read

Segna tutte come lette

PATCH /api/notifications/read-all

Cancella notifica

DELETE /api/notifications/:id

policy: se isPersistent=true NON si cancella (backend deve rifiutare o ignorare)

3) Tipi di notifica usati (minimo v1)

Notification.type include (già definiti):

SOCIAL:

SOCIAL_FOLLOW_REQUEST

SOCIAL_FOLLOW_ACCEPTED

SOCIAL_FOLLOW_REJECTED

SOCIAL_NEW_FOLLOWER

SOCIAL_POST_LIKED

SOCIAL_POST_COMMENTED

EVENTI:

EVENT_WENT_LIVE

EVENT_CANCELLED

EVENT_FINISHED NON usata (decisione: non serve)

TOKEN / PAGAMENTI:

TOKEN_RECEIVED

TICKET_PURCHASED

TICKET_REFUNDED

SYSTEM (già pronti, non obbligatori ora):

SYSTEM_VERIFICATION_APPROVED

SYSTEM_VERIFICATION_REJECTED

SYSTEM_VIP_CHANGED

4) Regole chiave (decisioni definitive)
A) Eventi

EVENT_WENT_LIVE: esiste e funziona (già testata).

Al momento la logica è stata testata con ticket acquistato → poi GoLive → notifica arriva.

EVENT_CANCELLED: notifica inviata solo a chi ha ticket (ticket holders).

Implementata in cancel con dedupe e “best-effort”.

Se non ci sono ticket, niente notifica utenti (coerente: nessuno da avvisare).

EVENT_FINISHED: NO notifica (chi era dentro lo sa, chi l’ha persa è tardi).

B) Notifiche follower su GoLive / eventi

NON si fa adesso.

Motivo: non è una vera notifica “una tantum”, deve diventare UI “live now” persistente nella sezione Live (lista utenti seguiti in live).

Quindi: rimandata alla sezione Live, non dentro notifiche social.

C) Dedupe + Best-effort

Le notifiche evento/ticket usano dedupeKey e updateOne/upsert o bulkWrite.

Se falliscono, non devono bloccare l’azione principale (acquisto ticket, cancel, etc.).

5) UX Frontend: cosa succede quando clicco una notifica

Usa Notification.targetType + targetId per navigare:

targetType="event" → apri pagina evento /event/:id

targetType="ticket" → apri dettaglio evento del ticket (o pagina ticket se esiste, altrimenti evento)

targetType="post" → apri post /post/:id

targetType="user" → apri profilo /profile/:id

Quando l’utente apre la notifica o la lista:

Opzione base: su tap notifica → chiama PATCH /api/notifications/:id/read e poi naviga.

6) Messaggi: badge “nuovo messaggio” (fuori dalle Notifiche)

La campanella/Notifiche NON deve mostrare i messaggi.

Il badge messaggi è calcolato così:

unread = count di Message dove:

recipientId = me

readAt = null

deletedForEveryoneAt = null

Endpoint previsto: GET /api/messages/unread-count

Apertura conversazione (GET /api/messages/conversation/:otherUserId) marca come letti i messaggi ricevuti da quell’utente (updateMany con readAt=now).

7) Cosa è “persistente” vs “non persistente”

isPersistent=true: notifiche importanti (token/pagamenti) non cancellabili

isPersistent=false: social / eventi → cancellabili