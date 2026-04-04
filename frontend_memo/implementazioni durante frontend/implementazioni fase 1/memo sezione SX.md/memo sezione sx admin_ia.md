✅ MEMO DEFINITIVO — SEZIONE ADMIN + IA (NestX)

Stato: CONCEPT CHIUSO
Obiettivo: definire in modo completo cosa vede, cosa fa e come lavora l’admin, senza over-engineering.

1️⃣ ACCESSO ADMIN

Accesso tramite click su “NEST” (logo/titolo in alto)

Visibile solo a accountType = admin

L’admin non usa la UI normale con colonne sx/dx:

entra in una Admin Console dedicata

Possibilità dalla Dashboard di:

entrare nel Social in “Admin View” (UI normale + privilegi admin)

2️⃣ NAVIGAZIONE ADMIN (TOP TABS FISSI)

Tabs sempre visibili:

Dashboard

Inbox / Pending

Reports

Events

Refunds

New Users

Watchlist

Dizionario IA

Nessuna sidebar complessa, nessuna gerarchia nascosta.

3️⃣ DASHBOARD ADMIN
MVP

Solo bottoni rapidi, nessun contatore obbligatorio:

Inbox

Reports

Refund console

New users

Apri Social (Admin view)

Analytics (decisione finale)

NON implementati nel backend

Usiamo Umami Analytics (self-hosted) per:

Login page view

Register page view

Click “Registrati”

Click “Termini”

Sezione informativa

Analytics esterno, admin-only, zero backend NestX

Nessuna UI analytics dentro NestX

👉 Decisione: Umami Analytics definitivo

4️⃣ INBOX / PENDING

Fonte: GET /api/admin/notifications/pending

Coda unica per:

Reports

ADV pending

Vetrina pending

Verifiche profilo / totem

Azioni inline:

ADV / Vetrina → Approva / Rifiuta

Verifiche → Approva / Rifiuta (reject con motivo)

Reports → Apri dettaglio

👉 Nessun refund in Inbox (il refund nasce dai ticket).

5️⃣ REPORTS

Lista + filtri base

Dettaglio report con CTA:

Apri evento

Apri tickets evento

Apri utente

Dal report si innesca spesso il refund.

6️⃣ EVENT DETAIL (ADMIN) — CENTRALE

Percorso: /admin/events/:id

Tabs

Overview evento

Tickets (tab fondamentale)

Tickets tab

Tabella ticket:

userId (cliccabile)

status (active / refunded)

priceTokens

purchasedAt

refundedAt

Azioni per ticket:

Refund check

Esegui refund (solo se active)

contatori live/time per i creator (per verificare efficienza)

7️⃣ REFUND — LOGICA DEFINITIVA (NO AUTOMATISMI)
Endpoint usati (già esistenti)

GET /api/admin/refund-check/:ticketId

POST /api/admin/refund/:ticketId { note }

Refund check (drawer/modal)

Mostra:

Ticket (status, prezzo, date)

Evento (titolo, creator, tempi live)

Presenza live (joinedAt, leftAt, effectiveMinutes)

Transazione acquisto (se trovata)

Badge:

“Suggerimento: utente mai entrato” (solo informativo)

Esegui refund

Nota admin OBBLIGATORIA in UI

Modale di conferma

POST refund

Aggiornamento stato ticket + notifiche (già backend)

👉 Refund = azione manuale admin, sempre tracciata.

8️⃣ REFUND CONSOLE

Percorso: /admin/refunds

Campo ticketId

Carica refund-check

Possibilità di eseguire refund

Serve come strumento tecnico, non come coda.

9️⃣ ADMIN VIEW (SOCIAL NORMALE CON PRIVILEGI)

L’admin può entrare nella UI normale del social

Usa:

search profili già esistente (vede anche privati)

navigazione libera profili/eventi/post

In Admin View ha in più:

Segnala (admin)

Aggiungi a Watchlist

Aggiungi parola al Dizionario IA

🔟 NUOVI UTENTI

Percorso: /admin/new-users

Filtro temporale fisso:

7 / 15 / 30 giorni (max 30)

Default: 15 giorni

Lista:

avatar

username / displayName

createdAt

Profili cliccabili

Azioni:

Aggiungi a Watchlist

1️⃣1️⃣ WATCHLIST

Lista profili marcati manualmente dall’admin

Serve per:

controlli ripetuti nel tempo

Azioni:

rimuovi da watchlist

entra nel profilo (Admin view)

1️⃣2️⃣ DIZIONARIO IA — VERSIONE MINIMAL DEFINITIVA
Decisione chiave

