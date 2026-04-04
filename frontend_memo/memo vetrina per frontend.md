📄 FILE TESTO DA SALVARE — VETRINA_FRONTEND_CONTEXT.txt (aggiornato)

VETRINA — CONTEXT PER FRONTEND (NestX)

1) Scopo (decisioni chiuse)

La Vetrina è una sezione temporanea (colonna destra) che mostra items promossi.
Non esiste storico:

❌ nessuna “Old-Vetrina”

❌ nessuna pagina profilo con storico vetrina

❌ nessuna ricerca vetrina

Ogni item Vetrina:

è (o genera automaticamente) un post normale → compare in feed e nel profilo come contenuto standard.
La Vetrina serve solo come “esposizione” temporanea in colonna DX.

2) Backend (rotte definitive)

Prefix: /api/showcase

POST /api/showcase/item
Crea un item Vetrina (stato iniziale: pending)

GET /api/showcase/serve
Serve un set piccolo di items per la colonna destra (selezione per utente)

POST /api/showcase/:id/click
Traccia click e restituisce un redirect interno (tipicamente profilo owner)

Regola: navigazione interna (no link esterni obbligatori).

3) Modello (showcaseItem.js) — campi chiave frontend

creatorId (owner)

title, text, mediaUrl

startsAt, endsAt, isActive

targeting: languages[], countries[]

monetizzazione: billingType (free/paid), paidTokens

moderazione: reviewStatus (pending/approved/rejected), reviewNote

metriche: impressions, clicks

4) UI/UX Vetrina (frontend)

La Vetrina è un widget in colonna destra che:

carica items con GET /api/showcase/serve

mostra una lista compatta (pochi items)

per ciascun item:

mostra mediaUrl (se presente), title, testo breve

click sull’item (o CTA “Apri”)

Al click:

chiama POST /api/showcase/:id/click

usa la risposta per navigare internamente (profilo owner o contenuto correlato)

Stati UI:

loading (skeleton)

empty (nessun item: widget minimal o nascosto)

error (fallback silenzioso / retry leggero)

Regole:

Non esiste “pagina storico vetrina”

Non esiste sezione nel profilo “old-vetrina”

La memoria storica vive solo come post nel feed/profilo.

5) Coerenza

Vetrina ≠ Old-Live (separate concettualmente e UI)

Vetrina è “esposizione temporanea DX”, non archivio.

6) Nota pratica per evitare reinvii file

Per implementare frontend Vetrina bastano:

componente isolato ShowcaseWidget (colonna destra)

API: getShowcaseItems() + trackShowcaseClick(id)

integrazione nel layout colonna destra (FED + ADS + Vetrina)

Se servirà agganciare la navigazione interna reale, potrei chiedere solo:

1 file router (per capire come si naviga ai profili)

FINE FILE

Piccolo Memo che non cambia il concetto della vetrina di cui abbiamo discusso ed approvato, il fatto di contattare utenti che pubblicizzano e piccole aziende che producono materiale per adulti che su x hanno profili per sfruttamento nostra vetrina, con le condizioni già definite.