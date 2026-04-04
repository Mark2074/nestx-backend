MEMO FRONTEND — CHAT (Messaggi privati 1-to-1) — NestX
0) Scope e regole (definitive)

Chat NestX = solo messaggistica privata 1-to-1 (no gruppi, no chat pubblica, no live chat, no commenti).

Limiti giornalieri:

Base: 10 msg/giorno

VIP (isVip === true): 100 msg/giorno

Reset automatico giornaliero (Rome dayKey).

Blocchi: non si può messaggiare se esiste un blocco in qualunque direzione (Block collection).

Anti-spam creator:

se sender è creator (accountType === "creator") può iniziare (primo msg) solo se:

recipient è creator oppure

recipient segue il creator (followingIds contiene senderId)

se la conversazione esiste già, può continuare.

Eliminazione messaggi:

solo VIP può “eliminare per entrambi” (solo UI)

messaggi non vengono cancellati dal DB (audit/log), ma spariscono dalle GET.

Read:

aprendo una conversazione, i messaggi ricevuti vengono auto-marcati readAt.

Notifiche:

i messaggi NON generano notifiche social

in UI si usa un badge numerico “Messaggi” (conteggio non letti), se/ quando verrà implementato.

1) Modello dati (Message)

Campi principali usati in UI:

_id

senderId

recipientId

conversationKey (chiave 1-to-1 ordinata)

text

createdAt

readAt

deletedForEveryoneAt (se valorizzato → non deve apparire in UI)

Regola conversazione:

conversationKey = buildConversationKey(userA, userB) (ordinata con a < b ? a__b : b__a)

2) API endpoints (Chat)
A) Invia messaggio

POST /api/messages/:recipientId
Body:

{ "text": "..." }


Risposte tipiche:

201 success

400 messaggio vuoto / recipient mancante / invio a sé stessi

403 blocco attivo

403 creator non può iniziare se non seguito

403 limite giornaliero raggiunto (10 o 100)

B) Lista conversazioni (inbox)

GET /api/messages/conversations
Ritorna lista di conversazioni con lastMessage per ciascuna.
Già filtra i messaggi eliminati per tutti (deletedForEveryoneAt: null).

UI: mostra “preview inbox”:

altro utente (da risolvere lato client)

ultimo testo

data/ora

stato letto (se lastMessage è ricevuto e readAt null → bold / badge)

C) Dettaglio conversazione + auto-mark read

GET /api/messages/conversation/:otherUserId
Comportamento:

torna i messaggi ordinati (createdAt crescente)

prima fa updateMany per settare readAt su tutti i msg ricevuti da me con readAt null

filtra eliminati per tutti (deletedForEveryoneAt: null)

UI: entrando in chat, i messaggi ricevuti diventano letti automaticamente.

D) Delete VIP “per entrambi” (UI only)

DELETE /api/messages/:messageId

Solo VIP (isVip===true)

Solo se partecipante (sender o recipient)

Setta deletedForEveryoneAt = now

Il messaggio sparisce dalle GET (per entrambi), ma resta in DB.

3) UI flows (frontend)
Inbox (lista conversazioni)

schermata “Messaggi”

chiama GET /api/messages/conversations

per ogni item mostra:

nome/ avatar dell’altro user (da risolvere con cache profili o endpoint profilo pubblico)

snippet lastMessage.text

createdAt formatted

indicator “non letto” se:

lastMessage.recipientId === me

lastMessage.readAt === null

Chat screen (thread 1-to-1)

on open: GET /api/messages/conversation/:otherUserId

render lista messaggi:

align right se senderId === me, left altrimenti

mostra timestamp

send:

POST /api/messages/:recipientId

append optimistic + replace con response id

se 403 limite → toast “limite giornaliero”

se 403 blocco → toast “impossibile inviare”

se 403 creator-first-msg → toast dedicato

Delete (solo VIP)

su ogni messaggio (o solo su quelli inviati da me, a scelta UI):

mostra opzione “Elimina per entrambi” se isVip===true

chiama DELETE /api/messages/:messageId

rimuovi immediatamente il messaggio dal thread in UI

4) Error messages utili (per UI)

“Non puoi inviare messaggi: tra voi esiste un blocco attivo”

“Come host non puoi iniziare una nuova conversazione con utenti che non ti seguono”

“Limite giornaliero messaggi raggiunto (10/giorno)” o “(100/giorno)”

“Il messaggio non può essere vuoto”

5) Nota tecnica importante (blocco)

Il controllo blocchi deve basarsi su Block collection (non su user.blockedUsers), tramite isUserBlockedEitherSide().