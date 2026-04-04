QUADRO ECONOMICO E VALUTAZIONE STRUTTURA
NestX — Documento definitivo (Fase 1 + Roadmap evolutiva)
1. Obiettivo del documento

Questo documento definisce:

la struttura infrastrutturale iniziale di NestX

i costi tecnici mensili stimati

le motivazioni economiche e strategiche delle scelte

la roadmap di evoluzione dell’infrastruttura (Fase 1 → Fase 2)

le condizioni oggettive che giustificano un cambio di assetto

L’obiettivo è ridurre rischi, costi indiretti e complessità, mantenendo libertà di crescita futura senza re-ingegnerizzazione.

2. Scelta architetturale di base
Decisione presa

👉 Soluzione A — Infrastruttura Managed

Motivazione principale:

differenza di costo minima rispetto a soluzioni self-hosted

drastica riduzione del carico operativo

maggiore affidabilità in fase di lancio

time-to-market più rapido

3. Assetto infrastrutturale (Fase 1)
Componenti scelti

Frontend: Vercel

Backend API: Render (servizio a pagamento, non free tier)

Database: MongoDB Atlas

Storage media (avatar, cover, video): Cloudflare R2 (S3-compatible)

Email transazionali: Postmark o Mailgun

Domini:

nestx.com → frontend

api.nestx.com → backend

4. Valutazione economica — Costi mensili stimati (Fase 1)
Voce	Costo stimato
Backend API (Render)	~10 €
Database (MongoDB Atlas)	~10 €
Frontend (Vercel)	0 €
Storage media (Cloudflare R2)	0–2 €
Email transazionali	~10 €
Dominio	~1 €
Totale stimato	~30–35 € / mese
Considerazioni economiche

differenza rispetto a VPS tradizionale: ~5 € / mese

costi indiretti (tempo, manutenzione, rischio) fortemente ridotti

struttura sostenibile anche in assenza di entrate iniziali

5. Motivazione scelta backend: Render (vs Railway)

Render è stato scelto come backend managed per:

Supporto dichiarato al real-time / WebSocket, coerente con:

chat

notifiche

evoluzione verso live e presence

Maggiore prevedibilità dei costi

minore esposizione a costi variabili non controllati

Riduzione del rischio operativo

gestione SSL

restart

proxy

scaling base automatico

Railway rimane un’alternativa valida, ma meno allineata alle esigenze real-time di NestX nel medio periodo.

6. Vincoli tecnici fissati (per evitare problemi futuri)

Le seguenti regole sono vincolanti:

Tutti gli URL pubblici devono derivare da variabili d’ambiente:

APP_PUBLIC_BASE_URL

FRONTEND_BASE_URL

È vietata in produzione la costruzione di URL dinamici basati su:

req.get("host")

req.protocol

I media non devono risiedere sul filesystem del backend in produzione.

SMTP Gmail escluso:

usare provider email dedicato.

In produzione:

MAIL_DISABLE vietato

SMTP obbligatorio

errori email = fail-loud.

Rate-limit obbligatorio su:

reset password

verifica email

7. Roadmap infrastrutturale
🔹 FASE 1 — Lancio e validazione

Stato attuale

Obiettivi:

validazione prodotto

crescita iniziale utenti

avvio monetizzazione

costi contenuti

Indicatori di permanenza in Fase 1:

utenti attivi < 5–10k

carico API gestibile

live simultanee limitate

costi < ~100 €/mese

👉 In questa fase non conviene cambiare assetto.

🔹 FASE 2 — Crescita controllata (cambio assetto)

Il cambio assetto è giustificato solo se almeno uno dei seguenti trigger si verifica:

carico real-time elevato (chat/live/presence)

costi backend > 150–200 €/mese

necessità di maggiore controllo e isolamento dei servizi

Assetto Fase 2 (target)

backend su VPS o cluster dedicato

separazione servizi (API / real-time / live)

introduzione eventuale di Redis o message broker

Database, storage e frontend restano invariati.

8. Impatto sulla programmazione

Il passaggio Fase 1 → Fase 2 non comporta riscrittura del codice, perché:

backend progettato stateless

storage esterno

URL parametrizzati via env

API già isolate come servizio

Il cambio è operativo, non architetturale.

9. Conclusione finale

La struttura scelta:

è economicamente sostenibile

riduce drasticamente il rischio iniziale

non crea debito tecnico strutturale

mantiene piena libertà evolutiva

NestX parte con un assetto semplice, solido e reversibile, rinviando ogni aumento di complessità solo quando giustificato dalla crescita reale del progetto


MEMO OPERATIVO — Backend “SFU Daily” (CAM HOT) senza sorprese
0) Decisioni vincolanti

CAM (HOT) = SFU-only (sempre Daily).

Niente P2P in produzione per CAM (solo test eventuali).

Backend è orchestratore unico: il client non decide mai modalità, accesso, ticket, blocchi.

1) Concetti base (oggetti e responsabilità)
1.1 Room = entità “live session”

Una CAM live deve avere un’entità unica (LiveRoom / LiveSession) che contiene:

status: scheduled | live | ended

context: HOT_CAM (o simile) / NON_HOT

provider: "daily"

topology: "sfu" (sempre per HOT)

dailyRoomName (o dailyRoomId)

dailyRoomUrl (opzionale, spesso derivabile)

startedAt, endedAt

hostUserId

viewerCountLive (contatore operativo, best-effort)

