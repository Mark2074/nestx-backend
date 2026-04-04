IMPLEMENTAZIONI — FASE 1 (solo ciò che serve)
A) Frontend

Componente colonna DX con 4 blocchi in ordine fisso.

Ogni blocco ha:

header + (opzionale) View all

lista con scroll interno

skeleton loading + empty state

Pagine “View all”:

/promoted (ADV interni) → lista senza filtri

/showcase (Vetrina) → lista senza filtri

/updates (News piattaforma) → lista completa (attive)

B) Backend (minimo indispensabile)

FED: endpoint consigliati post (già concettualizzato: tags-first + fallback).

ADV interni: endpoint “approved/list” per mostrare card in DX + endpoint list per “View all”.

Vetrina: endpoint “active/list” per DX + endpoint list per “View all”.

NestX Updates:

User: GET /updates → ritorna updates attive/non scadute (limit per DX + pagina completa per /updates).

Admin: CRUD minimo per pubblicare comunicazioni:

POST /admin/updates

GET /admin/updates

PATCH /admin/updates/:id (edit/archivia/expire)

C) Regole operative

Niente filtri ADV/Vetrina in Fase 1.

Preview counts fissati:

ADV: 5

Vetrina: 5

Updates: 1

Nessuna modifica adesso: si sviluppa e poi si rifinisce in fase frontend o in blocco prima.