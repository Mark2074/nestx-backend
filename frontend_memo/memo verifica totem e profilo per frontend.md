MEMO FRONTEND — Sezione Verifiche (definitivo)
Dove sta

Profilo → Verifiche (pagina unica) con 2 card separate:

Verifica Profilo

Verifica Totem

1) Card “Verifica Profilo” (IDENTITÀ / COERENZA)
Dati da mostrare

Stato: none | pending | approved | rejected

Se approved: mostra badge “Profilo verificato”

Azioni UI

none → pulsante Invia verifica profilo

pending → nessun reinvio, mostra “In revisione”

rejected → pulsante Reinvia verifica profilo

approved → stato bloccato (opzionale: “Verificato”)

Invio (form)

campo URL video (per ora, perché non stiamo uploadando file)

hint testo: “Video pubblico (sul profilo solo se approvato) con foglio: NestX + username + data, silhouette corpo (non erotico).”

Visibilità video

Il video profilo è visibile nel profilo pubblico solo se approved.

2) Card “Verifica Totem” (AUTENTICITÀ CONTENUTI)
Dati da mostrare

Stato: none | pending | approved | rejected

(In card) mai mostrare il video o dettagli sensibili, solo stato.

Azioni UI

none → pulsante Invia verifica Totem

pending → nessun reinvio, mostra “In revisione”

rejected → pulsante Reinvia verifica Totem

approved → stato bloccato (opzionale: “Totem verificato”)

Invio (form)

campo URL video totem

campo descrizione totem (testo libero)

hint testo: “Video privato per staff/IA. Contiene le stesse cose della verifica profilo + il tuo Totem.”

Nota UX obbligatoria (anti “fregatura”)

Se l’utente invia Totem ma Profilo non è approved, mostra subito questa info in card (e/o toast):

“Totem ricevuto. La verifica Totem verrà completata solo dopo la verifica del profilo. Non devi reinviare il Totem.”

(Questo è solo UI: nessun blocco backend.)

3) Badge sui contenuti (post/media)
“Profilo verificato”

Mostrato se: verificationStatus === "approved" (o verifiedUser === true)

“Contenuto autentico”

Mostrato solo se:

verificationStatus === "approved" e

verificationTotemStatus === "approved" e

il contenuto è marcato come “totemDetected=true” (da IA/staff in futuro)

📌 Per ora: la UI deve essere pronta, ma la detection può essere “futura”.

4) Reinvii (regola chiara)

pending → niente reinvio (per entrambe)

rejected → reinvio permesso

none → invio permesso

5) Notifiche (dove le vede l’utente)

Le notifiche di esito vanno nella Inbox Notifiche (sezione notifiche), non nella pagina verifiche.
La pagina verifiche legge solo gli stati dal profilo.

Tipi:

SYSTEM_PROFILE_VERIFICATION_APPROVED / REJECTED

SYSTEM_TOTEM_VERIFICATION_APPROVED / REJECTED