capacity + ticketPriceTokens (solo per private ticketed rooms)

visibility: public/private/unlisted (coerente col concept)

flags: isLocked, isPrivateSession, ecc.

Regola: una CAM “live ora” deve sempre mappare a una Daily room.

1.2 Backend come “Room Orchestrator”

Il backend fa 4 cose, sempre in quest’ordine:

Autorizzazione (auth + age gate + ban + blocchi reciproci)

Policy economica (ticket/privata/capienza)

Provisioning provider (crea/riusa room Daily)

Emissione credenziali (token/join config per quel singolo utente)

Il client riceve solo un payload “joinConfig” e si connette.

2) Feature flag e configurazione (zero sorprese prod)
2.1 Env obbligatorie

DAILY_API_KEY (server-side only)

DAILY_DOMAIN / base (se serve)

SFU_PROVIDER=daily

LIVE_HOT_MODE=sfu_only (o equivalente)

2.2 Fail-loud

Se DAILY_API_KEY manca in produzione:

il backend deve fallire sulle rotte live join/create (non degradare in P2P).

log chiaro + errore esplicito.

3) API minime da avere (contratto stabile)
3.1 Create / Start live (host)

POST /api/live/:id/start

valida: host, age gate, policy HOT selected, eventuali regole account

crea record LiveRoom status=live se non esiste

provisioning: crea (o riusa) Daily room

ritorna: hostJoinConfig

3.2 Join live (viewer o host)

POST /api/live/:id/join

valida in ordine:

auth + age gate + ban

blocchi reciproci (host<->viewer)

se private/ticket: ticket valido + capienza

status live (o scheduled se consentito pre-join)

provisioning: assicura Daily room esista

emette joinConfig per quel viewer

3.3 Stop live (host)

POST /api/live/:id/stop

set endedAt, status=ended

(opzionale) chiudi room Daily o lasciala scadere (policy)

4) Token/ticket gating (ordine decisionale)
4.1 Pubblica HOT CAM (free)

join consentito a tutti i maggiorenni non bloccati

chat write: come da policy token/VIP (separato dal join)

4.2 Private HOT CAM (ticketed)

join consentito solo se:

ticket pagato (TokenTransaction + Ticket record)

capienza disponibile

non bloccati

Nota: il join non deve mai fare “tentativi” sul provider se non hai passato gating.

5) Provider integration (Daily) — cosa implementare davvero
5.1 Daily room lifecycle

Decisione: room per live session (non riuso infinito).

create room all’avvio (o al primo join se vuoi lazy)

salva dailyRoomName

TTL/expiry per cleanup (se Daily lo supporta) o cleanup via job

5.2 Token per join

backend genera token per:

host (permessi più alti)

viewer (permessi ridotti)

token short-lived se possibile (sicurezza)

5.3 Politiche room coerenti con CAM

SFU-only

limiti ragionevoli su recording/evidenze (se non usi recording)

no link esterni nel payload, solo config necessaria

6) Protezioni anti-abuse specifiche LIVE (primi mesi)
6.1 Rate limit

join rate-limit per user/IP (anti-bot join)

start/stop rate-limit host (anti spam)

6.2 Audit log minimo

Ogni evento deve lasciare traccia interna:

LIVE_STARTED, LIVE_JOINED, LIVE_LEFT (best-effort), LIVE_STOPPED

serve per dispute/refund/abusi

7) Contatori spettatori (best-effort, non mission-critical)

Non basarti su contatore perfetto per logiche economiche.

puoi tenere un contatore “soft” in DB

se vuoi precisione, la ottieni via provider webhook/events (fase successiva)

8) Webhook/eventi provider (non obbligatorio al day-1, ma previsto)

Prevedi già lo spazio per:

webhook Daily “participant joined/left”

update viewerCountLive, peak, durata, ecc.

alimenta Old-Live performance

Ma: day-1 puoi vivere anche senza, se non ti serve billing interno preciso.

9) Error handling “senza figura di m***”

Regole di risposta:

se join fallisce: messaggio chiaro (“live non disponibile”, “ticket richiesto”, “capienza piena”, “accesso negato”)

se provider down: fallback UI “problema tecnico live, riprova” + log

niente stati zombie: se start fallisce a metà, rollback status

10) Coerenza con Soluzione A (confermato)

Tutto quanto sopra è coerente con:

Render backend stateless

Atlas come fonte di verità (LiveRoom/Ticket/TokenTransaction)

R2 per media statici (non live)

Postmark/Mailgun separati (non c’entrano col live se non notifiche)

URL base da env, niente host dinamici

✅ POLICY LIVE — Hard Cap Early Stage (HOT CAM)

Obiettivo: prevenire esplosioni di costo SFU e instabilità nei primi mesi.

HOT CAM (SFU Daily)

HOT_CAM_SFU_ALWAYS = true

HOT_CAM_MAX_PARTICIPANTS_EARLY = 200 (configurabile)

EARLY_STAGE_DURATION = 90 days

Regola backend (JOIN):

se participantsCount >= HOT_CAM_MAX_PARTICIPANTS_EARLY → blocca join con ROOM_FULL

UI mostra: “Room piena (sold out). Riprova tra poco.”

(opzionale futuro): waiting-room o mirror-room

Note:

Hard cap attivo solo in early stage (primi 90 giorni).

Dopo early stage: cap aumentabile o disattivabile in base a metriche reali.