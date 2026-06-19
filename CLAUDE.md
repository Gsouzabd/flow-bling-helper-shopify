# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app does

This is an embedded Shopify app (Remix + Shopify CLI) that bridges Shopify orders with the
**Bling** ERP (Brazilian, API v3). It is not a generic template despite the README — the real
logic lives in the Bling integration. Two flows drive everything:

1. **Shopify → Bling** (`webhooks.app.orders-updated`): on `orders/updated`, find the matching
   Bling order by `numeroLoja` (= Shopify order id), write a back-reference into the Bling order's
   `observacoes`, and auto-cancel Bling orders whose PIX payment stayed `pending` > 24h.
2. **Bling → Shopify** (`api.webhook-bling-order-updated`): when a Bling order reaches situação
   `24` (verificado) or `9` (atendido), push the tracking code + nota fiscal PDF link onto the
   Shopify order as `tracking` metafields and create a Shopify fulfillment with tracking info.

The tracking code and nota-fiscal link are then surfaced to merchants/customers through the three
UI extensions under `extensions/`.

## Commands

```bash
npm run dev          # shopify app dev — local dev with tunnel, env injection, extension reload
npm run build        # remix vite:build
npm run lint         # eslint (cached)
npm run deploy       # shopify app deploy (pushes app config + extensions)
npm run setup        # prisma generate && prisma migrate deploy (run before start in prod)
npm start            # remix-serve ./build/server/index.js (expects build + setup done)
npx prisma migrate dev --name <name>   # create a migration after editing schema.prisma
```

There is no test suite. Deployment target is Fly.io (`fly.toml`, `Dockerfile`); the container runs
`npm run docker-start` (= setup + start).

## Architecture notes

- **Routing**: Remix flat-file routes under `app/routes/` (`@remix-run/fs-routes`). `app.*` = embedded
  admin UI (Polaris + App Bridge); `webhooks.*` = Shopify webhooks; `api.*` = endpoints called by
  Bling and by the UI extensions; `bling.auth.*` = Bling OAuth.

- **Two Shopify SDK instances, used for different things — do not conflate:**
  - `app/shopify.server.js` exports the `@shopify/shopify-app-remix` app object. Use its
    `authenticate.admin` / `authenticate.webhook` for request-bound auth in admin routes and Shopify
    webhooks, and `sessionStorage` to load offline sessions.
  - `app/shopify.api.js` exports a raw `@shopify/shopify-api` client. Used in `api.*` routes
    (called by Bling, with no Shopify session in the request) to build a GraphQL client from a
    manually loaded **offline session** (`offline_${shop}`).

- **Bling auth is separate from Shopify auth.** Bling uses its own OAuth2 (`bling.auth.start` →
  `bling.auth.callback`), and tokens are stored in the `BlingToken` table keyed by `shop`.
  Always obtain Bling tokens via `getValidBlingToken(shop)` in `db/blingToken.server.js` — it
  auto-refreshes when within 60s of expiry. Never read `accessToken` off `BlingToken` directly.

- **Bling API calls** live in `app/services/blingPedidos.server.js` (orders: search, cancel,
  update observação, fetch full order, fetch nota fiscal). Note Bling's PUT-to-update requires the
  *full* order object — `atualizarObservacaoPedido` mutates a previously-fetched `pedidoCompleto`
  and PUTs it back whole.

- **`db/` vs `app/`**: `db/prisma.server.js` is the singleton Prisma client; `db/*.server.js`
  hold DB access for Bling tokens and order logs. `app/db.server.js` is a *separate* Prisma
  instance used only by the Shopify session storage adapter. Supabase client
  (`app/utils/supabase.server.js`) also exists.

- **Database**: PostgreSQL via Prisma. Models: `Session` (Shopify session storage), `BlingToken`,
  `OrderLog`. `orderId` is `BigInt` — stringify before logging/JSON.

- **Bling-facing endpoints intentionally return 2xx even on logical failures.** `api.webhook-bling-order-updated`
  returns `status: 200` for most error/skip cases because Bling treats non-2xx as a delivery
  failure and retries. Preserve this when editing — see commit `769a104`.

## Environment & conventions

- Key env vars: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`,
  `DATABASE_URL`, `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_CALLBACK_URL`, `SHOPIFY_SHOP`,
  Supabase keys. The `api.*` and `bling.auth.*` routes assume a **single store** via
  `process.env.SHOPIFY_SHOP` rather than deriving `shop` from the request.
- Shopify REST calls in code use API version `2025-07`; the app config/webhooks use `2025-04` and
  the SDK is pinned to `ApiVersion.January25`. Be aware these can drift.
- Code comments, logs, and many identifiers are in Portuguese; match that when editing.
