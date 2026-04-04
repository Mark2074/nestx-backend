FEED — CONCEPT DEFINITIVO (NestX)
Ruolo del FEED

Il FED è il feed di contenuti suggeriti utilizzato esclusivamente nella colonna destra di NestX.
Non è:

feed centrale

feed seguiti

ricerca

ADV

eventi

Il FED mostra solo POST consigliati.

Posizionamento UI

Colonna destra (Settore DX)

Ordine verticale:

FED (post consigliati)

ADV

VETRINA

Endpoint di riferimento
GET /posts/feed/fed


Usato solo per colonna DX.

Cosa ritorna il FED

Il FED ritorna:

solo Post

mai Event

mai ADV

mai contenuti propri

Response
{
  "page": 1,
  "limit": 20,
  "total": 1,
  "items": [ Post ],
  "meta": {
    "mode": "vip_manual | base_interests | fallback_trending",
    "usedInterests": [],
    "contentContext": "standard | neutral | live_events"
  }
}

Regole HARD (sempre attive)

Il FED ESCLUDE SEMPRE:

post dell’utente stesso (self posts = NO)

utenti mutati

utenti bloccati

post non visibili (visibility)

profili privati non accessibili

Queste regole non sono opzionali.

Logica interessi (ordine definitivo)
Input interessi (priorità)

VIP

user.interestsVip (manuali, massima priorità)

fallback su user.interests

NON VIP

user.interestsBase

fallback su user.interests

Regola generale

interestsVip / interestsBase = driver

interests = supporto

se tutti vuoti → fallback_trending

Matching contenuti (v1)
Strategia

Tags-first

Match su Post.tags

Se pochi risultati:

filler su Post.text

Nessuna invenzione di contenuti

Nessun riempimento forzato

👉 Feed corto è voluto se i contenuti non esistono.

Fallback Trending

Attivato solo se:

interestsVip

interestsBase

interests
sono tutti vuoti

Mostra:

post recenti

sempre rispettando regole HARD

Contesto contenuti (ranking, NON filtro)

Campo:

user.appSettings.contentContext


Valori:

standard → neutro

neutral → penalizza live / cam / eventi

live_events → favorisce segnali live

Applicazione attuale (v1):

solo su tag / keyword

non blocca nulla

influenza solo l’ordine

Comportamenti voluti (importanti)

Il FED non mostra post solo perché esistono

Il FED non mostra post dell’utente stesso

Il FED non riempie artificialmente

Il FED è deterministico e spiegabile

Personalizzazione FEED

Gestita via:

PUT /profile/update


Campi:

interestsBase

interestsVip (solo VIP)

appSettings.contentContext

Stato

Backend FEED CHIUSO

Testato con più utenti

Coerente con concept NestX

Pronto per frontend colonna DX

Nota frontend (per quando lo faremo)

Il frontend:

NON deve rifare logica

NON deve filtrare

USA SOLO items + meta

mostra il FED come blocco suggerimenti

🔒 FEED — DEFINITIVO

Quando vorrai fare il frontend, questo file basta al 100%.
Non servirà rimandarmi backend, rotte o modelli.