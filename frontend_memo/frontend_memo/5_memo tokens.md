MEMO DEFINITIVO — SEZIONE TOKENS (NestX)
0) Ruolo della sezione Tokens

La pagina Tokens è il wallet dell’utente:

visualizza saldo

mostra storico movimenti

gestisce payout creator

NON è un punto di invio manuale token

È una pagina di trasparenza contabile, non di interazione sociale.

Route unica:

/tokens


Voce sidebar:

Tokens


nessun badge

nessuna sottosezione in SX

1) Contenuto pagina /tokens
Blocchi visivi (ordine fisso)

Balance

Transactions

Payout (sempre visibile, stato variabile)

2) Balance block

Endpoint:

GET /api/tokens/me


Mostra sempre:

tokenBalance → Spendable tokens

Se accountType === "creator":

tokenEarnings → Creator earnings

Regole UI:

Nessun calcolo lato frontend

Nessuna conversione € fissa

Usare displayName (non username)

3) Transactions block

Endpoint:

GET /api/tokens/transactions


Contenuto:

ultime 50 TokenTransaction

inbound / outbound

context (tip, donation, cam, content, ticket, system, other…)

amountTokens (+ / −)

createdAt

metadata (preview se presente)

Empty state:

No transactions yet

4) ❌ Cosa NON è presente in /tokens
❌ Send tokens manuale

Nessun form con toUserId

I token si inviano solo nel contesto corretto:

profilo utente (donation)

live / cam (tip)

acquisto contenuti / ticket / feature

La pagina Tokens non è un bonifico

❌ Purchase tokens (utente finale)

Nessun acquisto token in UI Phase 1

Eventuale top-up:

solo dev / admin

chiaramente marcato come test only

5) Payout block (sempre visibile)

Il blocco Payout è sempre mostrato, anche agli utenti non creator.

Scopo:

funnel informativo

rendere evidente che i guadagni sono riscattabili solo come creator verificato

Endpoint
GET /api/payout/policy
GET /api/payout/me/eligibility
GET /api/payout/me/available   (solo se eligible)
POST /api/payout/request

Stati UI
A) Non eligible

Messaggio:

Payout not available


Motivo (da code backend):

NOT_CREATOR → CTA: Become a creator

PAYOUT_NOT_VERIFIED → CTA: Complete verification

CREATOR_DISABLED

PAYOUT_NOT_ENABLED

PAYOUT_PROVIDER_NOT_READY

CREATOR_NOT_ELIGIBLE

⚠️ Nessun riferimento esplicito a Stripe in UI.

B) Eligible

Mostrare:

earnedWindowTokens

pendingTokens

availableToWithdrawTokens

Azione:

Request payout (amountTokens)

Error handling:

BELOW_MIN

INSUFFICIENT_AVAILABLE

MONTHLY_CAP

Success:

Payout request submitted

6) Regole fondamentali (vincolanti)

Tutte le feature NestX usano solo token

Nessun pagamento diretto in euro per feature interne

Euro:

solo acquisto token (provider esterno)

solo payout creator

Ledger unico:

ogni movimento genera TokenTransaction

Policy payout:

policy-driven

la UI mostra solo ciò che ritorna il backend

nessuna regola hardcoded in frontend (min/max/expiry)

7) ADV / Vetrina

NON gestiti in /tokens

Nessuna logica ADV/Vetrina in questa pagina

Solo transazioni visibili nello storico se avvenute

8) Obiettivo UX

La sezione Tokens deve comunicare:

chiarezza

fiducia

controllo

percorso chiaro: guadagni → verifica → payout