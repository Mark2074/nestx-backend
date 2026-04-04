⭐ NESTX — CONCEPT COMPLESSIVO (VERSIONE UFFICIALE)
“............”

🔹 1. Logica Complessiva della User Experience
La parte social del sito è la vetrina per gli utenti, qui ci si fa conoscere, si crea seguito, si scoprono i contenuti e si accede agli eventi live, l'economia del sito ruota attorno al social.
Il concept di NestX è autenticità, amatorialità, interazione, monetizzazione semplice e pulita, 
privacy elevata.
All'interno del sito qualsiasi genere di pagamento avviene solo ed esclusivamente tramite Token, i soldi veri vengono gestiti dal provider esterno, sono loro che raccolgono i soldi e li suddividono tra piattaforma e Creator.

🔹 2. Identità Utente e Tipologie di Profilo
Ogni utente si registra come Uomo, Donna, Coppia, Trans, Gay, nasceranno tutti come utenti base ed a seconda di loro scelte evolveranno il loro profilo/status.
- Verifica età e prevenzione accesso minori (NestX)
1️⃣ Principio generale
NestX non consente l’accesso a minori di 18 anni. La piattaforma adotta un approccio multilivello, combinando: autodichiarazione esplicita, verifica anagrafica in registrazione, controlli successivi su contenuti e profili.
L’obiettivo è: impedire l’accesso ai minori, dimostrare diligenza e responsabilità legale, mantenere un’esperienza fluida per gli utenti maggiorenni.
2️⃣ Conferma di maggiore età (Age Gate di accesso)
Al primo accesso dopo login viene mostrato un modal obbligatorio: “Confermo di avere almeno 18 anni e di voler procedere con la visualizzazione di contenuti potenzialmente sensibili.”
L’utente deve accettare esplicitamente per accedere al sito. Il consenso viene registrato (adultConsentAt) e non è legato alle singole live, ma all’accesso generale alla piattaforma.
In caso di rifiuto → accesso negato.
Questo soddisfa il requisito di consenso esplicito informato.
3️⃣ Data di nascita obbligatoria in registrazione
In fase di registrazione, la data di nascita è obbligatoria. Se l’età risultante è inferiore a 18 anni: la registrazione viene bloccata, 
viene mostrato il messaggio: “Il sito non è autorizzato ai minorenni.” 
Non viene applicato alcun blocco permanente sull’email: l’utente può correggere eventuali errori di digitazione, la piattaforma evita esclusioni irreversibili accidentali.
4️⃣ Tracciamento tentativi underage (log interno)
Per finalità di sicurezza e moderazione, NestX mantiene un log interno separato associato all’email utilizzata in registrazione.
Il sistema registra: la prima data di nascita inserita (in formato stringa, es. YYYY-MM-DD); il numero di tentativi falliti per età < 18; la data di nascita utilizzata nella registrazione riuscita (se avviene); il collegamento all’account finale (se creato).
Questo log: non blocca automaticamente l’utente, non è visibile pubblicamente, viene usato solo come segnale interno per valutazioni successive.
5️⃣ Utilizzo del log in fase di moderazione
In caso di: segnalazioni IA su contenuti, verifiche manuali da parte dell’amministratore, comportamenti sospetti, 
lo storico dei tentativi underage può essere consultato per: valutare l’affidabilità del profilo,
decidere eventuali provvedimenti (ban, verifica approfondita, rimozione contenuti).
Nessuna decisione automatica viene presa solo sulla base di questo dato.
6️⃣ Conformità legale
Questo approccio garantisce: dichiarazione esplicita di maggiore età; blocco tecnico all’accesso dei minori; tracciabilità delle azioni rilevanti; dimostrazione di diligenza attiva da parte della piattaforma.
NestX non si affida a un singolo controllo, ma a un sistema coerente e progressivo, in linea con le pratiche adottate dalle principali piattaforme di contenuti sensibili.

🔹 3. Verifica Autenticità (Livello 1 — Autori)
E un punto a cui la piattaforma tiene molto, la verifica standard serve a garantire che l’utente sia, reale, che appartenga davvero alla ategoria dichiarata.
Procedura mediante Video di verifica con foglio scritto a mano contenente:
nickname, data del giorno, “NESTX”.
Il video può mostrare la silhouette, non è necessario il volto.
Viene reso visibile pubblicamente sul profilo per dare autenticità.
Gli utenti “verificati” ottengono il badge visibile.

🔹 4. Verifica Autenticità (Livello 2 — Contenuti “Totem”)
Serve a certificare che i contenuti dell’host siano davvero originali, non siano video riciclati trovati online.
Procedura di verifica autenticità contenuti (video/foto).
L’utente sceglie un oggetto segreto (definito totem un oggetto personale).
Registra un video privato uguale al livello 1, ossia provvisto di foglietto con dati uguali a livello 1 (data aggiornata), silhouette utente singolo/coppia e totem ben visibile.
Questo video viene inviato solo allo staff e da quel momento ogni video/foto dell’host che mostra il totem ottiene un badge “Autentico / Original content”, Questo permette allo spettatore di sapere cosa paga.

🔹 5. Ruoli Utente Operativi
Host/Creator
Tutti gli utenti possono generare contenuti ed eventi live, gli utenti che generano live vengono definiti host e possono aprire live pubbliche/private, creare eventi, ricevere tip.
Solo gli utenti registrati su provider Stripe possono riscattare token dopo approvazione del provider, per i prelievi si appicheranno delle regole.
- VIP E uno status non un tipo di account, ha dei privilegi che lo distinguono, può scrivere sempre in chat, vede meno ADV esterni nel proprio profilo, può creare più ADV interni ha funzioni extra (come da policy definita). Successivamente gli account Vip si aggiungeranno due nuovi grupi definiti Premium e Premium+ che aumenterannoi benefici (nasceranno quindi 3 tipi di account Vip, Vip Premium e Vop Premium+).
- Base Ha tutte le funzionalità classiche, unica vera limitazione, non può scrivere nelle chat live, per farlo deve possedere token.
- Verificato Non ha funzionalità aggiuntive rispetto al base, ha solo uno status che lo definisce reale.
- Privato, in caso di notifica richiesta di essere seguito lui può accettare o lasciare pendente la richiesta per evitare notifiche negative che crerebbero attriti.

🔹 6. Architettura live
Le live  avranno struttura scalabile gestita centralmente e saranno gestite in P2P per piccoli eventi e SFU per eventi più grandi.

🔹 7. Live Pubbliche
La live pubblica è aperta a tutti ed entrare gratuitamente, l’host può riceve tip dagli utenti.
Chat:
L'host decidere se la chat è attiva o meno, o mutare un singolo utente, in chat possono scrivere solo Vip e chiunque possieda Token
Blocco utenti:
se l’host blocca un utente, quest’ultimo non può più entrare nelle sue live, comprare ticket,scrivergli messaggi privati. Se un utente blocca l’host, vale l’inverso.

