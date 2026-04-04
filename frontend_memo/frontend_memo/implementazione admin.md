MEMO DEFINITIVO — LIVE TIME vs TOKEN YIELD (KPI piattaforma)
1) Obiettivo

Misurare rapporto costo infrastruttura (tempo live) vs valore generato (token) per:

valutazioni interne (admin)

analytics creator (soft)

future policy (Phase 2+)

Non è una feature social pubblica.

2) Scelta architetturale

✅ Stats separati dal model User (niente campi “liveMinutes” dentro User).

Motivo:

evita “sensazione controllo” sul profilo

mantiene separazione contabile (wallet) vs KPI live

più facile evoluzione (rolling windows, grafici, segmentazioni)

3) Dati minimi da tracciare (Phase 1)
Entità: LiveUserStats (o CreatorStats)

Chiavi:

userId

windowDays (default 30)

windowStart, windowEnd (rolling)

updatedAt

Metriche:

liveMinutesTotal (somma minuti live in finestra)

liveSessionsCount (numero sessioni in finestra)

tokensReceivedFromLive (somma token ricevuti con contesto live)

(opzionale) tokensSpentOnLive (se serve in futuro; non necessario ora)

Derivato (calcolato runtime, NON salvato):

tokensPerHour = tokensReceivedFromLive / (liveMinutesTotal / 60)

4) Cosa conta come “token live”

Solo TokenTransaction con:

context in ["tip","donation","cam"]
(e se domani introduci ticket per cam, lo aggiungi esplicitamente)

⚠️ Non mescolare:

ADV

vetrina

ticket eventi

content unlock

5) Eventi backend da agganciare (Phase 1)
A) Tempo live

Su start live → apri sessione (server-side)
Su end live → calcoli durata e incrementi:

liveMinutesTotal += durationMinutes

liveSessionsCount += 1

Note:

durata calcolata server-side (timestamp), non fidarti del client

gestire crash: se manca “end”, chiusura forzata quando admin cancella/timeout (Phase 2 migliorabile)

B) Token ricevuti in live

Quando viene creata una TokenTransaction “credit” verso un user con contesto live:

tokensReceivedFromLive += amountTokens

6) UI/Visibilità (Phase 1)
Creator (soft analytics) — dove mostrarlo

✅ Profile → Manage (creator) (NON in Tokens)

Mostrare solo:

“Last 30 days”

Live time: Xh Ym

Tokens received from live: N

❌ Non mostrare:

tokens/hour

confronti

ranking

giudizi

Admin

✅ Admin dashboard (Phase 1/2 a scelta)
Mostrare anche:

tokens/hour

filtri “molte ore / pochi token”

lista outlier

7) Policy / Azioni

In Phase 1: solo tracciamento + display soft creator + display admin (se c’è)
Nessuna limitazione automatica, nessuna penalità, nessun blocco.

Le azioni (limiti, boost, ecc.) sono Phase 2+.

MEMO API (minimo)
Creator view

GET /api/stats/live/me?window=30

ritorna: liveMinutesTotal, liveSessionsCount, tokensReceivedFromLive, windowDays

Admin view (futuro)

GET /api/admin/stats/live?window=30&sort=tokensPerHour&minLiveMinutes=...

verificare permessi admin per tutte le sezioni del soacial

NestX Updates: (info sezione dx)

User: GET /updates → ritorna updates attive/non scadute (limit per DX + pagina completa per /updates).

Admin: CRUD minimo per pubblicare comunicazioni:

POST /admin/updates

GET /admin/updates

PATCH /admin/updates/:id (edit/archivia/expire)