1) CONCEPT GENERALE (CHIUSO)

La sezione Live è una vetrina globale accessibile dal menu SX, visualizzata nella colonna centrale, con SX e DX invariati.

La Live non è:

feed social

profilo

storico (Old-Live)

Serve a:

scoprire live ed eventi

entrare in live

monetizzare tramite ticket, tip e private

2) SUDDIVISIONE CONTENUTI
2.1 Tipologie

CAM (HOT)
Contenuti a sfondo sessuale.

possono essere:

public/free

private/ticket

public → private durante la live

EVENTS (NON-HOT)
Contenuti non sessuali.

sempre ticket

mai free

2.2 HOT / NON-HOT

NON è un filtro

È una separazione strutturale

Due ingressi distinti:

Live → Events

Live → CAM

Accesso CAM protetto da warning obbligatorio (una volta per device, localStorage)

3) STRUTTURA PAGINA LIVE
3.1 Layout

Colonna SX: menu (immutata)

Colonna DX: ADV / Vetrina (immutata)

Colonna centrale: Live Grid

3.2 Live Grid

Mostra card evento/live con:

cover

titolo

creator (avatar + displayName)

stato: LIVE NOW / SCHEDULED

prezzo:

EVENTS → sempre token

CAM → FREE o token

lingua evento

viewer count (solo se live)

4) FILTRI & RICERCA
4.1 Feed vs Search

Default: feed

endpoint: GET /event/feed

Quando l’utente digita:

search live

endpoint: GET /live-search/search

4.2 Filtri

Tutti:

Genere (male/female/couple/gay/trans) — single select

Area geografica

Seguiti online

Solo VIP:

Lingua (match su tutte le lingue evento)

5) LIVE DETAIL PAGE (PAGINA EVENTO)

Pagina unica con:

video player

chat

CTA sotto al player

overlay dinamici (no cambio pagina)

CTA principali

TIP

PRIV

Chat

Scrive:

VIP

Base con token > 0

Base senza token:

read-only

Testo fisso:

“Chat available for VIP users or users with tokens”

6) PRIVATE DURING LIVE (CAM)
6.1 Private Offers

Max 5

Ogni offer:

titolo

durata (preset)

prezzo token (libero)

opzionale reservedForUserId

Offer riservate:

visibili solo all’utente target

invisibili agli altri

6.2 Flusso

Viewer apre PRIV

Seleziona un’offerta

Nessun pagamento

Creator riceve overlay:

“Private offer selected: X min / Y tokens”

Creator:

Start → addebito token + avvio privata

Decline → nulla accade

Private 1:1

Fine timer → auto-return alla public

Regole

Pagamento solo su Start

Private = room separata (cap logico 2)

Public room max 200 spettatori

7) EVENTS (NON-HOT)

Sempre ticket

Scheduled:

data/ora salvata in UTC

mostrata in local time all’utente

Live:

con ticket → player + chat

senza ticket → overlay acquisto

8) ADMIN

Accesso incognito:

non conta presenza

niente chat

Azioni:

segnalazione

Nessun blocco automatico

Nessun impatto su rimborsi

9) STATISTICHE LIVE (CREATOR)
Creator view

Endpoint:

GET /api/stats/live/me?window=30


Ritorna:

liveMinutesTotal

liveSessionsCount

tokensReceivedFromLive

windowDays

UI:

solo info (2 righe)

Live hours

Tokens from live

Regole:

Cancel prima del go-live → non conta