// services/eventAccessService.js
const Ticket = require("../models/ticket");
const { isUserBlockedEitherSide } = require("../utils/blockUtils");

function normalizeScope(x) {
  const raw = (x || "public").toString().trim().toLowerCase();
  return raw === "private" ? "private" : "public";
}

function buildAccess({
  canEnter,
  hasTicket = false,
  reason = null,
  authorizedScope = null,
  authorizedRoomId = null,
}) {
  return {
    canEnter,
    hasTicket,
    reason,
    authorizedScope,
    authorizedRoomId,
  };
}

function deny(reason, extra = {}) {
  return buildAccess({
    canEnter: false,
    reason,
    ...extra,
  });
}

function allowPublic(extra = {}) {
  return buildAccess({
    canEnter: true,
    reason: null,
    authorizedScope: "public",
    authorizedRoomId: null,
    ...extra,
  });
}

function allowPrivate(roomId, extra = {}) {
  return buildAccess({
    canEnter: true,
    reason: null,
    authorizedScope: "private",
    authorizedRoomId: roomId || null,
    ...extra,
  });
}

async function checkEventAccess({ event, userId, requestedScope = "public", accountType = null }) {
  if (!event || !event._id) return deny("EVENT_NOT_FOUND");
  if (!userId) return deny("UNAUTHENTICATED");

  const creatorId = event.creatorId ? String(event.creatorId) : null;
  const currentUserId = String(userId);
  const isCreator = creatorId && currentUserId === creatorId;
  const isAdmin = String(accountType || "").trim().toLowerCase() === "admin";

  if (creatorId) {
    const blocked = await isUserBlockedEitherSide(currentUserId, creatorId);
    if (blocked) return deny("EVENT_BLOCKED");
  }

  const isLive = String(event.status || "") === "live";
  const baseAccessScope = normalizeScope(event.accessScope);
  const isNativePrivate = baseAccessScope === "private";

  const ps = event.privateSession || null;
  const privateEnabled = ps?.isEnabled === true;
  const privateStatus = String(ps?.status || "idle");
  const privateRoomId = ps?.roomId || null;
  const reservedByUserId = ps?.reservedByUserId ? String(ps.reservedByUserId) : null;

  const isPrivateBuyer =
    privateEnabled &&
    !!reservedByUserId &&
    reservedByUserId === currentUserId &&
    privateStatus === "running";

  const isPaidEvent = Number(event.ticketPriceTokens || 0) > 0;

  let hasTicket = false;
  let authorizedScope = null;
  let authorizedRoomId = null;

  // -------------------
  // NATIVE PRIVATE EVENT
  // -------------------
  if (isNativePrivate) {

    console.log("DEBUG NATIVE PRIVATE", {
      isLive,
      isCreator,
      isAdmin,
      userId: currentUserId,
      creatorId,
      eventId: String(event._id),
      requestedScope,
      accessScope: event.accessScope,
    });
    authorizedScope = "private";
    authorizedRoomId = null;

    if (!isLive) {
      return deny("EVENT_NOT_LIVE", {
        hasTicket: false,
        authorizedScope,
        authorizedRoomId,
      });
    }

    if (isCreator || isAdmin) {
      console.log("NATIVE PRIVATE -> ALLOW ADMIN/CREATOR");
      return allowPrivate(null, { hasTicket: false });
    }

    const privateTicket = await Ticket.findOne({
      eventId: event._id,
      userId,
      status: "active",
      scope: "private",
    }).lean();

    hasTicket = !!privateTicket;

    if (!hasTicket) {
      console.log("NATIVE PRIVATE -> DENY NO_TICKET_PRIVATE", {
        hasTicket,
        isAdmin,
        isCreator,
      });
      return deny("NO_TICKET_PRIVATE", {
        hasTicket: false,
        authorizedScope: null,
        authorizedRoomId: null,
      });
    }

    return allowPrivate(null, { hasTicket: true });
  }

  // -------------------
  // CREATOR
  // creator -> private only when private is running
  // otherwise -> public
  // -------------------
  if (isCreator) {
    if (privateEnabled && privateStatus === "running") {
      authorizedScope = "private";
      authorizedRoomId = privateRoomId;
    } else {
      authorizedScope = "public";
      authorizedRoomId = null;
    }

    if (!isLive) {
      return deny("EVENT_NOT_LIVE", {
        hasTicket: false,
        authorizedScope,
        authorizedRoomId,
      });
    }

    if (privateEnabled && privateStatus === "running") {
      return allowPrivate(privateRoomId, { hasTicket: false });
    }

    return allowPublic({ hasTicket: false });
  }

  // -------------------
  // ADMIN
  // admin bypassa ticket/prenotazione
  // può entrare in private native
  // può entrare anche nella private interna di un evento public
  // quando la private esiste davvero
  // -------------------
  if (isAdmin) {
    if (!isLive) {
      return deny("EVENT_NOT_LIVE", {
        hasTicket: false,
        authorizedScope: null,
        authorizedRoomId: null,
      });
    }

    if (isNativePrivate) {
      return allowPrivate(null, { hasTicket: false });
    }

    const internalPrivateExists =
      privateEnabled &&
      !!privateRoomId &&
      ["scheduled", "reserved", "running"].includes(privateStatus);

    if (internalPrivateExists) {
      return allowPrivate(privateRoomId, { hasTicket: false });
    }

    return allowPublic({ hasTicket: false });
  }

  // -------------------
  // PRIVATE BUYER
  // buyer -> private when reserved or running
  // -------------------
  if (isPrivateBuyer) {
    const privateTicketQuery = {
      eventId: event._id,
      userId,
      status: "active",
      scope: "private",
    };

    if (privateRoomId) {
      privateTicketQuery.roomId = privateRoomId;
    }

    const privateTicket = await Ticket.findOne(privateTicketQuery).lean();

    hasTicket = !!privateTicket;
    authorizedScope = "private";
    authorizedRoomId = privateRoomId;

    if (!isLive) {
      return deny("EVENT_NOT_LIVE", {
        hasTicket,
        authorizedScope,
        authorizedRoomId,
      });
    }

    if (!hasTicket) {
      console.log("NATIVE PRIVATE -> DENY NO_TICKET_PRIVATE", {
        hasTicket,
        isAdmin,
        isCreator,
      });
      return deny("NO_TICKET_PRIVATE", {
        hasTicket: false,
        authorizedScope: null,
        authorizedRoomId: null,
      });
    }

    return allowPrivate(privateRoomId, { hasTicket: true });
  }

  // -------------------
  // OUTSIDER / PUBLIC
  // outsider must always remain public
  // -------------------
  authorizedScope = "public";
  authorizedRoomId = null;

  if (!isPaidEvent) {
    hasTicket = false;

    if (!isLive) {
      return deny("EVENT_NOT_LIVE", {
        hasTicket: false,
        authorizedScope: "public",
        authorizedRoomId: null,
      });
    }

    return allowPublic({ hasTicket: false });
  }

  const publicTicket = await Ticket.findOne({
    eventId: event._id,
    userId,
    status: "active",
    scope: "public",
  }).lean();

  hasTicket = !!publicTicket;

  if (!isLive) {
    return deny("EVENT_NOT_LIVE", {
      hasTicket,
      authorizedScope: hasTicket ? "public" : null,
      authorizedRoomId: null,
    });
  }

  if (!hasTicket) {
    return deny("NO_TICKET_PUBLIC", {
      hasTicket: false,
      authorizedScope: null,
      authorizedRoomId: null,
    });
  }

  return allowPublic({ hasTicket: true });
}

module.exports = { checkEventAccess };