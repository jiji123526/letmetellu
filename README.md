# yap.

`yap.` is a link-based anonymous chat platform. Visitors can enter a channel from a shared URL and participate without creating an account, while signed-in owners receive channel management, moderation, and dashboard tools.

Production: [yapndot.com](https://yapndot.com)

## Project Status

The service is running as a monitored limited beta. The production deployment includes the main chat experience, account dashboard, media and link previews, owner moderation, platform reports, guided support, and temporary live sessions.

Work remaining before a broad public launch is primarily operational hardening: wider regression coverage, calibrated alerts, stricter CSP enforcement, retryable cross-store cleanup, and broader abuse controls. See [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) for the current release gate.

Production health investigation and response procedures are documented in
[OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md).

## Product Overview

### Chat

- Public and passcode-protected channels at `/ch/[slug]`
- Realtime messages over WebSockets
- Replies, reactions, editing, deletion, search, and long-message expansion
- Multi-image messages backed by Cloudflare R2
- Gallery and link panels with historical message navigation
- YouTube and Instagram embeds, lightweight X cards, and Open Graph previews
- Per-user bubble color, font size, locale, and channel appearance preferences
- Korean and English interfaces

Message history uses cursor-based paging. Refreshing an open channel restores that tab's visible position, while leaving and re-entering a channel starts at the newest message.

### Channel Ownership

- Up to five owned channels per signed-in account
- Optional passcodes and passcode hints
- Channel profile, background, color, rules, notice, and welcome-popup settings
- Private messages from visitors to the channel owner
- Message blocking, banned words, freeze controls, and owner petitions
- Temporary live sessions with a separate message stream and automatic expiry
- Optional public owner profile containing selected channels

### Dashboard and Support

- Separate owned and recently visited channel lists
- Account-synced recent channels, pinned state, locale, font size, and personal colors
- Browser-local recent channels and preferences for guests
- Guided troubleshooting with escalation to a platform support ticket
- Super-admin queues for channel reports and escalated support tickets
- Operational health summaries for moderation and production failures

### Browser Caching

- Link-preview metadata uses the browser Cache API with bounded retention
- Channel background metadata is restored locally while authoritative settings refresh
- Background images and eligible media use normal HTTP caching
- Dashboard snapshots can restore recent account state while current data loads

The Worker and authenticated APIs remain authoritative. Browser storage is used to improve startup and repeat visits, not as the source of permission or moderation state.

## Architecture

```text
                              +----------------------+
Browser -- pages and APIs --> | Next.js on Vercel   |
   |                          | Auth.js + API proxy  |
   |                          +----------+-----------+
   |                                     |
   +-- HTTP and WebSocket ----------------+
                                         v
                              +----------------------+
                              | Cloudflare Worker    |
                              +----+---------+-------+
                                   |         |
                         +---------+         +----------------+
                         v                                    v
                  D1 relational data                  R2 media objects
                         |
                         v
                  Durable Objects
                  realtime room state
```

| Layer | Responsibility |
| --- | --- |
| Next.js | Pages, dashboard, Auth.js sessions, authenticated API proxies, and response security headers |
| Cloudflare Worker | Chat APIs, authorization enforcement, previews, uploads, support, moderation, and scheduled maintenance |
| Durable Objects | Per-channel WebSocket connections, live-session presence, room access state, and channel-scoped rate limits |
| D1 | Accounts, channels, messages, support, reports, configuration, audit records, and durable quotas |
| R2 | Uploaded chat media, profile images, and channel backgrounds |

Normal chat and live-session clients connect through the parent channel's Durable Object. Live messages use a temporary live channel record and are cleaned up when the session ends.

## Identity and Security

- Auth.js supports Google OAuth and credential accounts.
- Owner and platform-admin actions pass through authenticated Next.js routes and are re-authorized by the Worker.
- Anonymous visitors use server-issued signed identities stored in HttpOnly cookies.
- Passcode-protected rooms issue scoped room access tokens instead of exposing passcodes to later requests.
- Device and network abuse identifiers are HMAC-hashed before durable storage.
- Message, upload, preview, report, and support paths apply route-appropriate validation and rate limits.
- Moderation and support actions produce audit records; operational failures are retained in bounded event storage.
- Next.js and the Worker send explicit security headers and origin restrictions.

The production CSP currently permits `script-src 'unsafe-inline'` for required startup behavior. This is an accepted limited-beta trade-off documented in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).

## Technology

| Area | Technology |
| --- | --- |
| Frontend | Next.js 16 App Router, React 19, Tailwind CSS 4 |
| Authentication | Auth.js / NextAuth 5 |
| API | Cloudflare Workers |
| Realtime | WebSockets and Durable Objects |
| Database | Cloudflare D1 |
| Media | Cloudflare R2 |
| Hosting | Vercel and Cloudflare |
| Testing | Node test runner, TypeScript, ESLint, and Wrangler dry-run |

## Main Routes

| Route | Purpose |
| --- | --- |
| `/` | Product entry and authentication |
| `/dashboard` | Owned channels, recent channels, reports, and support entries |
| `/ch/[slug]` | Main channel chat |
| `/support` | Guided support and platform support threads |
| `/privacy`, `/terms` | Locale-aware legal documents |
| `/api/*` | Next.js-side browser and authenticated API boundary |

