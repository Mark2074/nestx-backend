integrazione ore live e token ricevuti, solo per creator come visualizzazione semplice

in sezione PROFILO (Profile → Verification/Manage). aggiungere richiesta di approvazione creator

MEMO IMPLEMENTAZIONE — “Become a Creator” (Phase 1)
1) Posizionamento UI (vincolante)
A) Profile (principale)

Percorso: Profile → Verification/Manage
Blocchi da aggiungere:

Creator / Payout

titolo: “Become a creator” (se non creator)

descrizione breve: “Creators can receive tokens and request payouts after verification.”

bottone primario:

“Start payout onboarding” (apre Stripe onboarding)

Stati possibili (UI):

Not creator / not started → mostra bottone onboarding

Onboarding pending → “Onboarding in progress” + bottone “Continue onboarding”

Provider ready ma non approvato admin → “Waiting for approval”

Approved → “Creator active” + link a Payout (Tokens)

✅ Questo è il punto unico “vero” per diventare creator.

B) Tokens → Payout (solo rimando)

Nel blocco Payout, se eligibility.code === NOT_CREATOR:

CTA: “Become a creator” → link a Profile → Verification/Manage
(se provider non pronto: CTA “Complete onboarding” → link stesso)

2) Backend (minimo indispensabile)
A) Start onboarding (nuova rotta)

POST /api/payout/provider/onboarding/start (auth)

genera URL onboarding provider (Stripe)

salva/aggiorna dati in payoutProvider + payoutStatus (pending)

response:

{ "status": "ok", "data": { "url": "https://..." } }

B) Continue onboarding (stessa rotta)

La stessa rotta può ritornare un nuovo link se già pending.

C) Webhook provider (già o da fare)

Aggiorna payoutStatus e/o payoutProvider.status a ready quando Stripe completa.

D) Admin approval (già deciso)

Admin può approvare creator solo dopo provider ready.

3) Flusso utente (Phase 1)

Utente va su Profile → Verification/Manage

Click Start payout onboarding

Redirect Stripe

Ritorno su NestX (success/cancel URL)

Profile mostra:

se non ready: “Onboarding in progress”

se ready: “Waiting for approval”

se approvato: “Creator active”

4) Checklist frontend

In Profile:

chiamare GET /api/payout/me/eligibility per decidere stato/CTA

su click: POST /api/payout/provider/onboarding/start → redirect a url

In Tokens/Payout:

se NOT_CREATOR / NOT_VERIFIED / PROVIDER_NOT_READY → mostra CTA che porta a Profile (o avvia onboarding se preferisci farlo anche qui, ma meglio solo rimando)