🔹 8. Live Private (Private Live Rooms)
Chiunque può creare live private sia in partenza, o renderle privata una pubblica in corso.
Le live private devono avere sempre prezzo e capienza, quindi l’host imposta un ticket (es. 20 token) e un numero di posti
Avvio della live può essere effettuato solo dall’host anche con 0 utenti.
L'accesso avviene solo pagando un ticket, se la room è già iniziata, si può entrare solo se ci sono posti liberi.
Quando una live pubblica diventa privata la live pubblica viene congelata, chat disabilitata, banner visibile: “Sessione privata in corso”, nella lista live compare il badge PRIVATE.
Chat in privata attiva o disattivata a discrezione dell’host, tip sempre disponibili.

🔹 9. Ticket
Tre casi d’uso:
Ticket pre-evento usato quando l’host crea un evento programmato, tiket in prevendita, chi paga entra alla live quando avvia.
Ticket durante un evento pubblico, se l’host decide di aprire una privata, lìaccesso è esclusivo per chi paga il tiket.
Ticket per entrare a privata già avviata, possibile solo se c'è ancora capienza.
⚠️ Ticket bloccato se host/utente sono bloccati tra loro.

🔹 10. Tip / Token
Gli utenti possono inviare token all’host come apprezzamento, l’host monetizza una percentuale dei token ricevuti, il sistema token è l’unico metodo di pagamento interno.
A stretto giro possibilità di donazioni e pagamento contenuti privati (foto, video).
10 token = 1,30€ (esempio da definire meglio), NestX trattiene il 20%-30%.

🔹 11. Messaggistica Privata
La messaggistica è libera tranne per blocco tra utenti e il Creator che non può contattare utenti che non lo seguono, può rispondere ai messaggi di utenti che non lo seguono solo se sono loro a scrivere per primi, serve ad evitare spam. I creator possono contattarsi tra loro se non presente blocco.

🔹 12. ADV (Pubblicità)
L’host può creare pubblicità non esplicite che verrà pubblicata gratuitamente nella parte alta del sul suo profilo.
Regole di creazione ADV, niente nudità, niente contenuto volgare, nessun link esterno (solo interni alla piattaforma), lo staff approva o rifiuta.
Un host Creator Vip può generare max 2 ADV che verranno pubblicate gratuitamente nella sezione ADV visibile a tutti gli utenti della piattaforma per un tempo limitato ed a rotazione con gli altri ADV.
Per un numero superiore di ADV dovranno pagare extra ad ADV, quantificato in 10 Token.
Gli ADV esterni verranno mostrati tra i post degli utenti seguiti e i post del profilo visitato e verranno ridotti in funzione del tipo di account, account base ogni 15 post, status VIP ogni 25 post, successive riduzioni sono contemplate nel file miglioramenti.
Gli ADV interni potranno essere usati per la promozione di qualsiasi evento, media, prodotto dell'utente

🔹 13. Social (feed e contenuti)
Suddiviso su 3 sezioni verticali, sezione SX zona MENU, centro sezione social HOME_PAGE, DX sezione Feed, ADV creator, Vetrina.

🔹 14. Sezione SX Menù
ERiguarda il proprio profilo ed è composta da:
HOME
  ritorno alla Home-Page, 
CERCA
  ricerca all'interno della piattaforma per ora ricerca semplice (sidebar “Cerca”) che trova risultati in, Users, Events, Posts, Con testo libero + filtri minimi, nessun filtro per i base, al vip aggiungiamo filtro per genere, area geografica e lingua in social, mentre in live filtra solo la lingua, genere e area rimangono filtri per tutti. Abbiamo anche aggiunto una variabile unlisted che elimina dalla possibilità di ricerca (es. per venti disponibili solo per link), solo il creator lo può trovare ma solo con my-create. Sono esclusi dalla ricerca anche eventi finiti, cancellati e quelli in old-live.
NOTIFICHE
  1️⃣La sezione Notifiche serve a: Informare l’utente solo su eventi rilevanti, Evitare rumore, duplicazioni del feed e spam, Non sostituire feed social né chat.
  Notifiche = eventi che riguardano direttamente l’utente
  2️⃣Categorie di notifiche (tutte attive)
  A) Social Nuovo follower, Richiesta di follow (profilo privato), Follow accettato / rifiutato, Like a un tuo post (una sola volta per utente), Commento a un tuo post, Risposta a un tuo commento.
  Regole: Niente spam (like on/off ripetuti → una sola notifica), Solo eventi rilevanti, No attività di utenti non coinvolti.
  B) Eventi / Live, Evento seguito va live, Evento seguito viene schedulato, Evento cancellato, Reminder prima dell’inizio (es. 15 min), Evento seguito termina.
  Regole: Visibili solo eventi public / followers, Unlisted mai notificati, Dopo cancellazione o fine evento → notifica eliminabile, Eventi visibili solo se: segui il creator oppure sei il creator stesso.
  C) Account / Sistema, Verifica profilo approvata / rifiutata, Cambio stato VIP, Comunicazioni critiche di sistema, Problemi di sicurezza o account.
  Regole: Sono notifiche informative, Possono non avere azione associata, Non devono essere invasive.
  D) Monetizzazione / Token, Ricezione token, Pagamento evento riuscito, Rimborso, Evento diventato a pagamento, Sold out.
  Regole speciali: ❗ Notifiche token e transazioni NON scadono, Devono restare come storico persistente, Solo informative (nessuna azione obbligatoria)
  3️⃣Filosofia: poche notifiche, solo importanti, ❌ No spam, ❌ No notifiche decorative, ❌ No duplicazione feed, ❌ No rumore.
  ✔️ Poche notifiche, ✔️ Chiare, ✔️ Rilevanti
  4️⃣Persistenza / Scadenza notifiche, Tipo notifica	Persistenza, Token / pagamenti	Permanente, Eventi (live / scheduled)	Finché rilevanti, Evento cancellato / finito	Eliminabile, Social (like, commenti)	Temporanea, Sistema critico	Finché utile.
  5️⃣Azione vs Informazione, Le notifiche NON devono sempre avere un’azione.
  Azioni possibili: Apri evento live, Vai al post, Vai al profilo, 
  Solo informative: Pagamenti, Token, Evento cancellato, Stato account, Dipende dal tipo di notifica.
  6️⃣Regole speciali anti-spam, Like notificato una sola volta per utente, Toggle like (on/off/on) non genera nuove notifiche, Eventi unlisted mai notificati, Eventi finiti non riappaiono, Admin esclusi dalle notifiche social standard
  7️⃣Stato finale Questo concept: È coerente con il sistema di ricerca, È coerente con privacy, follow e visibilità.
  Implementata notifica esito approvazione/rifiuto ADV da parte dell'admin
  È scalabile Riduce drasticamente complessità e rumore.