## Repository Layout

```text
src/
  app/                 Next.js pages, metadata, and API routes
  components/chat/     Chat UI, panels, overlays, and navigation
  components/admin/    Channel-owner administration
  components/support/  Guided support and operator views
  hooks/               Locale, authentication, and client behavior
  lib/                 API clients, caching, storage, identity, and utilities

worker/
  migrations/          Ordered D1 migrations
  scripts/             Operational and audit SQL
  src/routes/          Worker HTTP endpoints
  src/realtime/        ChatRoom Durable Object
  src/lib/             Authorization, validation, caching, and maintenance
  tests/               Worker authorization and hardening tests
  wrangler.toml        Worker, D1, R2, Durable Object, and cron bindings
```

## Local Development

### Requirements

- Node.js 22
- npm
- Wrangler authentication for Cloudflare development, migration, and deployment work

Install frontend and Worker dependencies:

```bash
npm install
cd worker
npm install
```

Run the Worker:

```bash
cd worker
npm run dev
```

Run the frontend from the repository root in another terminal:

```bash
npm run dev
```

The default local addresses are:

- Next.js: `http://localhost:3000`
- Worker: `http://127.0.0.1:8787`

Set `NEXT_PUBLIC_MOCK=true` to use the available frontend chat and support mocks without a live Worker.

## Environment

Create `.env.local` in the repository root:

```dotenv
AUTH_SECRET=<random-auth-secret>
AUTH_URL=http://localhost:3000

APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000

GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>

NEXT_PUBLIC_WORKER_URL=http://127.0.0.1:8787
NEXT_PUBLIC_MOCK=false

INTERNAL_SECRET=<shared-nextjs-worker-secret>
APP_VERSION=<optional-local-version>
```

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs and protects Auth.js session data |
| `AUTH_URL` | Canonical Auth.js origin |
| `APP_ORIGIN` | Server-side application origin for links and email flows |
| `NEXT_PUBLIC_APP_ORIGIN` | Public canonical application origin |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google login and signup |
| `NEXT_PUBLIC_WORKER_URL` | Worker HTTP and WebSocket origin |
| `NEXT_PUBLIC_MOCK` | Enables supported local mock APIs |
| `INTERNAL_SECRET` | Authenticates trusted Next.js-to-Worker requests |
| `APP_VERSION` | Optional local build label; production uses the Vercel commit SHA |

For local Worker secrets, create the ignored file `worker/.dev.vars`:

```dotenv
INTERNAL_SECRET=<same-value-as-nextjs>
RESEND_API_KEY=<resend-api-key>
APP_ORIGIN=http://localhost:3000
```

Production Worker secrets are managed through Wrangler:

```bash
cd worker
npx wrangler secret put INTERNAL_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put APP_ORIGIN
```

The Worker bindings for D1 (`DB`), R2 (`MEDIA`), Durable Objects (`CHAT_ROOM`), allowed origins, the reports channel, and scheduled maintenance are defined in `worker/wrangler.toml`.

Never commit `.env.local`, `worker/.dev.vars`, OAuth credentials, Worker secrets, or production data exports.

## Database

D1 migrations are ordered SQL files in `worker/migrations`.

Apply migrations locally:

```bash
cd worker
npm run db:migrate
```

Apply migrations to the configured remote database:

```bash
cd worker
npm run db:migrate:prod
```

Schema-dependent releases should be deployed in this order:

1. Apply the D1 migration.
2. Deploy the Worker.
3. Deploy the Next.js frontend.

Frontend-only changes do not require a migration or Worker deployment. Check [MIGRATION_NOTES.md](./MIGRATION_NOTES.md) for change-specific deployment requirements.

## Verification

Frontend checks:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Worker checks:

```bash
cd worker
npm run test:hardening
npx tsc --noEmit
npx wrangler deploy --dry-run
```

The `Worker security and type checks` GitHub Actions workflow runs Worker hardening tests, TypeScript validation, and a Wrangler dry-run for relevant pushes and pull requests.

## Deployment

Deploy the Worker:

```bash
cd worker
npm run deploy
```

The frontend deploys to Vercel from the Next.js application. Production uses `https://yapndot.com` as the canonical application origin.

Use the narrowest deployment required:

- Frontend-only change: deploy Vercel only.
- Worker-only change: deploy the Worker only.
- Schema and Worker change: migrate D1, then deploy the Worker.
- Mixed change: migrate if needed, deploy the Worker, then deploy the frontend.

After production changes, run the relevant smoke tests in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md), especially for authentication, locked channels, media, previews, live sessions, support, and moderation.

## Project Documentation

- [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md): release gates, production checks, and rollback readiness
- [MIGRATION_NOTES.md](./MIGRATION_NOTES.md): schema inventory, implementation history, and deployment notes
- [FUTURE_PLANS.md](./FUTURE_PLANS.md): planned product and platform work
- [SECURITY_AUTHORIZATION_MATRIX.md](./SECURITY_AUTHORIZATION_MATRIX.md): identity evidence and privileged route boundaries
