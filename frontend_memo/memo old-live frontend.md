📄 FILE TESTO DA SALVARE — OLDLIVE_FRONTEND_CONTEXT.txt

OLD-LIVE — CONTEXT PER FRONTEND (NestX)

1) Scopo

Old-Live è una sezione che mostra le live concluse di un utente solo dentro il profilo.
Non è una pagina globale e non ha ricerca.
Mostra max 10 live ordinate per performance reale.

2) Backend già fatto (chiuso e testato)

File route: routes/oldLiveRoutes.js

Mount: app.use("/api/profile", oldLiveRoutes)

Endpoint:

GET /api/profile/old-live/:userId

Header: Authorization: Bearer <token>

Response (shape)
{
  "items": [
    {
      "eventId": "ObjectId",
      "title": "string",
      "coverImage": "string|null",
      "category": "string|null",
      "language": "string|null",
      "startedAt": "ISO|null",
      "endedAt": "ISO|null",
      "peakViewers": 0,
      "durationMinutes": 0,
      "score": 0,
      "cardType": "event",
      "isOldLive": true
    }
  ]
}

Regole ranking

peakViewers deriva da LiveRoom.peakViewersCount (max tra public+private)

durationMinutes deriva da:

actualLiveStartTime/actualLiveEndTime (primario)

fallback startedAt/endedAt

score = peakViewers / durationMinutes (o peak se durata null)

Ordinamento già fatto server-side (desc score)

3) UI/UX Old-Live (decisioni chiuse)

Old-Live è una voce autonoma nella sidebar sinistra (profilo), visibile anche se vuota.

Old-Live non è agganciata alla sezione Live in “Gestisci”.

Old-Live mostra card non duplicate: 1 card per live conclusa.

Non esiste “Old-Vetrina”.

La UI può decidere se mostrare o no numeri (peak/durata) quando sono bassi:

regola UI suggerita: se valori troppo piccoli → non mostrare metriche, ma la card resta.

4) Frontend: cosa va implementato

Obiettivo: aggiungere nel profilo pubblico una sezione/tab “Old-Live” che:

chiama GET /api/profile/old-live/:userId

gestisce stati: loading / error / empty / list

renderizza fino a 10 card

nessuna CTA “join/buy”, sono live concluse

click card: se esiste pagina evento, naviga a dettaglio evento con eventId; se non esiste, la card resta non cliccabile.

5) Nota pratica per evitare reinvii file

Per implementare frontend Old-Live, se serve un minimo di integrazione:

può essere fatto con un componente isolato (OldLiveSection) + fetch (getOldLive(userId)).

se serve riusare la card esistente, basta adattare un renderCard(item) o mappare i campi a EventCard.

FINE FILE