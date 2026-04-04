FILE FRONTEND — NOTIFICHE + PROFILO (NestX)
1) SCHERMATA NOTIFICHE — Scopo

Pagina dedicata a mostrare solo eventi rilevanti per l’utente, senza duplicare feed o chat.
Notifiche = “cose che mi riguardano direttamente”.

2) Categorie Notifiche (tutte attive)
A) Social

Nuovo follower

Richiesta di follow (profilo privato)

Follow accettato (rifiuto rimosso come azione UI)

Like a un tuo post (una sola volta per utente)

Commento a un tuo post

Risposta a un tuo commento

Regole anti-spam:

Like notificato 1 sola volta per utente (toggle like on/off/on NON genera nuove notifiche)

Solo eventi rilevanti: niente “attività di terzi” non coinvolti

B) Eventi / Live

Evento seguito va live

Evento seguito schedulato

Evento cancellato

Reminder prima dell’inizio (es. 15 min)

Evento seguito termina

Regole:

Solo eventi visibili: public / followers

Unlisted mai notificati

Dopo fine o cancellazione → notifica eliminabile

C) Account / Sistema

Verifica profilo approvata / rifiutata

Cambio stato VIP

Comunicazioni critiche (sicurezza/account)

Regole:

Informative, non invasive

Possono non avere azione

D) Monetizzazione / Token

Ricezione token

Pagamento evento riuscito

Rimborso

Evento diventato a pagamento

Sold out

Regola speciale (fondamentale):

Notifiche token/transazioni = storico persistente (non scadono)

3) Persistenza / Scadenza (logica UI)

Token/Pagamenti → permanenti (archivio storico)

Eventi (live/scheduled) → finché rilevanti

Evento finito/cancellato → eliminabile

Social → temporanee

Sistema critico → finché utile

4) UI Notifiche — Requisiti minimi
Layout

Lista notifiche in ordine dal più recente

Ogni notifica mostra:

tipo (badge)

testo breve

timestamp

stato letto/non letto

Filtri UI (minimi)

Tutte

Social

Eventi/Live

Sistema

Token

Azioni possibili (dipendono dal tipo)

“Vai al profilo”

“Vai al post”

“Apri evento”

“Apri live”

Token/pagamenti: solo “Dettagli” (o nessuna azione, ma resta visibile)

Badge & contatori

In sidebar sinistra la voce “Notifiche” mostra badge numerico (non contenuto)

Nessuna duplicazione con chat (i messaggi non entrano nelle notifiche)

5) Regole coerenti con Privacy / Follow

Profilo privato: l’utente riceve “Richiesta follow” e può accettare o lasciare pendente
(Rifiuto non mostrato come azione UI, per evitare attrito)

Eventi notificati solo se:

segui quel creator oppure sei tu il creator stesso

Unlisted: mai notifiche, mai ricerca

PROFILO (Editor) — Frontend senza reinvii
6) Schermata “Profilo (Modifica le mie info)”

È solo editor del profilo loggato, non profilo pubblico.

Dati mostrati (da /api/profile/me)

avatar

coverImage

displayName

bio

area

profileType

language (primaria)

languages[] (extra)

badge stato: VIP / Creator / verificationStatus (solo lettura)

interests (resta modificabile)

Dati modificabili (whitelist)

avatar

coverImage

displayName

bio (max 500)

area (max ~120)

profileType

interests

language (obbligatoria)

languages[] (max 5, non include language)

Regole lingua (UI validation)

language obbligatoria

languages[] opzionale

languages[] non può contenere language

codici brevi: it/en/fr/…

UX minima

Sezione foto: cambia avatar/cover

Sezione info: displayName, bio, area, profileType, interests

Sezione lingue: language + extra languages

Pulsante Salva

Errori chiari: language mancante, codice non valido, languages contiene primaria, overflow max

IMPOSTAZIONI (per domani, lato frontend futuro)
7) Impostazioni App (solo UI)

Tema: system/light/dark

Lingua app UI (separata da language profilo)

Formato orario: 24h/12h

Contesto contenuti: Standard / Neutro / Live&Eventi
(non è blocco, non è OFF totale; influenza priorità in colonna destra)

8) “Minimo reinvio file” quando ripartiamo

Per frontend Notifiche/Profilo ti basterà mandarmi:

le risposte JSON reali degli endpoint che userai (1–2 esempi)
oppure anche solo:

il nome delle route + forma risposta

Così non mi mandi più server interi.