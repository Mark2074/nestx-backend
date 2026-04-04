MEMO FRONTEND — ADMIN / MODERAZIONE / TRUST (NestX)
1️⃣ Accesso Admin (Entry Point)
Accesso

L’accesso admin NON è una sezione separata

Avviene cliccando su scritta “NEST” (logo / titolo in alto)

Visibile solo a accountType = admin

Gli utenti normali non vedono nulla

👉 Click su NEST → Dashboard Admin

2️⃣ Dashboard Admin (Home)
Dati sintetici (cards / counters)

Da backend già disponibili o derivabili:

👥 Utenti totali

🎥 Creator totali

🆕 Registrazioni oggi

🚨 Account in ATTENZIONE

🔥 Account CRITICI

⛔ Account BLOCCO

📩 Report pendenti

📊 Report actioned (oggi / totale)

⚠️ Importante:
I contatori usano AccountTrustRecord.tier + tierScore, NON i report grezzi

3️⃣ Sezione: Queue Admin (prioritaria)
Percorso
Admin → Queue

Ordinamento (fondamentale)

Ordine decrescente per gravità

Basato su tierScore

Ordine	Tier
1	BLOCCO (3)
2	CRITICO (2)
3	ATTENZIONE (1)

👉 Mai ordine cronologico
👉 Prima i più pericolosi, sempre

Riga Account (Queue Users)

Per ogni account:

Avatar

DisplayName

Tipo account (base / creator)

Tier attuale (OK / ATTENZIONE / CRITICO / BLOCCO)

Totale segnalazioni confermate

Ultima severità (grave / gravissimo)

Ultima categoria

Data ultimo evento

Pulsante DETTAGLI

4️⃣ Dettaglio Account (Admin User Detail)
Sezioni interne
A) Profilo base

Info utente

Stato creator

Stato VIP

Stato verifica

Stato payout (se creator)

B) Trust & Affidabilità

(DATI DA AccountTrustRecord)

Tier attuale

Tier score

Confirmed total

Confirmed grave

Confirmed gravissimo

Ultima violazione

Ultima categoria

Ultima data

C) Storico eventi (LastEvents)

Timeline con:

tipo evento (report_actioned)

target (user / post / event)

severità

categoria

data

admin che ha deciso

👉 Max 20 eventi, come backend

D) Azioni rapide (manuali)

(solo pulsanti, nessuna automazione)

⛔ BAN account

🔒 Disabilita creator

👁️ Forza verifica

🔕 Limitazioni manuali (future)

⚠️ Nulla è automatico
Tutto passa sempre da admin

5️⃣ Sezione: Report
Percorso
Admin → Reports

Filtri

Status: pending / reviewed / dismissed / actioned

Target: user / post / event

Ricerca testo

Ordinamento: newest / oldest

Dettaglio Report

Reporter

Target

Motivo

Nota

Stato

Azione admin:

status

severity (se actioned)

category

nota admin

👉 Alla conferma:

si aggiorna Report

si aggiorna AccountTrustRecord

si scrive AdminAuditLog

6️⃣ Sezione: Audit Admin (solo lettura)
Percorso
Admin → Audit


Contiene:

Chi ha fatto cosa

Quando

Su cosa

Metadati azione

⚖️ Fondamentale per legale / responsabilità

7️⃣ Regole UI IMPORTANTI

Nessun colore “morale”

Solo stato operativo

Tier evidenziati chiaramente

BLOCCO sempre visibile

CRITICO sempre sopra ATTENZIONE

Nessuna azione distruttiva senza conferma

8️⃣ Note FUTURE (da ricordare – NON ora)

Limitazioni visibilità admin non-super

Ruoli admin multipli

Accesso parziale ai contenuti non pubblici

Override totale solo per Super Admin

👉 Giustamente rimandate, ma da ricordare

✅ STATO FINALE

✔ Backend coerente
✔ Trust system funzionante
✔ Moderazione difendibile
✔ Frontend admin chiaramente definito

Questa parte è CHIUSA.