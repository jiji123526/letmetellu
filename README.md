# yap.

`yap.` is a link-based anonymous chat platform built with Next.js on Vercel and a Cloudflare backend.

Production: [yapndot.com](https://yapndot.com)

## Status

The project is in active limited-beta use. Core chat, dashboard, moderation, support, previews, media uploads, and live-session flows are implemented and deployed.

## What It Includes

- Public chat rooms addressed by shareable links
- Anonymous participation without mandatory signup
- Optional accounts for owners, channel management, and dashboard history
- Owner-side moderation, report handling, and support flows
- Realtime room updates through a channel-scoped Durable Object backend

## Features

- Link-first anonymous chat rooms with optional passcodes
- Real-time chat with replies, reactions, edit/delete, search, gallery and link panels
- Owner tools for notices, rules, welcome popups, moderation, reports and live sessions
- Account dashboard for owned and recent channels
- Browser-side caching for previews, channel appearance, and recent UI state
- Cloudflare-backed persistence with D1, R2 and Durable Objects

## Stack

- Frontend: Next.js 16, React 19, Tailwind CSS
- Auth: Auth.js / NextAuth
- API and realtime: Cloudflare Workers + WebSockets
- Database: Cloudflare D1
- Media storage: Cloudflare R2
- Room state: Durable Objects
- Hosting: Vercel + Cloudflare

## Architecture

```text
Browser -> Next.js app on Vercel
Browser -> Cloudflare Worker API / WebSocket
Worker -> D1 / R2 / Durable Objects
```

The Next.js app handles UI, authenticated routes, and dashboard flows. The Worker handles chat transport, persistence, media access, preview-related backend reads, and realtime room coordination.

## Repository Layout

```text
src/        Next.js app, dashboard, chat UI and API routes
worker/     Cloudflare Worker, D1 migrations and Durable Object logic
public/     Static assets
```

Key areas:

- `src/app/`: App Router pages including dashboard, chat routes, legal pages and API endpoints
- `src/components/`: chat UI, dashboard UI, support/admin surfaces and shared client components
- `src/lib/`: browser storage, preview caching, auth helpers, locale utilities and API helpers
- `worker/src/`: Worker routes, Durable Object logic and server-side helpers
- `worker/migrations/`: ordered D1 schema changes

## Local Development

Requirements:

- Node.js 22 recommended
- npm
- Wrangler authenticated for Cloudflare development and migrations

Install dependencies:

```bash
npm install
cd worker && npm install
```

Run the frontend:

```bash
npm run dev
```

Run the Worker in another terminal:

```bash
cd worker
npm run dev
```

Typical local setup:

- Next.js app: `http://localhost:3000`
- Worker: `http://127.0.0.1:8787`
- Frontend points to the Worker through `NEXT_PUBLIC_WORKER_URL`

## Environment

Create `.env.local` in the project root for the Next.js app:

```dotenv
AUTH_SECRET=<random-secret>
AUTH_URL=http://localhost:3000

GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>

NEXT_PUBLIC_WORKER_URL=http://127.0.0.1:8787
NEXT_PUBLIC_MOCK=false

INTERNAL_SECRET=<shared-secret-with-worker>
APP_VERSION=<optional>
```

The Worker uses `worker/wrangler.toml` plus Wrangler-managed secrets and variables for Cloudflare resources and environment-specific values.

At minimum, local development needs the frontend auth variables, a shared `INTERNAL_SECRET`, and a reachable Worker URL. Production additionally depends on Cloudflare-managed D1, R2, Durable Object bindings, and deployed Worker secrets.

## Database and Worker

Apply local D1 migrations:

```bash
cd worker
npm run db:migrate
```

Apply remote D1 migrations:

```bash
cd worker
npm run db:migrate:prod
```

Schema changes are stored in `worker/migrations`. If a change touches schema-backed Worker behavior, deploy in this order:

1. Apply the D1 migration
2. Deploy the Worker
3. Deploy the Next.js frontend

Frontend-only UI changes usually do not require a migration.

## Verification

Frontend:

```bash
npm run lint
npm run build
```

Worker:

```bash
cd worker
npm run test:hardening
```

For a production-style frontend check, run:

```bash
npm run build
npm run start
```

## Deployment

- Frontend deploys from the Next.js app to Vercel
- Backend deploys from `worker/` with Wrangler
- Production uses `https://yapndot.com` as the canonical origin
- Cloudflare resources are configured through `worker/wrangler.toml` and Wrangler secrets

## Main Routes

- `/dashboard`: account, recent channels, owned channels and support entry points
- `/ch/[slug]`: main chat room route
- `/support`: admin/support thread surface
- `/api/*`: Next.js-side authenticated and browser-facing API routes

## Notes

- `MIGRATION_NOTES.md` tracks schema and deployment-sensitive changes
- `FUTURE_PLANS.md` tracks product ideas that are not yet implemented
