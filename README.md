# yap.

**yap.** is a link-based, multi-tenant anonymous chat service built with Next.js and Cloudflare.

Production: [letmetellu.vercel.app](https://letmetellu.vercel.app)

## Overview

- Link-only channel access with optional passcodes and hints
- Real-time anonymous chat with replies, reactions, editing, deletion, search and reporting
- Account-backed dashboard for owned and recently joined channels
- Private owner DMs, moderation inbox flow, owner freeze/petition handling and live sessions
- Cloudflare-backed persistence with D1, R2 and one Durable Object per channel

## Current Highlights

- D1-backed durable rate limits and quotas for messages, DMs, preview fetches and daily channel reports
- Append-only moderation audit logs plus operational event logging for `429`, `403`, `5xx` and unhandled exceptions
- Explicit Worker-side security headers in addition to the existing Next.js app headers
- Multi-image chat, embeds, gallery and link panels, temporary live sessions and recent chat UI polish

## Architecture

```text
Browser ── Next.js pages and authenticated API ──> Vercel
Browser ── HTTP API and WebSocket ───────────────> Cloudflare Worker
Cloudflare Worker ── relational data ───────────> D1
Cloudflare Worker ── media ─────────────────────> R2
Cloudflare Worker ── realtime room state ───────> Durable Objects
```

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 App Router, React 19, Tailwind CSS |
| Authentication | Auth.js / NextAuth v5, Google OAuth, credentials |
| API | Cloudflare Workers |
| Database | Cloudflare D1 |
| Realtime | one `ChatRoom` Durable Object per channel |
| Media | Cloudflare R2 |
| Hosting | Vercel + Cloudflare |

Normal chat and live-session traffic share the parent channel's Durable Object. Live messages use a temporary `${channelId}_live` D1 channel and are deleted when the live session ends.

## Local Development

Requirements:

- Node.js 22 recommended
- npm
- Cloudflare Wrangler authentication for Worker and D1 work

Frontend:

```bash
npm install
npm run dev
```

Production-style frontend verification:

```bash
npm run build
npm start
```

Worker:

```bash
cd worker
npm install
npm run dev
```

Worker verification:

```bash
cd worker
npm run test:hardening
./node_modules/.bin/tsc -p tsconfig.json
```

Set `NEXT_PUBLIC_MOCK=true` to use the frontend mock implementation where supported.

## Environment

Create `.env.local` for Next.js:

```dotenv
AUTH_SECRET=<openssl-rand-base64-32>
AUTH_URL=http://localhost:3000

GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>

NEXT_PUBLIC_WORKER_URL=https://letsplay-api.letmetellu.workers.dev
NEXT_PUBLIC_MOCK=false

INTERNAL_SECRET=<same-value-as-worker-secret>
APP_VERSION=<optional-local-version-label>
```

Set `AUTH_URL` to the deployed frontend origin in production.

Worker secrets:

```bash
cd worker
npx wrangler secret put INTERNAL_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_TEST_RECIPIENT
npx wrangler secret put APP_ORIGIN
```

Never commit `.env.local`, Worker secrets, OAuth client secrets or production database exports.

## Database And Deployment

D1 migrations live in [`worker/migrations`](./worker/migrations).

```bash
cd worker

# Local D1
npm run db:migrate

# Production D1
npm run db:migrate:prod
```

Deploy schema-dependent changes in this order:

1. Apply the production D1 migration.
2. Deploy the Worker.
3. Build and deploy the Next.js frontend.

Recent schema additions:

- `0017` to `0019`: channel reports, report status, moderation state and owner petitions
- `0020`: user locale
- `0021`: durable rate limits, moderation audit logs and operational events

Frontend deployment is triggered by pushing `main`:

```bash
git push origin main
```

Worker deployment:

```bash
cd worker
npm run deploy
```

See [MIGRATION_NOTES.md](./MIGRATION_NOTES.md) for the full migration inventory, deployment notes and implementation history.

## Project Structure

```text
src/
├── app/
│   ├── dashboard/             main dashboard
│   ├── ch/[slug]/             chat route
│   └── api/                   authenticated Next.js proxies
├── components/
│   ├── chat/                  chat, panels, dialogs and live UI
│   ├── admin/                 channel administration
│   └── dashboard/             login and onboarding dialogs
├── hooks/                     auth, locale, realtime and version hooks
└── lib/                       API clients, auth, locale and recent-channel storage

worker/
├── migrations/                ordered D1 migrations
├── src/
│   ├── realtime/chat-room.ts  Durable Object
│   ├── routes/                Worker API handlers
│   └── lib/                   validation and shared server helpers
└── wrangler.toml              D1, R2 and Durable Object bindings
```

## Additional Docs

- [MIGRATION_NOTES.md](./MIGRATION_NOTES.md): migration inventory, deployment notes, security hardening history and UI porting notes
- [FUTURE_PLANS.md](./FUTURE_PLANS.md): support-ticket planning, moderation roadmap and remaining follow-up work
