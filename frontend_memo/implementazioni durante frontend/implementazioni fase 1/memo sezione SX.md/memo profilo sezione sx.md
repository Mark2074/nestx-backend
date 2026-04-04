✅ MEMO DEFINITIVO — SEZIONE PROFILE (FASE 1)
1) Sidebar SX (vincolante)

Profile → apre Profile Editor

Nessuna voce separata “Verification” in SX

SX resta flat, 1 livello

2) Profile Editor (/profile)

Scopo: modifica dati del profilo loggato.

Dati letti

avatar

coverImage

displayName

bio (max 500)

area

profileType

interests

language (primaria)

languages[] (extra)

Badge read-only: VIP / Creator / profileVerificationStatus

Dati modificabili (whitelist)

avatar

coverImage

displayName

bio

area

profileType

interests

language (obbligatoria)

languages[] (max 5, non include language)

Validazioni UI

language obbligatoria

languages[] ≠ language

codici brevi (it, en, …)

errori chiari inline + toast

3) Connections (/profile/connections)

Scopo: navigazione rapida, non gestione conflitti.

Following

Lista profili seguiti

Click → profilo pubblico

Azione: Unfollow

Followers

Lista profili che seguono l’utente

Click → profilo pubblico

❌ Requests

NON presenti

Gestione richieste solo via Notifications

Azione: Accept

Nessun Reject UI

4) Verification (NestX) — Fase 1 inclusa

Accesso: dentro Profile (tab/section), non in SX

4.1 Profile verification (utente reale)

Video 5–10s, max 15s

Foglio scritto a mano con:

username

data

scritta NestX

Stato: not_submitted | pending | approved | rejected

Upload / Resubmit

Notifica admin + notifica utente su esito

4.2 Totem verification

Disponibile solo se profile verification = approved

Video con oggetto totem

Stato indipendente

Mai pubblico

5) Profilo pubblico — Badge verifica

Quando un utente visita un profilo:

Se profileVerificationStatus === "approved":

Mostra icona spunta in cerchio ✔️

Tooltip: Verified profile

Click → modal con video pubblico

Video pubblico

Fonte: verificationPublicVideoUrl

Autoplay ON

No loop

Controlli minimi

Risoluzione media (es. 720p)

Obiettivo: vedere chiaramente il foglio

Regole

Totem mai pubblico

Nessuna indicazione se pending/rejected

✅ ADDENDUM — Creator / Payout Onboarding (Phase 1, dentro Profile)
6) Creator / Payout (Phase 1 inclusa)

Accesso: dentro Profile Editor (/profile) come tab/section (es. “Creator”)
Nessuna voce SX aggiuntiva.

Scopo: permettere all’utente di avviare l’onboarding payout (Stripe) per diventare creator solo tramite provider, e poi attendere approvazione admin (rule già vincolata).

6.1 UI / Stati (tutti in inglese)

La sezione mostra sempre un box “Creator & Payout” con stato e CTA.

Dati letti (minimo)

GET /api/payout/me/eligibility → data.ok, data.code, (eventuali extra)

Stati / CTA

Se code === "NOT_CREATOR"

testo: “Payout is not available.”

CTA primario: “Become a creator” (avvia onboarding payout)

Se code === "PAYOUT_PROVIDER_NOT_READY"

testo: “Complete payout onboarding.”

CTA primario: “Continue onboarding”

Se code === "PAYOUT_NOT_VERIFIED"

testo: “Complete verification to enable payouts.”

CTA primario: “Complete verification” → scroll/anchor alla sezione Verification NestX (punto 4)

Se code indica attesa approvazione admin (se esiste nel tuo elig)

testo: “Waiting for approval.”

CTA: none

Se data.ok === true

testo: “Payout available.”

CTA: “Go to Tokens → Payout” (link a /tokens)

⚠️ Nota: non nominare Stripe nei testi UI.

6.2 Azione onboarding (backend richiesto)

Serve una rotta per ottenere l’URL onboarding provider:

POST /api/payout/provider/onboarding/start (auth)

return:

{ "status": "ok", "data": { "url": "https://..." } }


Frontend:

al click CTA (Become/Continue onboarding) → chiama endpoint → redirect a url.

6.3 Integrazione con Tokens page (solo rimando)

Nella pagina /tokens, nel blocco Payout (locked):

se NOT_CREATOR o PAYOUT_PROVIDER_NOT_READY o PAYOUT_NOT_VERIFIED

CTA: “Go to Profile” → /profile (anchor “Creator & Payout”)

Nessun flusso creator dentro Tokens: Tokens resta wallet.

6.4 Vincoli (Phase 1)

Nessuna “verifica Stripe/KYC” esposta come concetto: è solo “payout onboarding”

Nessuna monetizzazione live obbligatoria

Nessun cambio accountType automatico: l’attivazione creator resta subordinata ad approvazione admin dopo provider ready (come già deciso)

🔧 INTEGRAZIONI BACKEND — FASE 1
✅ Già coerente / esistente

Rotte confermate:

verificationRoutes.js
POST /verification/profile
GET  /verification/profile/status
POST /verification/totem
GET  /verification/totem/status

adminVerifications.routes.js
GET   /admin/verifications
PATCH /:userId/profile/approve
PATCH /:userId/profile/reject
PATCH /:userId/totem/approve
PATCH /:userId/totem/reject


User model:

verificationPublicVideoUrl   // pubblico (profile)
verificationTotemVideoUrl    // privato (totem) per ora eliminato da fase 1 la iseriamo in fase due con ampliamento con contenuti a pagamento

🔹 Integrazione consigliata (minima, Fase 1)

GET /verification/profile/status (già integrato e sistemato surante questo memo, bisogna solo esporli su profile/me)
Assicurarsi che ritorni anche:

status

verificationPublicVideoUrl (solo se approved)

Esempio:

{
  "status": "approved",
  "verificationPublicVideoUrl": "https://..."
}


👉 evita nuove rotte, semplifica frontend.

❌ NON fare in Fase 1

PROFILO (Profile → Verification/Manage) per diventare creator

Nessuna verifica Stripe/KYC

Nessuna monetizzazione

Nessuna voce SX aggiuntiva

Nessuna esposizione pubblica del totem