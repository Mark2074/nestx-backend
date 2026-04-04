IA — Fase 1 (pronto lancio)

Niente modello “proposta IA + voto admin”: lo rimandiamo a Fase 2 (troppa rogna ora, valore non critico al lancio).

Auto-hide SOLO per GRAVISSIMO.

Tutto il resto = flag/alert (senza hide automatico), e decide l’admin.

Implementazione minima (coerente con le rotte che hai)

L’IA usa solo:

POST /moderation/posts/:id/hide (internal key) solo GRAVISSIMO

POST /moderation/posts/:id/unhide (rollback raro)

Dizionario: resta come già previsto in adminDictionaryRoutes.

MEMO OPERATIVO — Implementazioni Fase 1 (IA + Admin) — NestX
Obiettivo Fase 1
IA stabile e uniforme su contenuti statici. Auto-hide solo GRAVISSIMO. Admin sempre decisore finale.

A) BACKEND — MUST (da fare)
1) Stati contenuto standard (uniformità)
Definire e usare ovunque (Post + Adv + eventuale altri media):


visibilityStatus: visible | hidden_ai | hidden_admin


campi audit minimi:


hiddenAt


hiddenBy: "system_ai" oppure adminId


hiddenReason: "AI_GRAVISSIMO" | "ADMIN_ACTION"


hiddenNote (opzionale, testo breve in inglese)




Regola UI: se hidden_* → il contenuto non è visibile pubblicamente.

2) Servizio IA interno (chi chiama davvero hide)
Serve un “IA worker” anche minimale (può essere nello stesso backend):


Sorgente eventi: “nuovo media” (post/adv/avatar/cover)


Azione:


scansiona immagini con AWS Rekognition


scansiona testo (se attivato) con OpenAI Moderation + dizionario




Se e solo se GRAVISSIMO:


chiama POST /moderation/posts/:id/hide con INTERNAL_SERVICE_KEY




Requisiti tecnici minimi:


idempotenza: se già hidden_ai, non rifare


retry: 2–3 tentativi su errori provider, poi log e stop



3) Pipeline “moderation-first” sui contenuti statici (uniformità)
Applicare lo stesso flusso a:


Post media (foto/video)


ADV media


Avatar / Cover


Titolo/descrizione eventi (testo)


Nota Fase 1: non serve “pending_review”, puoi pubblicare e nascondere solo se GRAVISSIMO.

4) Dizionario: punti obbligatori dove applicarlo (testo)
Hard rules (dizionario) obbligatorie su:


Search (blocco duro + messaggio dissuasivo)


Bio / display fields


Titolo/descrizione Event


Testo ADV


Commenti


Chat live (singolo messaggio)


Output:


se match “proibito” → blocca richiesta (400/403) con messaggio in inglese


se match “attenzione” (se lo prevedi) → consenti ma logga/flagga (no hide)



5) Logging/Audit minimo (senza “case+voto”)
Senza questo ti perdi.


ogni hide/unhide deve scrivere:


who/when/why (campi sopra)




log server per:


provider call fallite


retry esauriti


contenuti “flag” (anche solo console + collection log minima se vuoi)





B) ROTTE ADMIN — MUST (da aggiungere o confermare)
6) Admin: Queue contenuti nascosti (per review manuale)
Se non esiste già, creare:


GET /admin/moderation/posts?status=hidden_ai


lista post nascosti da IA




PATCH /admin/moderation/posts/:id/unhide


set visibilityStatus=visible


hiddenBy=adminId, hiddenReason=ADMIN_ACTION (o ADMIN_UNHIDE)




PATCH /admin/moderation/posts/:id/hide


per hide manuale admin (status hidden_admin)





Anche se l’IA in Fase 1 fa hide rarissimo, questa queue serve per rollback e controllo.


7) Dizionario Admin — conferma UX admin
Hai già:


GET/POST/PATCH /dictionary
Confermare:


supporto a: term | pattern | context_pair (se non ora, almeno term+pattern)


campi: type, value, severity, enabled, notes, updatedBy, updatedAt



C) FRONTEND — MUST (per uniformità)
8) Rendering contenuti “Under review”
Per Post/ADV:


se visibilityStatus è hidden_ai o hidden_admin:


mostra card placeholder: “This content is under review.”


niente media, niente testo, niente azioni.




9) Errori Search proibita (messaggio forte)
Quando backend blocca search:


mostra messaggio in inglese (quello già definito nel concept)


nessun risultato, nessun retry automatico.



D) CONFIG / ENV — MUST


INTERNAL_SERVICE_KEY (già)


AWS Rekognition:


AWS_REGION


AWS_ACCESS_KEY_ID


AWS_SECRET_ACCESS_KEY




OpenAI moderation (se attivo):


OPENAI_API_KEY





E) OUT OF SCOPE (Fase 2 — NON fare ora)


Modello “AiModerationCase + adminScore”


clip live / trascrizioni / registrazioni


CSAM suite dedicata


delega automatica decisionale



CHECKLIST rapida “Done = Fase 1 ok”


 visibilityStatus + hidden* fields su Post e Adv (e dove serve)


 IA worker che scansiona e chiama hide solo GRAVISSIMO


 Dizionario applicato in tutti i punti testuali obbligatori


 Admin queue per hidden_ai + azioni hide/unhide manuali


 Frontend placeholder “under review” + gestione error search proibita


Fine.
