NestX — CONCEPT DEFINITIVO (HOME + SEARCH)
0) HOME

Home contiene solo un mini avatar.

Click mini avatar → Profile Me (/profile/me o route equivalente).

Nessun altro contenuto in Home.

1) SEARCH — OBIETTIVO GENERALE

La ricerca deve mostrare “tutto di tutti” tranne:

contenuti di utenti privati non seguiti

contenuti di utenti bloccati (io→loro o loro→me)

contenuti admin (admin non compare mai in users/posts/events)

per Eventi: non devono comparire finished/cancelled/old live nelle ricerche

2) SEARCH SOCIAL (unica rotta)
Endpoint

GET /api/search

Query params

q = testo libero

type = all | users | posts | events (default all)

page (default 1)

limit (default 10, max 50)

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

(Non esiste “VIP only”)

Visibilità EVENTS (Search Social)

status ammessi: solo live e scheduled

unlisted mai in search (nemmeno al creator)

public sempre

followers solo se follow accepted (io seguo il creator)

i miei eventi visibili a me solo se public|followers (mai unlisted)

Campi sensibili da NON esportare

Posts: non esportare area, language (select -area -language)

Events: non esportare area, language, targetProfileType (select -area -language -targetProfileType)

Users: ok campi base profilo (displayName, avatar, bio, profileType, isPrivate…), mai admin

3) LIVE SEARCH (solo eventi)
Endpoint

GET /api/live/search

Query params

q (optional)

status = live | scheduled | all (default all → live+scheduled)

filtri per tutti: profileType, area

filtro solo VIP: language

page, limit

Response
{
  "page": 1,
  "limit": 20,
  "total": 7,
  "items": [ ...events ]
}

Regole LIVE SEARCH

Stesse esclusioni Search Social: bloccati + privati non seguiti + admin escluso

Status: solo live e scheduled (mai finished/old/cancelled)

Visibility identica a Search Social events:

unlisted mai

public sempre

followers solo se follow accepted

“miei eventi” ok solo se public/followers (mai unlisted)

Sorting:

live prima (by startedAt desc)

poi scheduled (by startTime asc)

Output: non esportare area/language/targetProfileType

4) CONCETTO “UNLISTED”

unlisted = evento “da link”

Non deve essere trovabile in nessuna search (social o live), nemmeno dal creator

Il creator lo vede solo in GET /api/events/my-created (o equivalente)

Accesso da parte degli utenti solo via link diretto

5) VIP (regola definitiva)

VIP = boolean isVip === true

VIP non è accountType

Benefici VIP — definitivi (con “spinta VIP”)

Search Social (/api/search):

BASE: nessun filtro extra (solo q + type + paging)

VIP: filtri extra:

profileType

area

language

Live Search (/api/live/search):

BASE: filtri:

profileType

area

VIP: in più:

language (beneficio VIP su live = solo lingua)

6) UI/FRONTEND — STRUTTURA SCHERMATE
A) Search Social (pagina “Cerca”)

Search bar + tab: All | Users | Posts | Events

Tab “All” (definitivo):

3 blocchi separati:

Users

Posts

Events

Ogni blocco mostra solo preview (max 3)

Bottone/link “See all” su ogni blocco:

switcha alla tab corrispondente

rilancia query con type=users / posts / events

lì la lista è completa e paginata

Se un blocco è vuoto: nascosto

B) Live Search (pagina separata “Ricerca Live”)

Schermata separata dedicata agli eventi

Tabs status: Live | Scheduled | All

Mostra total

Paginazione standard su items

7) “VIP upsell” UI (obbligatorio)

Su Search Social i filtri (profileType/area/language) devono essere visibili anche ai Base ma:

disabled

badge/label “VIP”

click → tooltip/modal breve: “Upgrade to VIP to unlock filters”

8) App mounts (riferimento)

app.use("/api", searchRoutes); → /api/search

app.use("/api/live", liveSearchRoutes); → /api/live/search