CHAT
  La chat messaggistica di NestX serve esclusivamente per comunicazione privata 1-to-1 tra utenti, non è una chat pubblica, non è una live chat, non è un sistema di commenti.
  E una chat privata diretta, non è una chat di gruppo, gli utenti Base possono inviare max 10 messaggi al giorno, gli utenti VIP (status isVip === true) massimo 100 messaggi al giorno, i limiti sono giornalieri, reset automatico.
  Gli utenti possono rispondere a chiunque scriva loro, non possono contattare utenti bloccati o da cui sono stati bloccati, i creator non possono scrivere per primi a utenti che non li seguono. (antispam strutturale)
  Solo utenti VIP possono eliminare i messaggi inviati, l’eliminazione è solo lato UI, i messaggi restano tracciati lato backend, non vengono cancellati dal database (log legale / sicurezza).
  I nuovi messaggi NON generano notifiche social, Viene mostrato un badge numerico sulla sezione “Messaggi”, il contenuto del messaggio non compare nelle notifiche
  Privacy e sicurezza di supporto a blocco utenti, mute conversazioni, i messaggi eliminati restano accessibili solo allo staff/admin, nessuna indicizzazione o visibilità esterna
  Funzionalità escluse (per ora)
  ❌ Traduzione automatica, Chat di gruppo, Messaggi vocali, Messaggi temporanei, Monetizzazione diretta della chat.
LIVE — NestX (definitivo per questa fase)
  5) Chat live — modello economico confermato (già nel concept)
  Accesso live
  ✅ CAM pubblica: ingresso libero (adult, non bloccati)
  Interazione chat
  ✅ Scrive SOLO: VIP gratis, Base se ha token disponibili (tokenBalance > 0) ❌ Base senza token: read-only
  Nota: questo è un modello “free view / paid interaction” già previsto e testato a livello logico; verrà verificato visivamente durante frontend.
  6) Anti-lava: “nuovo utente → non può aprire CAM subito” (nuova policy)
  Motivo: qualità piattaforma + sicurezza + moderazione (non puoi essere 24/7).
  ✅ LIVE ELIGIBILITY POLICY (minima)
  Un utente può creare CAM / eventi solo se:
  adultConsentAt presente
  emailVerified === true
  profileComplete === true (minimo: displayName + avatar + bio minima)
  account age ≥ 24h (cooldown)
  Questo è coerente con il percorso dichiarato in Home:
  registrati → costruisci profilo → costruisci seguito → vai live → monetizzi.
  7) Monetizzazione immediata: DONAZIONE SU PROFILO (da implementare ora)
  ✅ Feature: Donate button sul profilo
  è un semplice purchaseType = profile_donation
  importo libero scelto dall’utente (“quanto vuoi”)
  token vanno al creator (con fee piattaforma come da policy)
  serve come monetizzazione “semplice” anche fuori dalle live
  8) Contenuti a pagamento (fase successiva ma già prevista)
  ✅ Paid content (soprattutto video)
  Regole anti-abuso:
  pagamento consentito solo per:
  video oltre una durata minima (es. > X secondi/minuti)
  contenuti “significativi” (non microclip da 5 secondi)
  prezzo deciso dal creator
  acquisto via purchase route generica
  Obiettivo: evitare che tutti blindino contenuti inutili per “fare la cresta”.
  9) Extra: stress test live (pratica fattibile)
  Setup migliore:
  host reale = tu
  viewers simulati via headless browser (50/100/200)
  Test a step:
  smoke 10 reali, 50 bot, 100 bot, 220 bot (cap a 200 con ROOM_FULL)
  ✅ Stato finale
  Backend “quasi finito”: si interviene solo su aggiunte/policy emerse.
  Frontend sarà lo strumento vero per testare UX e coerenza gating.
  Prime implementazioni da fare ora:
  Donate button profilo, Live eligibility policy, Hard cap early stage (config + join enforcement)
  1️⃣ Struttura generale Live
  La sezione Live è un contenitore logico con due ingressi distinti:
  Eventi (NON-HOT) → Live / eventi senza contenuti sessuali
  CAM (HOT) → Live a sfondo sessuale (cam)
  Sono due pagine separate, ma strutturalmente identiche a livello UI e backend: cambia solo contesto,
  cambiano filtri, cambia warning di accesso
  2️⃣ Classificazione HOT / NON-HOT (obbligatoria)
  Decisione chiave, Campo obbligatorio, Nessun default, Il creator deve scegliere esplicitamente: HOT / NON_HOT, Motivazione, Evita errori “inconsapevoli”, Evita che contenuti NON-HOT finiscano automaticamente in HOT, Responsabilizza il creator, Backend e IA più puliti
  Senza selezione → non si può andare live / creare evento
  3️⃣ Layout pagina Live
  Layout identico al social: Colonna sinistra: invariata (menu), colonna destra: invariata (ADV / Vetrina / info), Colonna centrale: diventa Live Grid, Live Grid (centro)
  Mostra: anteprime (thumbnail / cover live), 
  stato: live ora, scheduled, creator, tag principali, contatore spettatori (se live)
  Niente post social qui, Niente old-live mischiati (old-live resta nel profilo)
  4️⃣ Ricerca e Filtri Live
  Ricerca, Ricerca solo interna alla sezione Live, Basata su: titolo, tag, nome creator
  Filtri, utenti Base, tipo account (single / coppia / gay / trans), area geografica
  Utenti VIP, tutto quanto sopra, + filtro lingua, I filtri HOT / NON-HOT non esistono, sono già separati per pagina
  5️⃣ Filtro “Seguiti online”
  All’interno della sezione Live, filtro rapido: “Seguiti online”, mostra solo le live attive dei creator seguiti, serve per accesso rapido, zero rumore
  6️⃣ Accesso CAM (HOT) — Warning obbligatorio
  Comportamento, Al click su Live → CAM (HOT): mostra modal di conferma bloccante, l’utente deve accettare esplicitamente, Testo ufficiale, Titolo: Contenuti HOT
  Messaggio: “Stai per accedere alla sezione CAM HOT con contenuti per adulti. Vuoi continuare?”
  Pulsanti: Annulla, Entra in CAM HOT, Flag “Non mostrarmelo più”, checkbox: “Non mostrarmelo più su questo dispositivo”, salvato solo in localStorage, nessun dato a backend, vale solo per l’accesso alla sezione CAM
  Il warning: non si ripete per ogni live, solo all’ingresso della sezione
  7️⃣ Backend — stato attuale
  Tutte le logiche: create / go live, stop, eventi, ticket, notifiche, token → già esistono
  Serve solo: aggiungere/validare campo HOT/NON_HOT, 
  endpoint list dedicati per: Live HOT, Live NON-HOT, supporto filtri lingua (VIP)
