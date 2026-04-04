CONCEPT OPERATIVO — COSE DA FARE (FASE 1)

Frontend + previsione backend

A. Sistemazioni UI / UX (Fase 1)

Rimuovere qualsiasi output debug (bannerEvent = null)

Cambiare badge “Private” in PVT

Eliminare badge “Creator”

Integrare pulsante Donate (solo VIP)

Integrare media nei PostCard (img + video)

Integrare badge Authentic

Uniformare PostCard ed EventCard nello stesso flusso

B. Backend da prevedere / allineare (Fase 1)

Validazione durata video:

Base ≤ 60s

VIP ≤ 180s

Validazione media (1 solo media per post)

Flag isAuthentic per video verificati

Flag isPrivate profilo

Gate donate: solo VIP ricevente

inserire delete/modifica e segnala per postcard

(Implementazione non oggi, ma struttura dati sì)

C. Media policy (Fase 1)

Conversione immagini lato backend

Conversione video a standard unico

Scartare originali non necessari

1 sola versione per asset

AGGIUNTA FASE 1 — TODO

Fix conteggio Like (incremento/decremento e sync UI ↔ backend) su:

Post

Event (se ha like)

✅ TODO Fase 1 (frontend) — Profile / Me

Mostrare badge ✔️ (spunta in cerchio) nel profilo pubblico quando:

verificationStatus === "approved"

Aggiungere link/azione sul badge:

click → modal con player

sorgente: verificationPublicVideoUrl

Tooltip sul badge: Verified profile

Nessun testo, solo icona

Totem mai esposto

Backend ok, rotta ok, modello ok.
Resta solo UI da fare in profile/me (e nella vista profilo pubblico).

implementazione del tag utente nei post, semplice non cliccabile non autocomposizione, ecc. solo notifica utente, solo se seguiti o ci seguono