👉 SOLO “Aggiungi parola”
Niente filtri, niente categorie, niente analytics.

UI

Input: parola / pattern

Bottone: Aggiungi al dizionario

Lista parole (solo visione, opzionale)

Possibilità di disattivare

Aggiunta parola

Dalla schermata Dizionario

Oppure ovunque in Admin View

Serve per:

hard-block search

flag IA su contenuti

Backend già pronto:

GET active

POST

PATCH

1️⃣3️⃣ FILOSOFIA GENERALE (VINCOLANTE)

❌ Nessun automatismo su soldi

❌ Nessun ban automatico

❌ Nessun refund automatico

❌ Nessuna analytics interna inutile

✅ Decisione umana

✅ Tracciamento totale

✅ IA = supporto, non giudice

✅ Admin libero di navigare e controllare

🔒 STATO FINALE

Admin + IA: CONCEPT CHIUSO

Refund: COERENTE, GIÀ IMPLEMENTATO

Dizionario IA: SEMPLIFICATO E OPERATIVO

Analytics: UMAMI — definitivo

Nessuna integrazione backend obbligatoria per questa sezione

🔧 Integrazioni backend EVENTUALI (NON OBBLIGATORIE ORA)

Solo se/quando vorrai:

endpoint “new users last X days” (se non già esistente)

endpoint watchlist (persistenza)

endpoint admin stats (contatori stato piattaforma)

👉 Non bloccanti.

MEMO DEFINITIVO — AI STACK (FASE 1) — NestX
0) Principio

L’IA non banna, non chiude live, non gestisce soldi.

Auto-hide consentito solo per GRAVISSIMO (illegalità). Tutto il resto = flag/alert per admin.

1) IMMAGINI — Provider: AWS Rekognition

Uso: moderazione immagini per: avatar, cover, media post, media ADV (e in futuro vetrina).
API: DetectModerationLabels (immagini)
Output: labels + confidence → mapping a regole NestX.

Regola Fase 1 (secca)

Se Rekognition produce segnali compatibili con GRAVISSIMO secondo policy interna NestX → AUTO-HIDE del post/media (o contenuto collegato).

Altrimenti → NO auto-hide, solo flag interno (anche solo log) per review.

Nota: Rekognition è un classificatore “moderation labels” con confidenza; tu applichi regole tue sui labels .

2) TESTO — Baseline: Dizionario Admin + Opzionale: OpenAI Moderation
2A) Dizionario (Hard rules)

Fonte: adminDictionaryRoutes (già in backend).

Il dizionario serve per: bio, titoli/descrizioni eventi, testi ADV, commenti, chat live (messaggi singoli), search.

Se match su pattern proibiti → blocca / nega (es. ricerca proibita) o flagga (testi).

2B) OpenAI Moderation (Soft classifier consigliato)

Uso: classificazione “potenzialmente harmful” su testo (e volendo immagini, ma in Fase 1 immagini le facciamo con AWS).
Endpoint: Moderations, modello consigliato omni-moderation-latest
Nota privacy API: i dati inviati via API non vengono usati per training salvo opt-in

Regola Fase 1 (secca)

Dizionario = hard gate (se scatta, è legge).

OpenAI moderation = secondo parere:

se segnala rischio alto ma non è GRAVISSIMO certo → flag, non hide.

auto-hide resta solo GRAVISSIMO secondo regole NestX.

3) AZIONI AUTOMATICHE CONSENTITE (FASE 1)
Auto-hide (solo GRAVISSIMO)

L’IA (servizio interno) chiama:

POST /moderation/posts/:id/hide (internalServiceGuard)

POST /moderation/posts/:id/unhide solo rollback raro
(Rotte già esistenti)

Tutto il resto

NO auto-hide

Solo: flag/alert (log interno o coda admin futura)

4) “PROPOSTA IA + VOTO ADMIN” (MISURAZIONE) — RIMANDATA A FASE 2

In Fase 1 non introduciamo il modello “case + score”.

In Fase 2 aggiungeremo:

queue di casi IA

resolve + adminScore

metriche (accuracy/false positive/recidiva)

5) Messaggi UI (tutto in inglese)

Search proibita: messaggio duro e dissuasivo (come già nel concept) in English.

Errori/flag non devono mostrare dettagli “tecnici IA” all’utente: solo “This content is under review”.

Checklist variabili env (minima)

INTERNAL_SERVICE_KEY (già usata dalle rotte IA)

AWS: credenziali + regione (Rekognition)

OpenAI (se attiviamo moderation): OPENAI_API_KEY

B) worker separato su Render (più pulito) deciso