MEMO IMPLEMENTAZIONI BACKEND — FASE 1 (CHAT + PLANS)
Core rules

Blocks: deny messaging if block exists either direction via Block collection (isUserBlockedEitherSide())

Creator anti-spam (first message):

if sender accountType==="creator" can start only if:

recipient is creator OR recipient follows sender

if conversation already exists → allow continue

Message model (minimum)

senderId, recipientId, conversationKey

text, createdAt

readAt (nullable)

deletedForEveryoneAt (nullable)

Rule:

all GET must filter deletedForEveryoneAt: null

Endpoints

A) Send

POST /api/messages/:recipientId

validate: no self, non-empty text

403 if blocked either-side

403 if creator restriction

403 if daily limit exceeded (return stable errorCode)

on success create message and return it

B) Conversations

GET /api/messages/conversations?limit=50

returns conversations with lastMessage (already excluding deletedForEveryoneAt)

C) Conversation + auto-read

GET /api/messages/conversation/:otherUserId?limit=50&before=...

first updateMany:

messages where recipientId=me AND senderId=other AND readAt=null → set readAt=now

then return paginated messages ordered old→new

D) Delete for everyone (soft, VIP feature)

DELETE /api/messages/:messageId

allowed only if planActive and feature enabled (Phase 1: VIP)

only if requester is sender or recipient

set deletedForEveryoneAt=now

Daily limits (Rome dayKey)

Base: 10/day

VIP (active plan): 100/day

backend is source of truth

implement counter per user/day (atomic increment on send)

Unread count

provide chatUnreadCount (either inside /me or dedicated endpoint)

computed as count of messages:

recipientId=me AND readAt=null AND deletedForEveryoneAt=null

Plans (Phase 1: VIP subscription token-based)

Data (scalable):

planKey (Phase 1: “VIP”)

planUntil (Date)

planAutoRenew (boolean)

Computed:

planActive = planUntil > now

Activation via token purchase generic:

product VIP_30D

atomic effect:

decrement token balance

ledger transaction

set planKey="VIP"

set planAutoRenew=true

set/extend planUntil by 30 days

Auto-renew (no cron required):

on authenticated core requests (at least /me, /messages/*, /plans, /tokens):

if planAutoRenew=true and planUntil<=now:

try charge tokens

if success → extend planUntil

if insufficient → leave expired; planAutoRenew stays true
UI status text: “Expired (insufficient tokens)”

Rate limiting

rate limit POST /api/messages/*

rate limit inbox/thread endpoints (anti scraping)

messages do NOT generate social notifications (badge only)