PROFILO (GESTISCI)
  - PROFILO (Modifica le mie informazioni) Schermata “Profilo” dedicata solo alla gestione delle informazioni personali  modificabili dell’utente loggato è editor del profilo.
  Dati mostrati recuperati da GET /api/profile/me: Avatar (URL), Cover (URL), DisplayName,interest, Bio, Area geografica (string libera), ProfileType (enum: male/female/couple/gay/trans), 
  Lingua primaria language (codice standard) per ora non obbligatoria, Lingue extra languages[] (codici standard) opzionali, Profile language = user.language (può essere vuota)
  Stato (solo lettura): VIP / Creator / VerificationStatus (badge), 
  Dati modificabili (whitelist).
  Aggiornabili solo via PUT /api/profile/update: avatar, coverImage, bio (max 500), diplayName, area (max ~120), profileType (enum), interest
  language (obbligatoria, codice standard), languages (array extra, max 5, NON include language)
  Campi NON modificabili (hard block) PUT /api/profile/update deve ignorare o rifiutare modifiche a: email, passwordHash, isVip, accountType, verifiedUser, verificationStatus, token/payout fields (tokenBalance, tokenEarnings, payout*, creator*), follow/blocked arrays e contatori, qualsiasi altro campo non in whitelist, 
  Regole lingua (definitive), language = lingua primaria (obbligatoria), languages[] = lingue parlate extra (opzionali)
  languages[] non deve contenere la lingua primaria, Formato standard: codici brevi (it, en, fr, ecc.)
  UX minima (concettuale)
  Sezione Foto: cambia avatar / cambia cover
  Sezione Info: bio, area, profileType
  Sezione Lingua: language (obbligatoria) + languages extra
  Pulsante “Salva”
  Errori chiari (language mancante, codice non valido, languages contiene primaria, ecc.), 
  - IMPOSTAZIONI APP serve a gestire: preferenze dell’app e preferenza di contesto contenuti, 
  Non include notifiche, messaggi, feed, token, privacy, sicurezza, verifica o gestione creator.
  Le impostazioni App Gestiscono solo l’interfaccia, Tema: chiaro / scuro / sistema, Lingua app (UI indipendente dalla lingua del profilo), Formato orario: 24h / 12h, non influiscono sul social o sulla monetizzazione.
  Contesto contenuti è l'unica impostazione legata ai contenuti, è pensata per dare spazio a contenuti dicersi da quelli a sfono erotico/sessuale i valori sono: Standard (default), Neutro, 
  Live & Eventi, non è un blocco e non spegne nulla. Serve solo a indicare che tipo di contenuti l’utente preferisce vedere con maggiore priorità.
  Questa preferenza: non cambia nulla oggi, verrà letta in futuro da FED / ADV / Vetrina (colonna destra), non garantisce mai la rimozione totale delle promozioni.
  Avrà un testo concettuale: “Influenza la priorità dei contenuti consigliati. Alcune promozioni possono restare visibili.”
  Le impostazioni sono salvate sull’utente con valori di default, se mancano (utenti vecchi), si usano i default automaticamente.
  Impostazioni: definite, FED / ADV / Vetrina: non implementate, ma già compatibili, Nessuna modifica a parti già funzionanti, quando si implementerà la colonna destra, FED, ADV e Vetrina leggono il contesto contenuti, non si tocca la sezione Impostazioni.
  - GESTISCI — CONCEPT DEFINITIVO (NestX)
  Gestisci è il pannello operativo dell’account. Non è profilo, non è impostazioni, non è token.
  Serve a modificare lo stato dell’utente, non a creare contenuti.
  🔹 Contenuto di GESTISCI
  1️⃣ Operativo
  Azioni che cambiano lo stato dell’account: Avvia verifica profilo, Richiedi / gestisci Creator
  Onboarding Stripe / stato payout, Richiedi / gestisci VIP, Nessuna creazione di contenuti.
  2️⃣ Creator (visibile solo se creator o idoneo)
  Sezione informativa: Stato creator (attivo / in verifica / limitato / disabilitato), Avvisi brevi di stato (1 riga, non esplicativi), Cosa è consentito fare (live / ADV / vetrina)
  3️⃣ Contenuti
  Solo riepilogo numerico: Post, Live, Eventi, ADV, Vetrina, Nessuna gestione diretta.
  4️⃣ Live
  Solo informativo: Stato live attuale (attiva / nessuna), Presenza live programmata, Avvisi brevi (cancellata, chiusa automaticamente), Nessun link a Old-Live, Nessun storico, Nessuna ultima live
  🔹 Cosa NON è GESTISCI ❌ Profilo, Impostazioni, Token (voce separata), Old-Live (voce separata),  Admin
  🔹 Concetto chiave Gestisci risponde a due sole domande: In che stato sono?, Cosa posso fare adesso?
  🔹 Relazioni 
  Token → voce autonoma sempre visibile
  Old-Live → voce autonoma, anche se vuota
  Verifica → sezione separata, richiamata da Gestisci
  - Privacy & Sicurezza — CONCEPT (VERSIONE APPROVATA)
  1) Privacy profilo, Account privato (isPrivate)
  ON → follow a richiesta, contenuti visibili solo a follower accepted
  OFF → profilo pubblico
  ❌ Hide likes eliminato (scelta corretta: ridondante e inutile)
  2) Sicurezza account, Cambio password ✅ (da implementare ora), Logout da tutti i dispositivi / revoke sessioni ✅ (da implementare ora), Email sicurezza / recovery → rimandata, 2FA → rimandata
  3) Blocco e silenzia, Utenti bloccati, lista, sblocca, Utenti silenziati (mute), lista, unmute
  4) Comunicazioni e chat (informativo), Limiti chat, Base: 10 msg/giorno, VIP: 100 msg/giorno, Permessi CAM / LIVE, solo informativo, nessuna modifica qui.
  Esclusioni confermate, ❌ Token / pagamenti, ADV / eventi / vetrina, Old-Live, Verifica profilo / creator, Preferenze feed / interessi
  Stato finale, Concept chiuso, Scope pulito, Backend necessario solo per: change password, logout globale / revoke sessioni.
  - Sezione Verifiche (VERSIONE DEFINITIVA)
  La sezione verifica comprende due verifiche video indipendenti, possono esistere separatamente, non si bloccano a vicenda, servono a scopi diversi.
  1️⃣ Verifica Profilo (IDENTITÀ / COERENZA PERSONA)
  Verificare che: la persona (o coppia) esista davvero, il tipo di profilo dichiarato (single, coppia, gay, trans) sia coerente, i contenuti pubblicati siano inerenti a chi gestisce l’account
  Contenuto richiesto, Video pubblico di verifica.
  il video dovrà contenere Corpo siluette, non necessariamente il viso (quanto basta per coerenza, non erotico), Foglio con: NestX + username + data.
  Campi, verificationPublicVideoUrl, verificationStatus: none | pending | approved | rejected, 
  verifiedUser: true solo se approved
  Visibilità, Il video è visibile sul profilo SOLO se approvato, Badge “Profilo verificato”
  2️⃣ Verifica Totem (AUTENTICITÀ CONTENUTI)
  Verificare che: foto / video pubblicati siano originali, i contenuti appartengano realmente a quell’utente, evitare furti di contenuti / repost da altre piattaforme.
  Video privato in possesso solo a nest e utente che lo ha inviato, deve contenere le stesse cose del video di verifica profilo con aggiunta del totem.
  Il totem è un'oggetto personale, di qualsiasi natura e genere es. “quadro blu dietro il letto”, “lampada a forma di X”, ecc., dovrà essere sempre presente nel contenuto che l'utente pubblica per avere il bage di contenuto autentico.
  Campi, verificationTotemVideoUrl, verificationTotemDescription, 
  Visibilità, ❌ MAI visibile agli utenti, visibile solo a staff / IA.
  Effetto pratico
  Se un contenuto (foto/video/post) mostra il totem → contenuto marcabile come “Autentico/Verificato”
  Se non mostra il totem → contenuto normale (anche se il profilo è verificato)
  3️⃣ Relazione tra le due verifiche
  ✅ Verifica Profilo NON richiede Totem
  ✅ Verifica Totem NON richiede Profilo verificato
  ✅ Totem può essere inviato anche senza profilo verificato, ma: “Contenuto autentico” è attivabile solo se profilo verificato + totem approvato
  UI deve avvisare chiaramente che il Totem verrà finalizzato dopo l’approvazione del profilo (no reinvio richiesto), (Non cambiamo il resto: restano due verifiche separate e indipendenti come upload, ma con prerequisito logico per l’effetto “autentico”).
  Un utente può avere: solo profilo verificato, solo totem verificato, entrambi, nessuno
  4️⃣ Flusso utente
  Sezione Verifiche nel profilo con 2 card separate: Verifica Profilo, Verifica Totem
  Ogni card ha: stato (none / pending / approved / rejected), azione dedicata, reinvio possibile in caso di rifiuto
  5️⃣ Flusso admin + notifiche
  Stessa logica già usata per ADV / Vetrina: Stati, pending, approved, rejected
  Rifiuto, motivazione obbligatoria, salvata solo in Notification, nessun campo persistente sul User
  Tipi notifica
  SYSTEM_PROFILE_VERIFICATION_APPROVED
  SYSTEM_PROFILE_VERIFICATION_REJECTED
  SYSTEM_TOTEM_VERIFICATION_APPROVED
  SYSTEM_TOTEM_VERIFICATION_REJECTED
  6️⃣ UI / UX (frontend)
  Badge distinti: “Profilo verificato”, “Contenuto autentico” (solo sui post che mostrano il totem)
  Nessuna confusione tra le due cose, Totem mai esposto all’utente finale.
  Stato finale, ✔ Concetto corretto, Separazione netta e sensata, Scalabile per IA futura, Coerente con sicurezza, moderazione e monetizzazione

