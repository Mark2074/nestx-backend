MEMO IMPLEMENTAZIONI — FASE 2 (CHAT + PLANS)
Plans multi-tier

/plans shows: VIP / Premium / Premium+

product catalog:

VIP_30D, PREMIUM_30D, PREMIUM_PLUS_30D

optional durations: 90/365

same generic token purchase flow (by productKey)

Feature flags per plan

Move perks to config-driven features:

dailyMessageLimit

canDeleteForEveryone

future perks (search filters, etc.)

Renewal robustness

optional scheduled job for batch renew attempts

keep on-demand renew on core requests

Chat realtime (optional)

websocket/SSE for message delivery + read sync

fallback: polling remains valid