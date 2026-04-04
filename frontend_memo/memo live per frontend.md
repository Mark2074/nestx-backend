MEMO DEFINITIVO — LIVE (Frontend/API) — NestX
1) Pagine Live (UI)

Live → Eventi (NON-HOT): pagina Live Grid

Live → CAM (HOT): pagina Live Grid identica, ma con warning obbligatorio all’ingresso (localStorage only)

Nota: oggi nel backend non esiste ancora il filtro/flag HOT/NON_HOT nel model Event. Quindi le due pagine sono “concettualmente separate”, ma tecnicamente finché non aggiungi quel campo non puoi splittare le liste.

2) Warning CAM (HOT)

Modal bloccante al click su “CAM (HOT)”

Checkbox “Non mostrarmelo più su questo dispositivo”

Salvataggio solo localStorage (nessun backend)

Si mostra solo all’ingresso della sezione, non per ogni live

3) Endpoint Live “operativi” (contatori presenza)

Auth required.

POST /api/live/:eventId/join-room?scope=public|private

incrementa contatore spettatori (se first join)

forza scope=private se event.accessScope="private"

privata: se ticket richiesto e mancante → 403 TICKET_REQUIRED

POST /api/live/:eventId/leave-room?scope=public|private

decrementa contatore (atomico)

attenzione: qui NON forza private se event.accessScope=private → il frontend deve passare scope giusto.

GET /api/live/:eventId/status?scope=public|private

ritorna eventStatus, live, e privateSession solo se scope=private

liveRoom con currentViewersCount, peakViewersCount, ecc.

4) Live Grid = “listing + ricerca” (oggi via Live Search)

Auth required (perché applica regole privacy/blocchi).

Live Search (Eventi, non utenti)

GET /api/live/search

Query supportate

q (testo su: title, description, category)

status = live | scheduled | all (default all → live+scheduled)

profileType (target creator) = male|female|couple|gay|trans

area

language (solo VIP)

paginazione: page, limit (limit max 50)

Regole privacy/visibility (critiche)

visibility="unlisted" MAI in search

public sempre visibile

followers solo se io ho follow accepted verso quel creator

blocchi (entrambi i lati) esclusi

profili isPrivate=true esclusi se non li seguo accepted

i miei eventi: ok (public/followers), ma mai unlisted

Sorting

live prima

tra live: più recenti prima (live.startedAt / startedAt)

poi scheduled: più vicini prima (startTime / plannedStartTime)

Output

items eventi + creator minimale (displayName, avatar, accountType, isPrivate)

NB: nel $project vengono rimossi dai risultati: area, language, targetProfileType

👉 Implicazione frontend: i filtri li usi per cercare, ma poi non puoi “mostrare” area/lingua/profileType nella card live, perché non arrivano in response (scelta voluta).

5) “Seguiti online” (quick filter)

Da concept: filtro rapido che mostra solo live attive dei seguiti.

Stato backend attuale: non vedo endpoint dedicato qui dentro.
Soluzione pratica lato frontend (oggi): usare GET /api/live/search?status=live + applicare filtro “solo seguiti” solo se l’API espone un flag o se hai una lista seguiti.
Altrimenti serve endpoint ad hoc (non ancora presente nelle rotte che mi hai incollato).

6) Gap rispetto al concept LIVE definitivo (da segnare)

Manca campo obbligatorio HOT/NON_HOT su Event → senza quello non puoi separare davvero le pagine.

I filtri base/vip del concept parlano di single/coppia/gay/trans, ma liveSearch usa male/female/couple/gay/trans.
➜ va riallineato (o in UI fai mapping).

Leave-room scope mismatch (detto sopra) → frontend deve passare scope corretto sempre.

Memo Event Feed (API)

GET /api/events/feed (auth nel codice, quindi NON è veramente public)

Query:

filter=upcoming|live|past (default upcoming)

category

language solo se req.user.isVip === true

Esclude:

visibility="unlisted"

creator mutati (getMutedUserIds)

Sorting:

upcoming: startTime ASC + startTime >= now

live/past: startTime DESC

Output: lista di card già “frontend-ready” con creator{ id, displayName, avatar, accountType }

Nota secca (bug/contraddizione)

Nel commento c’è scritto Public (in v1) ma la rotta è auth → quindi è Private. O togli auth o correggi commento.