TOKEN (Concept definitivo, pronto implementazione)
  1) Principio Fondamentale
  Su NestX tutte le operazioni economiche avvengono solo tramite token. Nessun pagamento diretto in euro per feature interne (VIP, eventi, cam, contenuti, ADV, vetrina, ecc.).
  L’euro esiste solo come acquisto token tramite provider esterno (es. Stripe) e, in futuro, come payout ai creator verificati.
  2) Token = Unità interna unica
  I token sono crediti della piattaforma e vengono usati per: Tip / donazioni durante live e cam (feature attiva subito), Acquisto ticket eventi (pubblici o privati), Acquisto contenuti / sblocco accessi (foto/video/file/feature) tramite sistema generico (anche se alcune feature sono future)
  ADV / Vetrina (creazione e/o pubblicazione, incluse eventuali opzioni “paid”), Status e feature account (es. VIP / TapeVIP / upgrade futuri) pagati in token, Qualsiasi altra funzione monetizzata futura (architettura già pronta)
  3) Ledger e tracciamento transazioni (obbligatorio), Ogni movimento token genera una TokenTransaction (registro unico e auditabile).
  Campi minimi: kind (purchase, transfer, ticket_purchase, ticket_refund, … + estensioni future), direction (credit/debit), context (system, tip, donation, cam, content, ticket, other)
  fromUserId, toUserId, amountTokens, amountEuro (se rilevante), eventId/scope/roomId, metadata
  Il saldo utente è rappresentato da: tokenBalance (spendibili), tokenEarnings (accumulati come guadagno creator, non sempre spendibili)
  4) Pagamenti interni: rotta unica “Purchase”
  Si adotta una rotta generica per acquistare/sbloccare “qualsiasi cosa” con token.
  Concetto: una sola rotta gestisce importi variabili e target diversi.
  Input concettuale: purchaseType (vip, content, file, feature, adv_paid, vetrina_paid, …)
  targetId opzionale (id contenuto/oggetto/risorsa), amountTokens (variabile in base al tipo)
  La rotta: valida saldo token, scala token, scrive TokenTransaction, applica l’effetto (es. set VIP, sblocco contenuto, attiva feature), VIP / TapeVIP: lo status si acquista tramite questa rotta pagando token.
  5) Tip live/cam (attivo subito)
  Le cam saranno spesso gratuite: la monetizzazione principale è tramite tip in token.
  Il tip è un trasferimento token user → creator con tracciamento in TokenTransaction.
  Nessun ticket obbligatorio per cam gratuite.
  6) Eventi e Ticket (coerenza)
  Acquisto ticket evento: pagamento in token, tracciato in TokenTransaction (ticket_purchase).
  Rimborso ticket (solo casi previsti): restituzione token, tracciata (ticket_refund).
  Rimborsi sempre in token (no euro).
  7) ADV e Vetrina (coerenza token)
  ADV/Vetrina possono essere: free, paid (token), Qualsiasi spesa paid genera TokenTransaction.
  Moderazione e approvazione restano manuali admin (token ≠ approvazione).
  8) Payout Creator (fase attiva ma regole già definite)
  Solo utenti idonei/creator verificati possono richiedere payout (future o già parzialmente stub).
  Regole concept, Min payout: esiste una soglia minima (in token equivalente) sotto cui non si può prelevare (accumulo).
  Max payout: esiste un tetto massimo mensile per motivi antifrode/contabilità (oltre → payout in tranche).
  Finestra temporale: i payout devono essere richiesti entro un termine (es. 12 mesi) per chiusura contabile; oltre → gestione/valutazione manuale.
  Opzione futura: payout sotto minimo con fee (non implementata ora; preferenza: no payout sotto minimo).
  9) Valore in euro dei token
  Il backend ragiona sempre in token. Il “prezzo in euro” è una scelta di business (pacchetti) e può essere definita/aggiornata senza cambiare la logica interna token. La UI può mostrare pacchetti token e prezzi, ma NestX non dipende da una conversione fissa “1 token = X€”.

