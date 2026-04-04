MEMO FRONTEND — Age Gate & Minori (NestX)
1️⃣ Registrazione (Register)

Campi obbligatori

email

password

displayName

dateOfBirth (formato stringa YYYY-MM-DD)

Comportamento

Se dateOfBirth indica età < 18:

backend risponde 403

messaggio:
“Il sito non è autorizzato ai minorenni.”

Nessun blocco email permanente:

l’utente può correggere la data e riprovare.

Nota UI

Non mostrare messaggi tecnici

Messaggio secco, chiaro, definitivo

2️⃣ Login

Response backend

{
  "status": "ok",
  "token": "...",
  "needsAdultConsent": true | false,
  "user": { ... }
}


Logica frontend

Se needsAdultConsent === true:

NON caricare feed, profilo, post, live

mostrare subito il modal age gate

Se false:

accesso normale alla piattaforma

3️⃣ Age Gate Modal (OBBLIGATORIO)

Testo minimo consigliato

“Confermo di avere almeno 18 anni e di voler accedere a contenuti potenzialmente sensibili.”

Azioni

✅ Accetto

❌ Esco

Comportamento

❌ Rifiuto → logout / redirect fuori piattaforma

✅ Accetto → chiamata endpoint:

POST /api/auth/adult-consent
Authorization: Bearer <token>

4️⃣ Dopo accettazione

Backend salva adultConsentAt

Frontend:

rimuove modal

carica tutta la piattaforma

Da quel momento:

l’age gate non viene più mostrato

5️⃣ Hard Block Backend (da conoscere lato frontend)

Se l’utente non ha ancora accettato:

Qualsiasi chiamata API protetta → 403

{
  "code": "ADULT_CONSENT_REQUIRED"
}


Frontend

Non tentare retry

Mostrare modal age gate

Nessuna schermata intermedia

6️⃣ Stato utente (non visibile all’utente)

dateOfBirth: salvata come Date (solo backend)

adultConsentAt: timestamp consenso

Log tentativi underage non esposto al frontend

7️⃣ UX rule fondamentale

⚠️ L’utente non deve mai vedere contenuti prima dell’accettazione.

Niente feed parziale

Niente post

Niente profili

Niente preload immagini

👉 o age gate, o nulla

✅ Stato

✔️ Flusso definito

✔️ Coerente con backend

✔️ Legalmente difendibile

✔️ Pronto per implementazione frontend