MEMO GENERALE — FRONTEND COLONNA SX (USER MODE)

0) Split Admin vs User

Admin mode = layout separato (no colonna SX/DX, no profilo/feed). Menu nel logo NestX.

User mode = layout 3 colonne con SX fissa.

1) Header SX (User)

Logo NestX: solo decorativo (disabled, no click).

Home = mini avatar (click → tua home page / colonna centrale).

2) Voci SX (macro, 1 livello)

Ordine definitivo:

Home (mini avatar)

Search

Notifications (badge count)

Chat (badge count)

Live

Tokens

Profile

Rules (solo Termini/Regole piattaforma)

3) Footer SX

Logout sempre visibile in basso.

Niente theme switch in Fase 1.

4) Sidebar: regola tecnica

SX legge solo stato minimo + badge:

me minimo

notificationsUnreadCount

chatUnreadCount

Tutto il resto (token balance, stato live, scheduled ecc.) si carica dentro le pagine (Tokens/Live/Profile).

5) Sottosezioni (traccia routing pulita)
LIVE (interno a “Live”, non in SX)

/live/discover → griglia / join

/live/create → crea CAM/Event (scheduled)

/live/studio → gestione creator (go-live, end, cancel, private session)

/live/:id → dettagli evento/live

PROFILE (interno a “Profile”, non in SX)

Profile

Settings

Manage

Privacy & Security

Verification

Connections (Followers / Following / Requests)

✅ Memo chiuso e vincolante per la SX.