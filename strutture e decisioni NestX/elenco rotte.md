routes
    adminAdvRoutes.js
        router.get      "/adv/pending", auth, adminGuard         //Adv da valutare
        router.patch    "/adv/:id/approve", auth, adminGuard     //Approva ADV
        router.patch    "/adv/:id/reject", auth, adminGuard      //Rifiuta ADV
        router.get      "/showcase/pending", auth, adminGuard    //Oggetti vetrina da valutare
        router.patch    "/showcase/:id/approve", auth, adminGuard//Approva oggetto vetrina
        router.patch    "/showcase/:id/reject", auth, adminGuard //Rifiuta oggetto vetrina

    adminContentRoutes.js
        router.get      "/content/posts/queue", auth, adminGuard // query: mode=hidden|ai_hidden|all  q=   limit skip
        router.patch    "/content/posts/:id/hide", auth, adminGuard// body: { reason, severity: "grave"|"gravissimo", category? }
        router.patch    "/content/posts/:id/unhide", auth, adminGuard// body: { note? }

    adminDictionaryRoutes.js
        router.get      "/dictionary", auth, adminGuard
        router.post     "/dictionary", auth, adminGuard          //dizionario di parole di allerta implementabile
        router.patch    "/dictionary/:id", auth, adminGuard      //pendo id utente con parola attenzionata

    adminNotifications.routes.js
        router.get      "/pending", auth, adminGuard             //Queue unica admin: Notification con userId=null e isRead=false
        router.patch    "/:id/read", auth, adminGuard            //
        router.patch    "/read-bulk", auth, adminGuard           //Body: { ids: ["id1","id2"] }

    adminPayoutRoutes.js
        router.get      "/pending", auth, adminGuard             //
        router.patch    "/:id/approve", auth, adminGuard         //
        router.patch    "/:id/reject", auth, adminGuard          //
        router.patch    "/:id/mark-paid", auth, adminGuard       //Body: { providerTransferId?: string }

    adminQueueRoutes.js
        router.get      "/queue", auth, adminGuard               //Dashboard queue for admin: shows ONLY pending reports (Status=Padding)
        router.get      "/queue/users", auth, adminGuard         //Lista utenti problematici ordinata per gravità

    adminRefundRoutes.js
        router.get      "/refund-check/:ticketId", auth, adminGuard,//Ritorna una “foto” unica per decidere il rimborso
        router.post     "/refund/:ticketId", auth, adminGuard,    //Esegue rimborso token + TokenTransaction kind=ticket_refund + ticket.status=refunded
        
    adminReportsRoutes.js
        router.get      "/reports", auth, adminGuard             //Query: status, targetType, q, limit, skip, sort
        router.patch    "/reports/:id", auth, adminGuard         //Body: { status: pending | reviewed | dismissed | actioned }

    adminSearchLogsRoutes.js
        router.get      "/prohibited-search/logs", auth, adminGuard//

    adminTrustRoutes.js
        router.get      "/trust/user/:userId", auth, adminGuard  //Ritorna: snapshot user (minimo), trust record (tier, contatori, lastEvents), ultimi log ricerche proibite (hash + timestamp) (NO query in chiaro)
        router.get      "/trust/queue", auth, adminGuard         //Ritorna lista utenti + trust snapshot ordinati per gravità e freschezza.
        
    adminUsersRoutes.js
        router.get      "/users/:userId/overview", auth, adminGuard//
        router.patch    "/users/:userId/creator-toggle", auth, adminGuard//
        router.patch    "/users/:userId/vip", auth, adminGuard   //
        router.patch    "/users/:userId/privacy", auth, adminGuard//
        router.patch    "/users/:userId/ban", auth, adminGuard   //

    adminVerifications.routes.js
        router.get      "/", auth, adminGuard                     //verifica stato|Pending|Approved|Rejected|all tipo profile|totem|all
        router.patch    "/:userId/profile/approve", auth, adminGuard//Approva video di verifica
        router.patch    "/:userId/profile/reject", auth, adminGuard//Rifiuta video di verifica
        router.patch    "/:userId/totem/approve", auth, adminGuard//Approva video totem
        router.patch    "/:userId/totem/reject", auth, adminGuard//Rifiuta video totem

    advRoutes.js
        router.post     '/campaign', auth, ensureCreatorOrVip            //Crea una nuova campagna ADV
        router.get      '/profile/active/:userId', auth//
        router.get      '/serve/placement-feed', auth//Restituisce un piccolo set di ADV per il feed
        router.get      '/serve', auth               //Restituisce un piccolo set di ADV adatte all’utente corrente,
        router.post     '/:id/click', auth           //Log molto semplice di un click su una ADV

    aiModerationRoutes.js
        router.post     "/moderation/posts/:id/hide", internalServiceGuard//Headers: x-internal-key: <INTERNAL_SERVICE_KEY>
        router.post     "/moderation/posts/:id/unhide", internalServiceGuard//(raramente serve, ma utile per rollback)

    appSettingsRoutes.js
        router.get      "/", auth                    //
        router.put      "/", auth                    //

    auth.routes.js
        router.get      '/test'                 //ROTTA DI TEST
        router.post     '/register'             //Registrazione utente
        router.post     '/login'                //Login utente
        router.get      '/me', authMiddleware                  //Info utente loggato
        router.post     "/adult-consent", authMiddleware       //Registra consenso + sblocca accesso piattaforma
        router.post     "/logout-all", authMiddleware          //
        router.post     "/change-password", authMiddleware     //

    blockRoutes.js
        router.post     "/:id", auth                 //Blocca un utente (id = utente da bloccare)
        router.delete   "/:id", auth                 //Sblocca un utente (id = utente da sbloccare)
        router.get      "/me", auth                  //Elenco utenti che HO bloccato

    eventPromoRoutes.js
        router.post     "/:eventId/profile-promo/publish", auth//Evento mostrato in seguiti
        router.post     "/:eventId/profile-promo/unpublish", auth

    eventRoutes.js
        router.get      '/ping-events'
        router.post     "/", auth                    //Crea un nuovo evento GRATIS/PAGAMENTO
        router.post     "/:id/go-live", auth         //Il creator avvia l'evento in modalità live
        router.post     "/:id/private/schedule", auth//L'host programma il passaggio a sessione privata (Strategia 3)
        router.post     "/:id/private/start", auth   //Avvia countdown (o running) della sessione privata già schedulata
        router.post     "/:id/finish", auth          //Il creator termina la live e chiude l'evento
        router.post     "/:id/cancel", auth          //Cancella un evento NON ancora iniziato e rimborsa i token ai partecipanti
        router.post     "/:id/mute-viewer", auth     //Muta la chat per uno spettatore in questo evento
        router.post     "/:id/unmute-viewer", auth   //Smuuta la chat per uno spettatore in questo evento
        router.post     "/:id/chat-toggle", auth     //Creator abilita/disabilita la chat per gli spettatori
        router.get      "/feed", auth                //Feed eventi (public), con filtri base
        router.get      "/my-created", auth          //Lista eventi creati dall'utente (tipicamente creator)
        router.get      "/:id/access", auth          //Verifica se l'utente può accedere all'evento (live room)
        router.get      "/my-tickets", auth          //Lista eventi per cui l'utente loggato ha un ticket
        router.get      "/:id" auth                 //Dettaglio evento
        router.post     "/:id/ticket", auth          //Acquista un ticket per un evento
        router.post     "/:id/like", auth            //L'utente mette like a un evento
        router.post     "/:id/unlike", auth          //L'utente rimuove il like da un evento
        router.post     "/:id/join", auth            //Ingresso evento + abilitazione funzioni Live
        router.get      "/:id/ticket", auth          //Verifica se l'utente loggato ha un ticket per questo evento

    followRoutes.js
        router.post     "/:id", auth                 //Segui un utente (pending se target privato, accepted se pubblico)
        router.post     "/request/:followerId/accept", auth  //Accetta che utente ti segua
        router.delete   "/:id", auth                 //Smetti di seguire un utente
        router.get      "/:id/followers", auth       //Lista follower di un utente (solo accepted). Se profilo privato: solo owner o follower accepted.
        router.get      "/:id/following", auth       //Lista utenti seguiti da un utente
        router.get      "/relationship/:id", auth    //Stato relazione tra me e target (per bottone stile X)
        router.delete   "/request/:id/cancel", auth  //Annulla una richiesta di follow pending (stile X: "Annulla richiesta")

    liveRoutes.js
        router.post     "/:eventId/join-room", auth  //Registra ingresso utente in live room (contatore spettatori)
        router.post     "/:eventId/leave-room", auth //Registra l'uscita di un utente dalla live room (decrementa contatore)
        router.get      "/:eventId/status", auth     //Info live room (contatori, stato)

    liveSearchRoutes.js
        router.get      "/search", auth              //

    messageRoutes.js
        router.post     "/:recipientId", auth        //Invia un nuovo messaggio privato
        router.get      "/conversations", auth       //Lista conversazioni dell'utente (ultima risposta per ciascuna)
        router.get      "/conversation/:otherUserId", auth//Recupera tutti i messaggi tra me e un altro utente (paginabile in futuro)
        router.delete   "/:messageId", auth          //VIP: elimina un messaggio "per entrambi" (solo UI). Il record resta in DB.

    muteRoutes.js
        router.post     "/:targetUserId", authMiddleware
        router.delete   "/:targetUserId", authMiddleware
        router.get      "/", authMiddleware

    notifications.js
        router.get      "/", auth                    //query: ?limit=20&cursor=<ISO date>&unreadOnly=1
        router.get      "/unread-count", auth        //
        router.patch    "/:id/read", auth            //
        router.patch    "/read-all", auth            //
        router.delete   "/:id", auth                 //se isPersistent=true (token/pagamenti) NON cancelliamo (per policy)

    oldLiveRoutes.js
        router.get      "/old-live/:userId", auth    //solo live concluse, max 10, ordinamento per performance (proxy): peak / durataMin
        
    payoutRoutes.js
        router.get      "/policy", auth              //
        router.get      "/me/eligibility", auth      //
        router.get      "/me/available", auth        //
        router.post     "/request", auth             //richiesta cashout (stub): per ora valida solo gate e risponde OK.

    posts.js
        router.post     "/", auth                    //Creazione di un nuovo post
        router.get      "/me", auth                  //Post pubblicati dall'utente loggato
        router.get      "/user/:userId", auth        //Post pubblicati da uno specifico utente (profilo pubblico)
        router.get      "/feed/fedbase", auth        //FEDBASE: feed di interessi base, per tutti gli utenti loggati
        router.get      '/feed/fedvip', auth         //FEDVIP: feed basato su interessiVip (solo per accountType === 'vip')
        router.get      "/feed/fed", auth            //Feed sezione dx
        router.get      '/feed/following', auth      //Feed "Seguiti": post degli utenti che seguo
        router.get      "/feed/following-mixed", auth//Pubblica evento in tab seguiti
        router.post     '/:id/likes', auth           // Toggle del like su un post (mette o toglie il like)
        router.post     '/:id/comment', auth         //Aggiunta di un commento ad un post
        router.get      "/:id/comments", auth        // Ritorna la lista dei commenti di un post (con paginazione semplice)
        router.delete   "/:postId/comments/:commentId", auth// Cancella un commento se appartiene all'utente loggato
        
    profile.routes.js
        router.get      "/me", auth                  //dati profilo corrente
        router.put      "/update", auth
        router.get      "/public/:id", auth          //Profilo pubblico utente + contatori follow
        router.get      "/status/me", auth           //stato account (base/vip/creator + token)
        router.post     "/avatar", auth
        router.post     "/cover", auth

    profileEventBannerRoutes.js
        router.get      "/event-banner/:userId", auth// Banner evento sul profilo (derivato da Event, NON da Adv)

    reportRoutes.js
        router.post     "/", authMiddleware

    searchRoutes.js
        router.get      "/search", auth              //Cerca social

    showcaseRoutes.js
        router.post     "/item", auth                //Crea un item Vetrina (pending)
        router.get      "/serve", auth               //Serve items Vetrina per colonna DX
        router.post     "/:id/click", auth           //Traccia click e restituisce redirect interno (profilo owner)

    stripeConnectRoutes.js
        router.post     "/connect/onboard", auth     //Avvia onboarding Stripe Connect (crea account se manca + ritorna account_link url)
        router.get      "/connect/status", auth      //Ritorna lo stato creator lato NestX + Stripe-link

    stripeWebhookRoutes.js
        router.post     "/stripe", express.raw              // Stripe richiede RAW body per verificare signature

    tokens.js
        router.get      "/me", auth                  // Restituisce saldo token e tokenEarnings dell'utente loggato
        router.post     "/topup", auth               //Ricarica simulata/dev (non è "purchase" interno del concept)
        router.post     "/transfer", auth            // Trasferisce token da utente loggato a un altro utente
        router.get      "/transactions", auth        // Storico base delle transazioni dell'utente loggato
        router.get      "/me/creator-summary", auth  // Solo per creator: riepilogo guadagni e stima payout
        
    verificationRoutes.js
        router.post     "/profile", authMiddleware             //Invio/Reinvio verifica profilo (solo profilo)
        router.get      "/profile/status", authMiddleware      //
        router.post     "/totem", authMiddleware               //Invio/Reinvio verifica totem (solo totem)
        router.get      "/totem/status", authMiddleware        //