Video di verifica

🔹 15. Sezione Centrale
  Questa è la zona relativa al profilo, composta dalla parte altra con immagine di copertina e immagine di profilo con bage lampeggiante per sezione live. 
  Sotto sezione descrizione utente con displayName, bio (deswcrizione user), area (zona geografica, nazione, città), profileType (genere, se uomo, donna, coppia ecc.), varie.
  Sempre nello stesso riquadro, pulsante segui/smetti di seguire, invia/annulla richiesta ad utente privato, accanto a questo 3 puntini verticale per inviare messaggio, bloccare, silenziare e segnalare.
  Sotto sezione relativa a propri post, post degli utenti seguiti, old-live.
  Sezione post contiene in alto pubblica post, poi evento live che viene creato e visualizzato in questa sezione fino a max 48 ore prima e scompare al termine della live, sotto i post dell'utente in ordine di pubblicazione, il più recente in alto.
  Sezione seguiti, qui compaiono post di chiseguo e gli eventi dei seguiti e gli ADV esterni (questi verranno mostrati ogni tot post) l'ordine è in funzione della pubblicazione.
- OLD-LIVE
  è una sezione dedicata alle live concluse, visibile solo entrando nel profilo dell’utente.
  Non è una pagina globale con ricerca, Mostra al massimo 10 live, Ordinamento basato su performance reale della live, non su like o click.
  Metrica di riferimento: spettatori medi normalizzati sulla durata della live, spettatori / (fine live − inizio live)
  (implementazione tecnica da definire in base ai dati disponibili: avg, peak, sample, ecc.)
  Nessuna distinzione concettuale tra: evento, ADV, live “semplice”, in Old-Live compare la card, esattamente come nel feed (una sola card, non duplicata).
  Old-Live esiste solo per le live, perché: la live sparisce, ma la sua performance resta storicamente rilevante
  La visuale della sezione centrale canbia a seconda di cosa guardo, mio profilo o profilo altrui.
- Mio profilo, come indicato in descrizione generale, mancheranno bottone segui e i 3 puntini.
- Profilo altrui, come indicato in descrizione generale, mancherà sezione seguiti.

🔹Regola ADV/Eventi nei “Seguiti” (cronologico + temporaneo)
  Nei Seguiti, ADV/Eventi (card promozionali / eventi schedulati / live dei creator seguiti) non compaiono tutti in alto e non creano una sezione separata: vengono trattati come contenuti del feed e si inseriscono in ordine cronologico insieme ai post (post → ADV/evento → post → post …).
  Nel profilo del creator, invece, se il creator ha un evento/ADV attivo o programmato, questo compare in cima al suo profilo sopra i post finché è rilevante.
  A fine evento/fine live/scadenza ADV, la card scompare (non resta persistente). Lo storico resta solo in Old Live (max 10), ordinato per valore (spettatori × durata).

🔹 16. Sezione DX
  Sezione dedicata alla piattaformam con:
  Feed consigliati, in funzione degli interessi, ADV di pubblicità internem (eventi con ADV create dagli utenti) Gli ADV interni (promozioni di eventi/live create dai creator) non sono bloccabili completamente.
  La loro visibilità è regolata tramite l’impostazione “Contesto contenuti” (Standard / Neutro / Live & Eventi), che influisce sulla priorità e sulla presenza visiva, ma non garantisce la rimozione totale degli ADV, soprattutto se a pagamento.
  Alcune promozioni possono restare sempre visibili per garantire coerenza con la monetizzazione della piattaforma. Successivamente la vetrina per chi vuole esporre propri prodotti (rivolto agli amanti del fai da te).

FED — Definitivo (con decisioni chiuse), Decisioni chiuse (le tue)
  Mute = SÌ → se un profilo è mutato, sparisce anche dal FED (post esclusi).
  Self posts = NO → nel FED non mostriamo i post dell’utente stesso.
  Matching interessi → usa anche gli interessi del profilo (oltre ai campi interessi dedicati al feed).
  E conferma fondamentale: VIP non è accountType → VIP = isVip boolean. (accountType resta base|creator|admin)
  1) Input FED (ordine e priorità)
  FED legge:
  A) Interessi “feed”, Base: user.interestsBase, VIP: user.interestsVip (manuali → priorità più alta)
  B) Interessi “profilo”, user.interests (profilo generale).
  Regola definitiva di priorità:
  Se isVip === true e interestsVip non vuoto → usa interestsVip come base + fallback con interests
  Altrimenti → usa interestsBase + fallback con interests
  Se tutti vuoti → fallback trending
  👉 In pratica: interestsVip/base sono “driver”, interests è “supporto”.
  2) Contesto contenuti (priorità, NON filtro)
  user.appSettings.contentContext (standard|neutral|live_events) è un moltiplicatore nel ranking, non blocca nulla.
  standard: neutro
  neutral: penalizza segnali “live/event/cam”
  live_events: favorisce segnali “live/event”
  Applicazione nella v1:
  solo su tags/keyword (perché non abbiamo ancora categorie IA del Post)
  3) Cosa ritorna FED
  FED ritorna solo Post (non Event), perché:
  Eventi nei seguiti sono già gestiti da following-mixed
  la colonna destra in futuro userà FED + ADV + Vetrina, ma FED resta “post consigliati”
  Response include meta:
  mode: vip_manual | base_interests | fallback_trending
  usedInterests: [...]
  contentContext: ...
  4) Esclusioni obbligatorie (hard rules)
  FED esclude sempre:
  utenti bloccati (block)
  utenti mutati (mute) ✅ (decisione tua)
  post non visibili (visibility/privacy)
  post dell’utente stesso ✅ (decisione tua)
  5) Matching interessi: come lo facciamo nella v1 (pulito)
  V1 = tags-first, con supporto interessi profilo.
  Se Post.tags esiste: match su tags
  Se non basta (pochi risultati): fallback su testo (text) solo come riempimento, non come base ranking
  Questo tiene il sistema: semplice, controllabile, non “random”

