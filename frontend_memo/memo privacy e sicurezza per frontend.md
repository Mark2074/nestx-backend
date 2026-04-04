Frontend — Privacy & Sicurezza (memo definitivo)
1) Toggle “Account privato”

Campo: User.isPrivate (boolean)

UI: switch “Account privato”

Salvataggio: PUT /api/profile/update con body:

{ "isPrivate": true }


oppure

{ "isPrivate": false }


Effetto:

true → follow diventa a richiesta (pending)

false → follow immediato (accepted)

2) Cambio password (Sicurezza account)

UI: form con 2 input:

currentPassword

newPassword (min 8)

Call:

POST /api/auth/change-password

Header: Authorization: Bearer <token>

Body:

{ "currentPassword": "...", "newPassword": "........" }


Successo: mostra toast “Password aggiornata”

Nota UX: dopo change-password tutti i token vengono revocati → il frontend deve fare:

logout locale (clear token) + redirect login

3) Logout da tutti i dispositivi

UI: bottone “Logout da tutti i dispositivi”

Call:

POST /api/auth/logout-all

Header: Authorization: Bearer <token>

Successo: toast “Logout globale eseguito”

Subito dopo: clear token + redirect login

Nota tecnica: backend usa tokenVersion, quindi dopo la chiamata il token corrente diventa invalido.

4) Utenti bloccati (lista + sblocca)

Pagina: “Utenti bloccati”

Call lista:

GET /api/block/me

Header auth

Response: lista con campi tipo:

id, displayName, profileType, avatar (se presente), blockedAt

email non deve comparire

Azione “Sblocca”:

DELETE /api/block/:id

5) Utenti silenziati (lista + unmute)

Pagina: “Utenti silenziati”

Call lista:

GET /api/mute

Header auth

Response: array di userId mutati:

["id1","id2"]


Per mostrare nome/avatar: il frontend deve risolvere i dettagli utente con una call profilo per ogni id (soluzione rapida) oppure endpoint aggregato (futuro).

Azione “Rimuovi silenzio”:

DELETE /api/mute/:targetUserId

6) Info-only (nessuna call qui)

“Limiti chat”:

Base: 10 msg/giorno

VIP: 100 msg/giorno

“Permessi CAM/LIVE” solo informativo (nessuna modifica)

7) Gestione errori privacy (utile UI)

Se si tenta di aprire profilo privato non autorizzati:

GET /api/profile/public/:id può tornare:

403 con code: "PROFILE_PRIVATE"

UI: mostra schermata “Profilo privato — invia richiesta di follow”.

Esclusioni confermate (non in questa sezione)

Token/pagamenti, ADV/eventi/vetrina, old-live, verifica profilo/creator, preferenze feed/interessi.