📄 FILE TESTO DA SALVARE — ADV_DX_FRONTEND_CONTEXT.txt

ADV — CONTEXT FRONTEND (NestX, COLONNA DESTRA)

1) Scopo (decisioni chiuse)

Gli ADV lato DX sono contenuti promozionali interni, creati dai creator o dalla piattaforma.

Non sono:

feed principali

post normali

storico profilo

Servono a:

promuovere live / eventi / contenuti

generare visibilità immediata

sostenere la piattaforma

2) Tipologie ADV (concetto unificato)

Non esiste distinzione visiva forte tra:

ADV evento

ADV live

ADV contenuto

👉 Una sola card ADV, cambia solo la destinazione.

3) Backend (rotte definitive)

Prefix: /api/adv

POST /api/adv/campaign
Crea una nuova campagna ADV (creator o sistema)

GET /api/adv/profile/active/:userId
ADV attivi di un creator (profilo)

GET /api/adv/serve
Serve un set di ADV adatti all’utente corrente (colonna DX)

GET /api/adv/serve/placement-feed
Serve ADV per feed (NON colonna DX)

POST /api/adv/:id/click
Log click ADV (tracciamento semplice)

4) Modello ADV — campi rilevanti frontend

(dal modello già definito e validato)

creatorId

title

text

mediaUrl

targetUrl (path interno obbligatorio)

targetType (event | liveRoom | url)

placement (profile | feed | pre_event)

isActive

startsAt, endsAt

targeting: languages[], countries[]

moderazione: reviewStatus

metriche: impressions, clicks

5) UI/UX ADV — colonna destra

Gli ADV DX sono mostrati come card compatte nella sidebar destra.

Comportamento:

caricamento tramite GET /api/adv/serve

numero ridotto (rotazione decisa dal backend)

visual:

immagine/video (se presente)

titolo

testo breve

CTA implicita: click sulla card

Al click:

chiamata POST /api/adv/:id/click

navigazione interna usando targetUrl

6) Regole UX fondamentali

❌ Nessuna distinzione “ADV vs contenuto” troppo evidente

❌ Nessun link esterno

❌ Nessun storico ADV nel profilo

✅ ADV spariscono quando:

isActive=false

fuori da startsAt/endsAt

non approvati

7) Moderazione (implicita)

Solo reviewStatus=approved viene servito

pending / rejected mai mostrati nel frontend

8) Relazioni concettuali (importanti)

ADV ≠ Vetrina

ADV = promozione

Vetrina = esposizione oggetto/post

ADV ≠ Old-Live

ADV ≠ Post

Tutti convivono nella colonna DX ma con logiche separate

9) Nota pratica per evitare reinvii file

Per implementare ADV frontend DX bastano:

componente AdvWidget (isolato)

API:

getAdvForSidebar()

trackAdvClick(id)

integrazione nel layout colonna destra (FED + ADV + Vetrina)

Se servirà capire la navigazione interna reale:

potrei chiedere 1 solo file router (non altro)

FINE FILE