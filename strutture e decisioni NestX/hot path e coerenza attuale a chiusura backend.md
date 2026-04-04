verifiche di allineamento e coerenza finale backend 

Auth: register/login ok, adultConsentAt gestito, tokenVersion per logout globale ok.

Auth middleware: ban hard + age gate hard con allowlist minima, admin bypass ok.

Admin: adminGuard standardizzato (hai tolto requireAdmin dove serviva) ok.

Routes mount: /api/* uniformato (posts/users/tokens) ok.

Old-Live: hai scelto il file corretto (oldLiveRoutes) e spostato l’altro tra i vecchi ok.

Search & LiveSearch: esclusione privati scalabile + indice su isPrivate ok.

Language: allineato al concept “non obbligatoria” (language può essere vuota) ok.

Event: model coerente (contentScope obbligatorio HOT/NON_HOT, accessScope public/private, profilePromoEnabled, privateSession, live meta) ok.

Tickets: model coerente (scope + roomId + unique index su eventId/userId/scope/roomId) ok.

EventRoutes: pulizia conflitti (rimosso start legacy), access/join/chat-toggle allineati, ticket purchase atomico su tokenBalance + rollback su errore save ticket ok.

Notifications (user): dedupeKey presente e usato dove serve (ticket purchased / event went live / cancel best-effort), schema Notification completo (isRead/readAt, dedupe unique) ok.

Admin notifications: queue unica su Notification (userId=null + isRead=false) + mark-read singolo ok; aggiunto filtro type opzionale + bulk mark-read ok.

Admin payout: lifecycle pending → approve/reject → mark-paid coerente con payoutRequest schema (reviewedByAdminId, note, timestamps, providerTransferId) ok.

AI moderation (static): Post.moderation.* presente (status/hiddenBy/reason/severity/category/ai flags) ok.

Internal service: internalServiceGuard ok (x-internal-key vs INTERNAL_SERVICE_KEY, 403/500 coerenti) ok.

Stripe/connect: non toccato qui (da riallineare dopo su User: creatorEligible/payoutEnabled/payoutStatus) da fare.

//----------------------------------------------------------------
NESTX — RIEPILOGO TOTALE VULNERABILITÀ / HOT PATH
AGGIORNATO — SOLO CIÒ CHE MANCA (FASE 1)

🟢 FASE 1 — MVP / PRE-LANCIO
👉 OBBLIGATORIO prima del lancio
👉 Bug qui = rischio reale (economico, sicurezza, UX)

1️⃣ Feed post / eventi (utente)

Stato: ❌ DA COMPLETARE

Resta da fare:
- verificare / applicare indici DB:
  - Post(createdAt)
  - Post(authorId, createdAt)
  - Post(visibility, createdAt)
  - Event(status, startTime, visibility, creatorId)
- confermare limit max obbligatorio su tutte le query feed
- verificare populate ridotti (no campi inutili)

2️⃣ Notifications (utente + admin)

Stato: ❌ DA COMPLETARE

Resta da fare:
- verificare / applicare indici DB:
  - Notification(userId, isRead, createdAt)
  - Notification(userId:null, isRead, createdAt)  // admin queue
- confermare sort + limit ovunque (no fetch full)
- badge unread basato su query indicizzata

3️⃣ Admin queue (reports / users / content)

Stato: ❌ DA COMPLETARE

Resta da fare:
- indici DB:
  - Report(status, createdAt)
  - AccountTrustRecord(tierScore, updatedAt)
  - User(isBanned, createdAt)
- paginazione obbligatoria su tutte le liste admin
- nessuna query “tutto insieme”

4️⃣ Ticket purchase /events/:id/ticket

Stato: ❌ DA VERIFICARE FINALE (CRITICO)

Resta da fare:
- confermare source of truth = Ticket collection
- unique index Ticket(eventId, userId, scope, roomId)
- addebito token atomico con $gte
- rollback token se ticket.save() fallisce
- loggare oversell (accettato v1)

5️⃣ Event go-live

Stato: ❌ DA VERIFICARE

Resta da fare:
- gate contentScope obbligatorio (public/private)
- roomId pubblico ≠ roomId privato
- LiveRoom upsert coerente (no duplicati)

6️⃣ Cancel + refund evento

Stato: ❌ DA VERIFICARE

Resta da fare:
- idempotenza dura su cancel/refund
- mai rimborsare se evento già cancelled
- TokenTransaction audit best-effort (no silent fail)

7️⃣ AI moderation + internalServiceGuard

Stato: ❌ DA VERIFICARE

Resta da fare:
- 403 pulito se INTERNAL_SERVICE_KEY errata
- fail-loud all’avvio in prod se INTERNAL_SERVICE_KEY mancante

8️⃣ ADV paid (quota free + paid)

Stato: ❌ DA HARDENARE

Resta da fare:
- quota free/paid atomica (no race)
- idempotenza create + approve
- pagamento token SOLO in approve admin
- indici Adv:
  - reviewStatus
  - isActive
  - placement
  - startsAt / endsAt

9️⃣ Vetrina paid (quota free + paid)

Stato: ❌ DA HARDENARE

Resta da fare:
- quota free/paid atomica (no race)
- idempotenza create + approve
- pagamento token SOLO in approve admin
- indici ShowcaseItem:
  - reviewStatus
  - isActive
  - startsAt / endsAt
