# NestX — Frontend Gestisci (MEMO operativo)

> Questo file è pensato per essere copiato e tenuto pronto.  
> Marco **non deve capirlo**: serve solo come promemoria tecnico per implementazione.

## 0) Vincoli di concept (non negoziabili)
- **Gestisci = pannello operativo account** (non profilo, non impostazioni, non token).
- Risponde solo a:
  1) **In che stato sono?**
  2) **Cosa posso fare adesso?**
- **Nessuna creazione contenuti**.
- **Sezione Live** solo informativa:
  - live attiva / nessuna
  - live programmata (se presente)
  - avvisi brevi (1 riga)
  - **NO** link a Old-Live
  - **NO** storico
  - **NO** “ultima live”

## 1) Chiamate backend da usare (senza nuove rotte)
### Core (sempre)
1) `GET /profile/status/me`
2) `GET /stripe/connect/status`
3) `GET /payout/me`
4) `GET /notifications/unread-count`

### On-demand (solo se serve UI)
5) `GET /notifications?unreadOnly=1&limit=5`
6) `GET /event/my-created`  (usare per: live-status + count eventi; non renderizzare lista)
7) `GET /posts/me`          (usare solo `total`)
8) `GET /tokens/me`         (solo nella voce Token)
9) `GET /tokens/me/creator-summary` (solo se creator; altrimenti 403)

### Azioni operative (bottoni)
- Verifica profilo: `POST /verification/request`
- Onboarding Stripe: `POST /stripe/connect/onboard`

## 2) Rotte da NON usare in Gestisci (side-effect)
- `GET /adv/profile/active/:userId`  → incrementa `impressions`
- `GET /showcase/serve`             → incrementa `impressions`
> In Gestisci niente tracking “serve”, niente impression increment.

## 3) Normalizzazione response (obbligatorio lato FE)
Le rotte hanno formati diversi:
- `{ status: "ok", data: ... }`
- `{ status: "success", data: ... }`
- payload **raw** senza `status` (es. `/posts/me`, `/tokens/me`, `/tokens/me/creator-summary`)
Regola FE:
- non dipendere da `status` string
- validare su presenza campi attesi
- wrapper unico `normalizeResponse()` suggerito

## 4) Regole di visibilità blocchi
### Header / Stato
- fonte primaria: `GET /profile/status/me`
- VIP = boolean `isVip` (**non** accountType)
- Creator attuale: `accountType === "creator"` (coerente con backend)

### Blocco Creator (mostra se)
- `accountType === "creator"` **OR**
- da `connect/status` o `payout/me`: `creatorEligible === true` (idoneo)  
In blocco Creator mostra:
- stato creator (enabled/disabled/eligible)
- payoutProvider / payoutEnabled / payoutStatus
- avvisi brevi (1 riga)

### Blocco Operativo (azioni)
- Verifica: mostra CTA se `verificationStatus` non è `approved`
- Stripe onboarding: mostra CTA se `payoutAccountId` mancante o `payoutStatus` non ok
- Cashout: mostra solo se `canCashout === true` (da `/payout/me`)

### Blocco Contenuti (solo numeri)
- Post: da `/posts/me` → `total`
- Eventi/Live: da `/event/my-created` → `data.length`
- ADV/Vetrina: **non disponibili senza nuove rotte** (vedi §7)

### Blocco Live (solo informativo)
- usare `/event/my-created`
- estrarre:
  - live attiva: primo evento con `status` in stato live (se esiste)
  - live programmata: prossimo per data/tempo (se esiste)
  - avvisi brevi: cancellata/chiusa automaticamente (se disponibile dal payload)
- non mostrare lista eventi completa

## 5) Performance / ordine di fetch consigliato
1) `/profile/status/me` (blocking UI)
2) in parallelo: `/stripe/connect/status`, `/payout/me`, `/notifications/unread-count`
3) on-demand:
   - apri blocco Live/Contenuti → `/event/my-created`
   - apri blocco Contenuti → `/posts/me`
   - entra in Token → `/tokens/me`
   - apri Avvisi → `/notifications?unreadOnly=1&limit=5`
   - se creator e serve → `/tokens/me/creator-summary`

## 6) Avvisi brevi (regola)
- 1 riga
- non esplicativi
- fonti:
  - notifications (unreadOnly limit 5)
  - payout gate (blockedReason)
  - creatorDisabledReason
  - eventi: cancel/autoCancelled (se presente)

## 7) Gap attuali (da sapere, non da risolvere ora)
- Conteggi ADV/Vetrina per creator **non disponibili** senza:
  - nuove rotte count, **oppure**
  - estendere una rotta esistente (es. `/profile/status/me`) con `counts.adv` e `counts.showcase`
> Per ora in Gestisci puoi mostrare solo Post + Eventi, oppure “ADV/Vetrina: —”.

## 8) Nota tecnica: possibile bug transazioni creator-summary
- In `/tokens/me/creator-summary` query usa `kind: "transfer"`
- nel model TokenTransaction c’è `type` (non `kind`)
- se la lista risulta sempre vuota, prima cosa: allineare campo

---

## Checklist finale (quando implementi)
- [ ] Gestisci non crea contenuti
- [ ] Live: NO Old-Live / NO storico / NO ultima live
- [ ] No rotte con side-effect (impressions) in Gestisci
- [ ] FE normalizza response (status ok/success/raw)
- [ ] Fetch progressivo + on-demand (my-created pesante)
- [ ] VIP boolean (`isVip`)
- [ ] Creator section visibile per creator o idoneo