ADV (NestX)
  1️⃣ Tipologie di ADV
  🔹 ADV interni creati dai creator per promuovere: live, eventi, contenuti o prodotti interni alla piattaforma. Non espliciti (niente nudità, niente volgarità), Moderati (approvati / rifiutati dallo staff)
  🔹 ADV esterni Inserzioni della piattaforma (non del singolo creator), Mostrati nei feed centrali (Profilo / Seguiti), Non bloccabili, Servono alla sostenibilità economica della piattaforma
  2️⃣ ADV nei feed dei SEGUITI (regola chiave)
  Quando un creator seguito: crea un ADV, crea un evento, programma una live
  L’ADV / evento NON viene messo fisso in alto, viene trattato come contenuto del feed, è mischiato ai post, segue l’ordine cronologico, esempio: post → ADV/evento → post → post → ADV/evento
  📌 Obiettivo: evitare spam, feed naturale, monetizzazione non aggressiva
  3️⃣ ADV nel profilo del CREATOR
  Se il creator ha: un ADV attivo, un evento programmato, una live in corso, quell’ADV / evento compare in cima al SUO profilo, sopra ai post, è temporaneo, dura solo finché l’evento/ADV è rilevante, scompare automaticamente a fine evento / fine ADV
  4️⃣ Fine ADV / Eventi
  Quando: l’evento termina, la live finisce, l’ADV scade, l’ADV NON resta persistente, NON diventa storico.
  Lo storico vive solo in: Old Live (max 10), ordinati per valore (spettatori × durata)
  5️⃣ ADV esterni — stato ATTUALE
  Sempre visibili, Non disabilitabili, Mostrati ogni tot post nel feed centrale
  Stato concreto oggi: VIP → 1 ADV esterno ogni 25 post (già implementato), Tutto il resto (Premium, Premium+)
  6️⃣ ADV lato DESTRO (colonna DX)
  Gli ADV interni nella colonna destra: NON possono essere spenti, NON hanno toggle ON/OFF.
  La loro visibilità è regolata solo da: Impostazione “Contesto contenuti”, Standard, Neutro
  Live & Eventi
  Questa impostazione: influisce su priorità / presenza visiva, non garantisce la rimozione totale
  alcune promozioni possono restare visibili (specie se pagate)
  7️⃣ Principi guida (bloccati)
  ❌ Nessun ADV fisso e permanente nel feed, Nessun “nascondi tutto”, 
  ✔ ADV temporanei e contestuali, Feed naturale, non forzato, Monetizzazione sostenibile ma non invasiva
  8️⃣ Limiti giornalieri e monetizzazione ADV interni
  Ogni creator può creare: 2 ADV gratuiti al giorno, Dal 3° ADV nello stesso giorno, l’ADV diventa a pagamento
  Caratteristiche ADV a pagamento: costo: 10 token, nessun pagamento in fase di creazione, il pagamento avviene solo in fase di approvazione admin, Conferma utente obbligatoria.
  Quando l’utente tenta di creare un ADV a pagamento: se token < 10 → errore bloccante (INSUFFICIENT_TOKENS), se token ≥ 10 → richiesta conferma esplicita UI (“Questo ADV è a pagamento (10 token). Vuoi procedere?”), Senza conferma, l’ADV non viene creato.
  L'accetazione o il rifiuto dell'admin alla pubblicazione dell'ADV invia notifica all'utente.

VETRINA — CONCEPT DEFINITIVO (Settore DX)
  La Vetrina è un blocco della colonna destra (NestX) dedicato all’esposizione di creazioni reali (fai-da-te, hobbistica, oggetti artigianali).
  Non è e-commerce e non è ADV: è esposizione qualificata.
  Accesso Solo utenti VIP, Utenti Base esclusi, Creator non rilevante (nessun privilegio specifico)
  Regole di pubblicazione: Ogni VIP può avere massimo 2 prodotti attivi gratuiti, Durata di ogni prodotto: 7 giorni, Alla scadenza il prodotto scompare automaticamente, Nessun archivio pubblico, nessuna cronologia.
  Monetizzazione
  Oltre i 2 slot gratuiti: slot extra a pagamento, costo: 30 token, durata: 7 giorni, Prezzo in token fissato, conversione € da definire a fine progetto.
  Posizionamento UI, Ordine colonna destra: FED, ADV, VETRINA.
  Note di design, Contenuto statico e curato (immagini + descrizione), Rotazione naturale, niente inflazione, Strutturalmente simile agli ADV, con tempistiche diverse

🔹 17. Sicurezza e Legalità
  L'attenzione sui minore deve essere massima e prioritaria IA segnala e oscura (non banna), l'admin dietro segnalazione IA o proprio controllo decide il Ban dalla piattaforma.
  Non sono ammesse violenza o contenuti vietati, istigazione all'odio, proselitismo, qualsiasi comportamento o contenuto non etico sarà segnalato, bloccato e nel caso ban dell'utente.
  La sicurezza sui contenuti prevede il blocco del tasto destro del mous, sistema anti-plagio mediante video di verifica con totem, verifica dell’utente tramite video silhouette con foglio.

🔹 18. Ruolo dell’Admin
  L’admin non è un automa e non è un semplice moderatore.
  È l’arbitro finale su: monetizzazione, rimborsi, violazioni, affidabilità dei creator, Nessuna decisione economica critica è automatica.
  1️⃣Ambito di Intervento Admin
  L’admin interviene solo nei casi sensibili, in particolare: 
  🔹 A) Refund manuali (Token), Nessun rimborso automatico, I rimborsi avvengono solo su richiesta,
  Decisione 100% manuale, Ogni rimborso è tracciato, genera TokenTransaction dedicata è auditabile.
  Motivo: evitare abusi, exploit e contestazioni automatiche.
  🔹 B) Eventi chiusi anticipatamente, Caso tipico:
  evento avviato (go-live), utenti entrati e pagato, evento chiuso subito dopo, Nessun rimborso automatico
  L’utente può segnalare, richiedere refund, L’admin valuta caso per caso.
  2️⃣Indicatori di Supporto alla Decisione (NON AUTOMATICI)
  Il sistema fornisce dati, ma non decide.
  Indicatori disponibili (già o futuri):
  durata reale dell’evento, numero utenti entrati, ticket venduti, token incassati, flag evento (no-show, early end, late start…), storico segnalazioni, storico refund del creator, pattern sospetti (futuro), Servono solo come supporto visivo per l’admin.
  3️⃣Verifica Creator (Stripe + Piattaforma)
  Il creator è valido solo se: Stripe abilita il payout, l’admin non lo disabilita manualmente
  Possibili stati: eligible (Stripe OK), enabled (admin OK), disabled (admin kill-switch), L’admin può bloccare monetizzazione anche se Stripe è OK.
  4️⃣Segnalazioni & Violazioni
  L’IA segnala e oscura, non banna, L’admin vede segnalazioni, e decide se de oscurare o se necessario limitare o bannare. Nessun ban automatico.
  5️⃣Filosofia di Fondo (IMPORTANTISSIMO)
  ❌ Nessun automatismo per soldi, Nessun refund temporale rigido, Nessuna punizione automatica
  ✔️ Decisione umana, Tracciamento totale, Sistema antifrode by design
  6️⃣ Stato Implementativo Attuale
  ✔️ Modelli pronti, TokenTransaction centralizza tutto, Refund manuale funzionante, Stripe collegato, Admin già riconosciuto via accountType

