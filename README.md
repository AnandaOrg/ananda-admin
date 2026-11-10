# ANANDA — operations & finance

Web and phone app for selling four canned-cocktail flavours through commissioned agents:
approvals, payments, warehouse dispatch, purchasing, stock, collections, commissions and finance
reporting. Built from `ANANDA_Functional_PRD_v1.docx` and the ANANDA design system.

- **Backend:** NestJS 11, Drizzle ORM, PostgreSQL 17
- **Frontend:** Next.js 16 (App Router), React 19, TanStack Query, next-intl (English, Bulgarian, Hebrew with right-to-left)
- **Shared:** `packages/shared` holds the business rules both sides use (price tiers, VAT, commission, excise, roles and permissions, statuses, request schemas, money and date formatting)

## Run it with Docker (everything)

```bash
docker compose up -d --build     # db, mail, api, web
```

- App: http://localhost:3010
- API: http://localhost:4010/api
- Mail inbox (every e-mail the app sends): http://localhost:8026
- Postgres: localhost:5433 (user `ananda`, password `ananda`, database `ananda`)

The API applies migrations on start and loads the demo data once when the database is empty
(`SEED_DEMO=true`). To start over: `docker compose down -v && docker compose up -d --build`.

The compose file is for local use: it allows plain-http cookies (`COOKIE_SECURE=false`) and the demo
two-step code (`ALLOW_DEV_TWO_STEP_CODE=true`). Remove both, use real secrets and serve over HTTPS on a
real server.

## Run it for development

Requirements: Node 22+ (tested on 26), pnpm 11, Docker.

```bash
pnpm install
pnpm db:up        # only Postgres (:5433) and Mailpit (:1026 SMTP, :8026 inbox) in Docker
cp apps/api/.env.example apps/api/.env
pnpm db:reset     # empty database, run migrations, load demo data
pnpm dev          # API on http://localhost:4010, web on http://localhost:3010
```

Open http://localhost:3010. Every e-mail the app sends (proformas, invoices, reminders,
invitations) lands in Mailpit at http://localhost:8026.

### Demo sign-ins

Password for all: `ananda-demo-2026`. Admin, System admin and Finance need a two-step code;
in development `000000` works (set by `DEV_TWO_STEP_CODE`; never accepted in production).
The seed also prints a real authenticator secret.

| E-mail | Role |
|---|---|
| royi@ananda.bg | System admin |
| maya@ananda.bg | Admin |
| finance@ananda.bg | Finance |
| warehouse@ananda.bg | Warehouse (phone app) |
| ivan@ananda.bg, petya@ananda.bg, dimitar@ananda.bg | Sales agents |

## Tests

```bash
pnpm --filter @ananda/shared test   # price tiers, totals, commission, excise, runway, formatting
pnpm --filter @ananda/api test      # end-to-end against the running API: Journey 2, scope, two-step, figures
```

## Where things are

See `docs/ARCHITECTURE.md` for the conventions (permissions, record scope, money fields, audit,
realtime, documents) and the layout of each app.

## Configuration

`apps/api/.env`: `DATABASE_URL`, `PORT`, `WEB_ORIGIN`, `SMTP_*`, `MAIL_FROM`, `UPLOAD_DIR`,
`DEV_TWO_STEP_CODE` (development only), `ANTHROPIC_API_KEY` (optional: enables "Polish with AI"
on drafted e-mails, using Claude Opus 5.5 with server-side refusal fallback).

`apps/web`: `API_URL` (default `http://localhost:4010`) — the web app proxies `/api/*` to it.

## Open decisions

The defaults from PRD section 11 are implemented (A4 Send to pay e-mails the accountant, A5 credit
after paid commission offsets the next payout, A6 admin decides part deliveries, A7 manual
allocation with oldest preselected, A8 stock hold released after 7 unpaid days, A9 reason lists,
A12 expired proforma reminds the agent, A14 two-step code for supplier payments, B2 "Sales this
year" = fully paid excl. VAT). VAT is rounded once per document until the accountant confirms;
"late" uses each customer's payment terms.
