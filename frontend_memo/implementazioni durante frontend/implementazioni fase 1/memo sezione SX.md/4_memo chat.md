MEMO DEFINITIVO — CHAT FRONTEND (FASE 1)
Scope

DM 1-to-1 only (no groups / no public / no live chat)

No external references (Telegram/Discord/WhatsApp etc.) anywhere in UI/copy

Routes

/chat → Inbox

/chat/:userId → Thread

Sidebar

SX shows Chat with badge chatUnreadCount

SX reads only minimal state: me minimal + chatUnreadCount

Inbox

API:

GET /api/messages/conversations?limit=50

Render each conversation:

other user avatar + name

lastMessage.text snippet

timestamp

unread indicator if:

lastMessage.recipientId === me AND lastMessage.readAt === null

Empty (0 conversations):

centered text only: “You have no messages.”

no CTA, no explanation

Thread

API:

GET /api/messages/conversation/:otherUserId?limit=50&before=... (cursor for “Load older”)

Behavior:

messages align right if senderId === me, left otherwise

timestamps shown

auto-read handled by backend on open

Empty (0 messages):

centered text: “No messages yet.”

Send

API:

POST /api/messages/:recipientId body { text }

optimistic append + replace with response

Errors:

400 empty → toast: “The message can’t be empty.”

403 block → toast: “You can’t send messages due to an active block.”

403 creator restriction → toast: “You can message this user only if they follow you.”

403 daily limit:

Base → modal upsell + button “Go VIP” → /plans

Active plan → toast: “Daily message limit reached.”

Delete (plan feature)

show “Delete for everyone” only if planActive AND feature enabled (Phase 1: VIP)

DELETE /api/messages/:messageId

remove immediately from UI (soft delete)

Profile CTA “Message”

label: Message

hidden if block either-side

disabled if creator restriction (first message) with tooltip:

“You can message this user only if they follow you.”

disabled if Base daily limit reached:

tooltip: “Daily message limit reached.”

click → upsell modal → /plans

active click → navigate to /chat/:userId

Plans page integration

/plans shows VIP (Phase 1)

expired for tokens shows: “Expired (insufficient tokens)”

CTA: “Top up tokens” → /tokens

Unread badge refresh (Phase 1)

refresh chatUnreadCount:

on login

poll every 60s

immediately when entering /chat or opening a thread