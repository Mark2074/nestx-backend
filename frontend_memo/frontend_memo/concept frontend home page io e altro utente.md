CONCEPT GENERALE — SEZIONE CENTRALE (FRONTEND)

NestX — Fase 1 (vincolante)

1. Ruolo della sezione centrale

La colonna centrale è l’unico punto di fruizione dei contenuti:

profilo proprio

profilo altrui

feed seguiti

post + eventi nello stesso flusso

Nessun feed duplicato altrove.

2. Profili (mio / altrui)

Struttura identica, cambiano permessi e CTA.

Header profilo

Avatar

Display name

Badge compatti (max 1–2, mai testuali lunghi)

CTA contestuali

Badge ammessi (Fase 1)

VIP

PVT (profilo privato) ← decisione nuova

❌ CREATOR → ELIMINATO (non deve comparire)

Testo UI sempre in inglese
“Private” → PVT

3. Tab profilo
Mio profilo

Posts

Following feed

Old live (solo se esistono elementi)

Profilo altrui

Posts (se visibili)

Old live (se visibili)

4. Feed

Cronologico

Misto: Post + EventCard

Solo contenuti dei seguiti (nel feed “Following”)

5. PostCard — struttura definitiva
Tipi di post

Testo

Testo + 1 solo media (immagine oppure video)

❌ Niente carousel in Fase 1

Media

Immagini

Convertite / ridimensionate (standard web)

Max lato lungo ~1600px

Video

Base: max 60s

VIP: max 180s

Standard consigliato: MP4 H.264, 720p, 30fps

Autoplay NO

Header

Avatar + nome

Timestamp

Badge Authentic (solo se video verificato con totem)

Body

Testo

Media inline

Footer

Like

Comment

Menu …

Menu …

Autore: Edit / Delete

Altri utenti: Report

Visibilità

Post non visibile → non viene renderizzato

Nessun placeholder “content not available” per singolo post

6. EventCard — struttura definitiva

Fa parte dello stesso feed

Like sì

Commenti no

Contenuto

Titolo

Info compatte (se presenti)

Orario evento

Badge opzionali (VIP only, Private, ecc.)

CTA

View event / Join / Not available (disabled)

7. Donazione token

Pulsante Donate visibile solo se:

altro utente

isVip === true

nessun blocco reciproco

Se non VIP → il bottone non esiste