# ANANDA — architecture and conventions

Source of truth for behaviour: `ANANDA_Functional_PRD_v1.docx` (requirement IDs such as FR-SALE-6 are cited in code).
Source of truth for look: the ANANDA design system (tokens in `apps/web/app/styles/tokens.css`, component CSS in `components.css`).

## Layout

```
packages/shared   Domain rules used by both sides: flavours, price tiers, VAT, commission, excise,
                  roles and the permission matrix, statuses, zod request schemas, locale formatting.
apps/api          NestJS 11 + Drizzle ORM + PostgreSQL. One module per PRD area under src/<area>.
apps/web          Next.js 16 (App Router) + React 19 + TanStack Query + next-intl (EN, BG, HE/RTL).
```

Ports: web http://localhost:3010, API http://localhost:4010 (the web proxies `/api/*` to it so the
session cookie is first-party), Postgres localhost:5433, Mailpit UI http://localhost:8026.

```
pnpm install
pnpm db:up          # Postgres + Mailpit in Docker
pnpm db:reset       # empty DB, migrate, seed demo data
pnpm dev            # shared (watch) + api (watch) + web
```

Demo users (password `ananda-demo-2026`; two-step code `000000` in development):
royi@ (System admin), maya@ (Admin), finance@, warehouse@, ivan@ / petya@ / dimitar@ (agents) — all `@ananda.bg`.

## API conventions

- **Guard on every route** (`common/auth.guard.ts`): session cookie, two-step sign-in, area access and
  sensitive actions. Decorate handlers with `@Access('view' | 'edit', ...areas)` and, for sensitive
  actions, `@Sensitive(action)`. Actions in `STEP_UP_ACTIONS` also need the header `x-two-step-code`;
  the guard verifies it, handlers do nothing extra.
- **Record scope** on the server for every list, detail, search, export: `orderScope(auth)`,
  `customerScope(auth)`, `agentFilter(auth)` in `core/scope.ts`. Return 404, not 403, for records out of scope.
- **Money is integer cents and every money field name ends in `Cents`** (unit costs that need fractions
  of a cent are numeric, still named `...Cents`). `PriceStripInterceptor` removes keys matching
  `/Cents$|price|cost|commission|profit|stockValue|margin/` for users without "See prices" (Warehouse).
  Never name a non-money field like that, and never put money under another name.
- **One definition per figure**: `FiguresService` (owed to us, late, net sales, could close, deal
  profit) and `StockService` (in stock, reserved, available, on the way, landed cost, runway). Use them;
  don't recompute.
- **Writes**: inside `db.transaction`, lock the row (`.for('update')`), check the state machine, write,
  then `audit.log(auth, {...}, tx)` in the same transaction (before → after for money fields, `money: true`).
  Notifications via `NotifyService`, e-mails via `MailService` (after the transaction commits).
  The audit log is append-only (DB trigger).
- **Realtime**: `RealtimeInterceptor` pushes a refetch to every open client after any successful write.
- **Validation**: zod schemas from `@ananda/shared` with `new ZodPipe(schema)`. Errors come back as
  `{ message, fields: { field: 'how to fix it' } }`.
- **Order flow** lives in `orders/orders.service.ts` (global). Other modules call it: `deliver`,
  `partOutcome`, `waitingForStock`, `allocate`, `sendToWarehouse`. Never update `orders.status` elsewhere.
- **Stock** changes only through `StockService.move()` (ledger in `stock_movements`; event stock uses `eventId`).
- **Documents**: issued documents are frozen snapshots in `documents.data`; corrections create a new
  document. Uploads: `FileInterceptor('file')` + `FilesService.save()` + a `documents` row (`type: 'upload'`).
- **Numbers**: `NumberingService.next(tx, key)` inside the transaction (gapless).
- Run the seed through the compiled app (`pnpm db:seed`) because Nest DI needs decorator metadata.

## Web conventions

- Pages are client components at `app/(app)/<route>/page.tsx`; the shell, session and providers are set up.
  Reference page: `app/(app)/sales/page.tsx`.
- Data: `useQuery({ queryKey: ['<area>', ...], queryFn: () => api.get(...) })`; writes with `useAction`
  (`lib/hooks.ts`) which shows field errors, toasts and refetches. Sensitive actions pass `{ code }`
  (`api.post(path, body, { code })`) collected with `<TwoStepField>` in the panel.
- Permissions: `useSession()` → `canView(area)`, `canEdit(area)`, `can(action)`, `isAgent`,
  `isWarehouse`, `isAdmin`, `readOnly` (Preview as role). Only show actions that are possible right now.
- Components from `@/components/ui` only; no hard-coded colours, sizes or radii; logical properties
  (`margin-inline-start`, `inset-inline-end`) so Hebrew mirrors. Wrap amounts and codes in `<bdi>`.
- Desktop shows a `Table` in a `Card flush`; phone shows `ListCard`s (`.only-wide` / `.only-phone`).
  Actions open a `Sheet` (side panel on desktop, bottom sheet on phone). Confirm with a toast.
  Empty lists use `EmptyState` with one action. Filters are a `Chips` row; header filters `SelectPill`.
- Formatting: `useFmt()` → `money(cents, whole?)`, `unit()`, `num()`, `date()`, `dateShort()`.
- Copy: `useTranslations('<namespace>')`, one JSON per area in `messages/en/<namespace>.json`
  (BG and HE fall back to EN until translated). Plain, short sentence case; buttons are verbs.
- Flavours always in the order Aloha, Gaia, Santorini, Kyoto, each with its name (`FlavourName`).
- Status always as a word (`Pill`, `OrderStatusPill`), never colour alone.
