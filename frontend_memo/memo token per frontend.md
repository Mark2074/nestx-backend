MEMO FRONTEND — SEZIONE TOKEN / PAYOUT (NestX)
A) Endpoints Token (utente loggato)

Base URL: /api/tokens
Header sempre: Authorization: Bearer <jwt>

Saldo

GET /api/tokens/me

UI: mostra tokenBalance, tokenEarnings (se creator), accountType

Nota: nel model user il campo è displayName, quindi in UI non affidarti a username.

Ricarica token (solo dev/simulata)

POST /api/tokens/purchase

Body: { "tokens": 100 } (intero > 0)

Success: 201 con tokenBalance, amountTokens, amountEuro

Errori: 400 (invalid tokens), 404 (user non trovato), 500

Invio token (tip/donation/cam/content)

POST /api/tokens/transfer

Body: { "toUserId": "<id>", "amountTokens": 10, "context": "tip" }

context ammessi: tip | donation | cam | content | system | other

Success: 201

Errori:

saldo insufficiente → 400 "Saldo token insufficiente..."

toUserId non valido → 400

invio a se stessi → 400

Storico transazioni

GET /api/tokens/transactions

Ritorna ultime 50 dove utente è fromUserId o toUserId

UI: lista con kind, direction, context, amountTokens, createdAt, metadata

B) Regole contabili (da rispettare in UI)

tokenBalance = spendibili

tokenEarnings = “guadagni creator” (base payout)

Se ricevi token e sei accountType:"creator" → backend incrementa anche tokenEarnings

Se un creator spende token, il backend scala tokenEarnings solo se sta spendendo oltre i token “non-earning” (gestito lato backend)

UI: non deve fare calcoli “furbi”, solo mostrare.

C) ADV / Vetrina — lato UI (solo token rule)
ADV (creator)

1° e 2° ADV del giorno: free

dal 3°: paid 10 token

Se token < 10 → blocco creazione: INSUFFICIENT_TOKENS

Se token ≥ 10 → UI deve chiedere conferma esplicita (“È a pagamento 10 token. Procedere?”)

Pagamento avviene solo ad approvazione admin (non alla creazione)

Se al momento approvazione non hai più token → ADV rifiutato (notifica creator)

Vetrina (solo VIP)

max 2 item free attivi

oltre: paid 30 token, durata 7 giorni

Pagamento avviene in approvazione admin (come ADV)

D) Payout (creator) — UI “stub”

Base URL: /api/payout

GET /api/payout/policy

mostra soglie/limiti (min/max/window)

GET /api/payout/me/eligibility

se ok:false → UI mostra “Payout non disponibile” + motivo

codici possibili:
NOT_CREATOR, CREATOR_DISABLED, CREATOR_NOT_ELIGIBLE, PAYOUT_NOT_ENABLED, PAYOUT_NOT_VERIFIED, PAYOUT_PROVIDER_NOT_READY

GET /api/payout/me/available

funziona solo se eligible

mostra:

earnedWindowTokens

pendingTokens

availableToWithdrawTokens

POST /api/payout/request

Body { "amountTokens": N }

Errori chiave:

BELOW_MIN

INSUFFICIENT_AVAILABLE

MONTHLY_CAP