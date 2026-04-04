MEMO — SEZIONE CERCA (NestX)
Obiettivo generale

La ricerca deve mostrare tutto di tutti tranne:

contenuti di utenti privati non seguiti

contenuti di utenti bloccati (io→loro o loro→me)

contenuti admin (admin non deve comparire in risultati users/posts/events)

per Eventi: finito/cancelled/old live NON devono comparire nelle ricerche

1) SEARCH SOCIAL (unica rotta)

Endpoint

GET /api/search

Query params

q = testo libero (ricerca in displayName/bio per users, text/tags per posts, title/description/category per events)

type = all | users | posts | events (default all)

page (default 1)

limit (default 10, max 50)

Filtri extra solo VIP:

profileType (genere enum)

area (string)

language (string)

Response

{
  "page": 1,
  "limit": 10,
  "users": [],
  "posts": [],
  "events": []
}

Regole di esclusione (Search Social)

ExcludedUserIds = unione di:

bloccati (both directions) via getBlockedUserIds(meId)

utenti privati NON seguiti (follow accepted)

admin escluso sempre (accountType === "admin")

Visibilità POSTS (Search Social)

public sempre

followers solo se follow accepted (io seguo l’autore)

i miei post sempre visibili a me

(Non esiste “VIP only”: rimosso come concetto)

Visibilità EVENTS (Search Social)

Status ammessi: solo live e scheduled

unlisted mai in search (nemmeno al creator)

public sempre

followers solo se follow accepted (io seguo il creator)

i miei eventi visibili a me solo se public|followers (mai unlisted)

Campi “sensibili” da NON esportare

per Posts: area, language non devono comparire nei risultati (select -area -language)

per Events: area, language, targetProfileType non devono comparire (select -area -language -targetProfileType)

Users: possono uscire i campi base profilo (displayName, avatar, bio, profileType, isPrivate…) ma mai admin

2) LIVE SEARCH (solo eventi)

Endpoint

GET /api/live/search

Query params

q (optional)

status = live | scheduled | all (default all → live+scheduled)

filtri per tutti:

profileType (enum: male,female,couple,gay,trans)

area (string)

filtro solo VIP:

language (string)

page, limit

Response

{
  "page": 1,
  "limit": 20,
  "total": 7,
  "items": [ ...events ]
}

Regole LIVE SEARCH

Stesse esclusioni Search Social: bloccati + privati non seguiti

Status: solo live e scheduled (mai finished/old)

Visibility identica a Search Social events:

unlisted mai

public sempre

followers solo se follow accepted

“miei eventi” ok solo se public/followers

Sorting:

live prima

poi scheduled

e ordinamento coerente (live by startedAt desc, scheduled by startTime asc)

Output: non esportare area/language/targetProfileType

3) Concetto “UNLISTED”

unlisted = evento “da link”

Non deve essere trovabile da nessuno in search (social o live), nemmeno dal creator

Il creator lo vede solo in:

GET /api/events/my-created (o equivalente MyCreated)

Chi entra lo fa solo via link diretto (non da cerca)

4) VIP (regola definitiva)

VIP è status booleano: isVip === true

NON è accountType (accountType resta base/creator/admin ecc.)

Filtri extra VIP:

Social search: profileType + area + language

Live search: solo language, mentre profileType + area sono per tutti

5) App mounts (per riferimento frontend)

app.use("/api", searchRoutes); → /api/search

app.use("/api/live", liveSearchRoutes); → /api/live/search

Note operative frontend (per quando lo fai)

Se type=all: UI mostra 3 sezioni (Users / Posts / Events) anche se vuote (o le nascondi se vuote, scelta UI).

Live Search è una schermata separata (“Ricerca Live”) che mostra solo eventi, con contatore total e paginazione.

I parametri di filtro vanno in query string, non body.

Esempio:
/api/search?q=unicorno&type=all&page=1&limit=20
/api/live/search?status=live&q=xxx&page=1&limit=20