INSERIMENTO IA
  l'IA avrà il compito fondamentale di controllo iniziale e proposta con verifica decisionale da parte dell'admin, seccessivamente verificata l'affidabilità avrà anche compito decisionale almeno su alcuni aspetti. L'IA agirà su registrazione account, per verifica età e immagine profilo, sui post (tutti i contenuti) per verifica con policy piattaforma, su live con verifica utente in live e chat in entrambe le direzioni, ADV che siano conformi a policy, chat private (messaggistica).

INFO DI SISTEMA PER UTENTE
  Indispensabile da fare prima del lancio

MESSAGGI PAGINE VUOTE
  Empty States (pagine vuote):
  In ogni sezione principale, se non ci sono contenuti (feed/post/live/vetrina ecc.), viene mostrato un messaggio breve che spiega cosa contiene la sezione e invita all’azione (CTA).
  Il messaggio scompare automaticamente appena la sezione contiene almeno un elemento.

ADMIN, IA, MODERAZIONE & SICUREZZA (Versione chiusa – pronta per implementazione)
  1️⃣ Principio Fondamentale
  NestX è una piattaforma hard-first, orientata a contenuti sessuali tra adulti consenzienti.
  La moderazione non ha scopi morali, ma legali, di sicurezza e di tutela della piattaforma.
  Su NestX il sesso non è il problema. Il problema è l’illegalità: minori, abuso, coercizione, sfruttamento.
  2️⃣ Ruolo dell’Admin
  L’admin è l’arbitro finale. Nessun ban, Nessuna limitazione account, Nessun rimborso, Nessuna decisione economica, avviene in modo automatico.
  👉 L’IA propone
  👉 L’admin decide
  3️⃣ Ruolo dell’IA (Intelligenza Artificiale)
  L’IA in NestX: analizza contenuti, individua pattern sospetti, classifica la gravità, propone azioni
  raccoglie evidenze solo quando necessario, L’IA non: banna, chiude live, prende decisioni, irreversibili, gestisce pagamenti, sorveglia sistematicamente i messaggi privati
  4️⃣ Ambiti di Intervento IA
  A) Contenuti STATICI (analisi preventiva)
  Contenuti statici: Post, Commenti, Avatar / cover / bio, ADV, Vetrina, Titoli e descrizioni eventi
  Media caricati (foto / video), L’IA può oscurare temporaneamente questi contenuti.
  B) Contenuti LIVE (monitoraggio)
  Contenuti live: Video live, Audio live, Chat live
  👉 L’IA: NON spegne mai la live, NON banna, NON interrompe automaticamente
  👉 Può: segnalare all’admin, raccogliere evidenze limitate in caso di violazioni gravi
  C) Messaggi Privati (DM)
  DM = chat private 1-to-1. Regola definitiva: 
  ❌ Nessuna scansione sistematica
  ✅ Analisi IA solo su messaggi segnalati, Accessi admin tracciati e auditabili
  5️⃣ Classificazione delle Violazioni
  🔴 GRAVISSIMO (illegale)
  Minori (reali o simulati), Pedopornografia / grooming, Violenza reale estrema, Revenge porn, Armi illegali / terrorismo, Tratta di esseri umani, Bestialità.
  Azioni
  Statici → auto-hide immediato
  Live → raccolta evidenze + alert admin
  Nessun ripristino automatico
  🟠 GRAVE (reversibile)
  Contenuti sessuali tra adulti, ma con: ambiguità di età, simulazione minorile, age-play borderline,
  violenza simulata senza consenso chiaro, contesto sessuale + hate / abuso
  Azioni
  auto-hide temporaneo (statici)
  segnalazione admin
  possibile ripristino dopo valutazione
  🟡 CONSENTITO
  Sempre permessi su NestX: nudità, porno esplicito, sesso consensuale tra adulti, fetish / kink / BDSM consensuali, cam hard
  Nessun intervento IA
  6️⃣ ADV (Pubblicità)
  ADV non espliciti, Nudità sempre mascherata, ADV sempre pending, Approvazione manuale admin obbligatoria
  L’IA funge solo da filtro preliminare, non da decisore.
  7️⃣ Analisi Linguistica & Dizionario Sensibile
  NestX adotta un sistema di analisi linguistica preventiva basato su: parole, alias, pattern, combinazioni contestuali, Esempi: Y17, IR16, 18yo, young / teen, father / daughter / sister / mom
  combinazioni ambigue
  Il dizionario: è espandibile, è gestito dall’admin, non richiede modifiche al codice
  8️⃣ Ricerca Interna (Politica Dura)
  Se una ricerca contiene pattern legati a: minori, sessualità borderline, relazioni familiari a sfondo sessuale
  Il sistema: blocca la ricerca, non restituisce risultati, mostra un messaggio forte e dissuasivo
  Messaggio:
  NESTX applica una politica di tolleranza zero verso pedofilia, sfruttamento di minori e contenuti sessuali borderline. La ricerca effettuata non è consentita.
  Comportamenti di questo tipo possono portare a limitazioni dell’account e, nei casi previsti dalla legge, a segnalazioni alle autorità competenti.
  Nessuna segnalazione automatica, Nessun ban automatico
  9️⃣ Evidenze LIVE (raccolta limitata)
  In caso di GRAVE o GRAVISSIMO, l’IA può salvare: screenshot, clip video brevi (5–20 sec max), trascrizione audio, traduzione automatica, ❌ No registrazione continua, No archivio completo live
  Finalità: valutazione admin, tutela legale, prevenzione recidive
  🔟 Storico Affidabilità Account
  NestX mantiene uno storico per account basato solo su violazioni confermate.
  Entrano nello storico: segnalazioni confermate da admin, rifiuti ADV/Vetrina per motivi gravi, violazioni live accertate, tentativi underage ripetuti, ricerche proibite reiterate
  ❌ Segnalazioni respinte NON entrano nello storico.
  1️⃣1️⃣ Soglie di Recidiva
  🟢 OK
  0 segnalazioni o 1 evento minore isolato
  🟡 ATTENZIONE
  2 segnalazioni confermate oppure 1 GRAVE
  Azioni: priorità IA aumentata, warning visibile admin
  🟠 CRITICO
  3 segnalazioni oppure 2 GRAVI oppure recidiva stessa categoria
  Azioni: limitazioni possibili (manuali), verifica aggiuntiva
  🔴 BLOCCO (manuale)
  1 GRAVISSIMO confermato oppure recidiva deliberata
  Azioni: ban manuale, valutazione segnalazione autorità
  1️⃣2️⃣ IA e Affidabilità
  L’IA non scrive nello storico, Solo l’admin conferma → storico, Ogni decisione contribuisce a un punteggio di affidabilità IA, In futuro possibile delega limitata, mai totale.
  ✅ STATO Concept Admin + IA: DEFINITIVO, COERENTE, PRONTO PER BACKEND