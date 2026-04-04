CONCEPT GENERALE — NESTX

(Layout, UX, comportamento, regole globali – Fase 1)

1. NATURA DEL PRODOTTO

NestX è:

un social adulto

non un sito di incontri

non un marketplace

non una piattaforma di funnel esterni

L’incontro tra utenti può avvenire, ma:

come conseguenza di una relazione

non come obiettivo diretto della piattaforma

non tramite promozione o link esterni

2. STRUTTURA GENERALE DEL SOCIAL (LAYOUT)
Desktop

Layout a 3 colonne:

[ COLONNA SINISTRA ] | [ COLONNA CENTRALE ] | [ COLONNA DESTRA ]

Mobile

1 colonna

navigazione principale adattata (bottom bar o menu)

contenuti extra spostati in fondo / drawer

nessun doppio scroll

3. COLONNA SINISTRA — NAVIGAZIONE (FISSA)
Contenuto

Home

Cerca

Notifiche

Chat

Live

Gestione Profilo

Token

Regole

Sempre visibile

Sempre fissa

È l’ancora dell’utente

Nessuno scroll proprio

Evidenzia solo la sezione attiva

👉 Contiene tutto ciò che riguarda l’utente, non il contenuto.

4. COLONNA CENTRALE — CONTENUTO PRINCIPALE

È il cuore del social.
È la colonna che definisce lo scroll della pagina.

Profili

Header profilo (avatar, nome, descrizione, CTA)

Sotto: tab fisse

Post del profilo

Post dei seguiti

Old Live

La struttura è la stessa:

sul proprio profilo

sul profilo di un altro utente

Cambiano solo:

CTA

permessi

visibilità contenuti (es. profilo privato)

Feed

Feed principale = colonna centrale

Cronologico / misto (post + eventi)

Nessun feed duplicato altrove

Old Live

Sezione storica

Secondaria

Non protagonista

Serve come archivio, non come discovery

5. COLONNA DESTRA — EXTRA / SUPPORTO (NON FISSA)
Contenuto possibile

Feed consigliati

ADV

Vetrina (se attiva)

Messaggi della piattaforma

Regole fondamentali

❌ NON ha scroll proprio

❌ NON è sticky

✅ Scorre insieme alla colonna centrale

Se è più corta dello schermo → resta vuota sotto

Se è più lunga → scorre naturalmente con la pagina

👉 Nessun doppio scroll.
👉 Nessuna colonna “invadente”.

Feed nella colonna destra

Consigliati per l’utente

Non cronologico

Non infinito

3–5 elementi max

Utente BASE

Feed 100% automatico (IA + comportamento)

Utente VIP

Feed ibrido

Possibilità di inserire feed di riferimento manuali

Questi feed:

sono privati

non sono tag pubblici

hanno priorità sui suggerimenti

6. SCROLL — COMPORTAMENTO GLOBALE
Colonna	Scroll
Sinistra	❌ Fissa
Centrale	✅ Scroll
Destra	✅ Scroll insieme alla centrale

❌ Nessuna colonna con scroll indipendente
❌ Nessun doppio asse di scroll

7. USCITE DALLA PIATTAFORMA — REGOLA GLOBALE
Principio

NestX è un ecosistema chiuso.

👉 Nessun link esterno inseribile, né cliccabile né copiabile.

8. CONTROLLI SUI CONTENUTI (LINK & CONTATTI)
Vietato (blocco hard)

URL (http, https, www)

Domini e TLD (.com, .it, ecc.)

Shortlink / redirect

Telegram (in ogni forma)

Discord, social, piattaforme gaming

Inviti, handle, funnel esterni

Se presenti → invio bloccato, non sanitizzato.

Contatti consentiti (eccezioni controllate)
✅ WhatsApp

Solo numero di telefono

Mai link (wa.me vietato)

✅ Email

Solo se coincide con l’email dell’account NestX

Solo in chat privata

Dove sono ammessi i contatti
Area	WhatsApp	Email
Bio	❌	❌
Post	❌	❌
Commenti	❌	❌
Live chat	❌	❌
Chat privata	✅	✅ (solo email account)
9. PARSING & INTERAZIONI

❌ Nessun parsing automatico di URL

❌ Nessun embed

❌ Nessuna preview

❌ Nessun link cliccabile

❌ Blocco tasto destro su tutta la piattaforma
(deterrenza UX, non sicurezza assoluta)

10. STATO DEL CONCEPT

✅ CHIUSO

✅ VINCOLANTE

✅ PRONTO PER FRONT-END

✅ Allineato con VIP, token economy, sicurezza e posizionamento

✅ Ogni futura modifica → nuova chat / nuovo concept

📌 RIEPILOGO SECCO (quello che va fatto ORA)
✅ Da fare subito

Bypass filtri privacy/search per admin

lato profile me / search social

Nuovi utenti = last X days (7 / 15 / 30)

non “oggi”

default 15

⏸️ Da fare dopo

tutto il resto della sezione admin

Se vuoi, nella prossima chat possiamo fare una cosa molto pulita:

audit mirato delle rotte di search / profile

elenco preciso:
“questa rotta → qui va aggiunto il check admin”

Annotazione precisa (così la tua checklist resta “eseguibile”):

Bypass UI reply (client)

Se la conversazione include un messaggio da accountType=admin (o se l’altro partecipante è admin):

disabilita input + bottone invia

mostra testo: “Message from staff — replies are disabled.” (lato utente, in inglese)

Block server-side reply toward admin (API)

Nel route di invio messaggi:

se toUser.accountType === "admin" e req.user.accountType !== "admin" → reject

response JSON in inglese (per utente): tipo 403 { message: "You can't reply to staff messages." }

Queste due righe sono sufficienti per recuperare tutto al volo quando riapriamo la parte backend.