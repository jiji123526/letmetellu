# Let Me Tell U

Link-based, multi-tenant anonymous chat built with Next.js and Cloudflare.

Production: [letmetellu.vercel.app](https://letmetellu.vercel.app)

## Current status

The project is a deployed MVP with:

- anonymous, link-only channel access with optional passcodes and hints;
- real-time chat over WebSockets;
- replies, reactions, editing, deletion, reporting, blocking and banned words;
- multiple-image messages, R2 media storage, gallery and link panels;
- private DMs visible only to the channel owner;
- temporary live sessions with configurable emoji presets and automatic session cleanup;
- channel notices, rules, welcome messages and chat freezing;
- Korean and English UI;
- an iMessage-style dashboard for owned and recently joined channels.

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
| Authentication | Auth.js / NextAuth v5, Google OAuth, existing credential accounts |
| API | Cloudflare Workers |
| Database | Cloudflare D1 |
| Realtime | one `ChatRoom` Durable Object per channel |
| Media | Cloudflare R2 |
| Hosting | Vercel + Cloudflare |

Normal channel and live-session traffic share the parent channel's Durable Object. Live messages use a temporary `${channelId}_live` D1 channel and are deleted when the session ends.

## Dashboard behavior

- The dashboard is the main entry point for logged-in and guest users.
- Logged-in users can own up to **5 channels**. The Worker enforces this limit.
- Logged-in users' recent channels, pinned state and personal channel colors are stored in `user_recent_channels` and follow the account across devices.
- Guest users' recent channel list and personal colors stay in that browser only.
- Recent joined channels have no application-level count limit.
- Name search covers only owned or previously joined channels.
- A new channel can be resolved by entering an exact `/ch/name`, domain path or full URL and pressing Enter. Pasting a complete address resolves it immediately.
- Owned and joined channels are labeled separately for logged-in owners.
- Deleting an owned channel removes its messages, DMs, gallery entries, configuration, media and recent-list references.

## Authentication status

- Google OAuth is the supported signup path.
- The Credentials provider remains available for existing email/password accounts, but the production legacy-login upgrade path is currently under investigation.
- New credential signup is intentionally disabled until email ownership verification is implemented.
- Legacy SHA-256 password records are still recognized by the Worker; the current code attempts to upgrade a successful legacy login to salted PBKDF2.
- There is no platform-wide administrator role. Administration is scoped to channel ownership.

Before expanding credential login, finish and test email verification, password reset and the legacy-hash upgrade path in production.

## Chat and moderation

### Messaging

- D1-backed messages with WebSocket payload broadcasts
- replies, reactions, edit/delete and long-message expansion
- multi-image upload with captions
- YouTube, X/Twitter, Instagram and Open Graph embeds
- cursor-based message, gallery and link pagination
- full-text search using D1 FTS5
- loading and reconnect states without forced scroll jumps

### Channel controls

- optional passcode and passcode hint
- channel rules, notice banner and configurable welcome popup
- freeze/unfreeze
- banned words with expiry
- block/unblock by anonymous UID and device fingerprint
- optional petitions from blocked users
- optional private DM to the owner
- profile image, channel name and channel color

### Live sessions

- separate temporary message and DM storage
- owner-configured title and emoji presets
- live-only notice and freeze state
- viewer count through the channel Durable Object
- automatic deletion of live messages, DMs, gallery records and R2 media at session end

## Security model

- Vercel validates Auth.js sessions before forwarding owner actions.
- Vercel and the Worker share `INTERNAL_SECRET`; the Worker also verifies `X-User-Id` ownership.
- Anonymous users cannot mark messages as administrative.
- WebSocket owner authentication uses short-lived tokens from `/api/ws-token`.
- Passcode-protected endpoints require a signed room token tied to the current passcode hash.
- Message length, upload type/size, rate limits, freeze state, blocked users and banned words are enforced server-side.
- DMs are sent only to owner-authenticated WebSocket connections.
- SQL uses bound parameters.
- CORS is restricted to the production origin and local development.

## Local development

Requirements:

- Node.js 22 recommended
- npm
- Cloudflare Wrangler authentication for Worker and D1 work

```bash
npm install
npm run dev
```

Production-style frontend verification:

```bash
npm run build
npm start
```

Worker development:

```bash
cd worker
npm install
npm run dev
```

Set `NEXT_PUBLIC_MOCK=true` to use the frontend mock implementation instead of the Worker where supported.

## Environment variables

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

Configure the same frontend variables in Vercel. `VERCEL_GIT_COMMIT_SHA` is supplied by Vercel and is used as the deployed version identifier.

Configure the Worker secret:

```bash
cd worker
npx wrangler secret put INTERNAL_SECRET
```

Never commit `.env.local`, Worker secrets, OAuth client secrets or production database exports.

## Database migrations

D1 migrations live in `worker/migrations`.

```bash
cd worker

# Local D1
npm run db:migrate

# Production D1
npm run db:migrate:prod
```

Apply a required migration **before** deploying Worker code that queries the new table or column.

Current migrations:

| Migration | Purpose |
| --- | --- |
| `0001_initial_schema.sql` | channels, messages, DMs, gallery, config, moderation, FTS5 |
| `0002_banned_words.sql` | per-channel banned words and expiry |
| `0003_users.sql` | user accounts |
| `0004_user_password.sql` | credential password hash column |
| `0005_hot_path_indexes.sql` | message, block and DM indexes |
| `0006_passcode_hint.sql` | optional channel passcode hint |
| `0007_user_recent_channels.sql` | account-synced recents, pins and personal colors |

See [MIGRATION_NOTES.md](./MIGRATION_NOTES.md) for schema details and the deployment runbook.

## Deployment

Frontend deployment is triggered by pushing `main` to GitHub:

```bash
git push origin main
```

Worker deployment:

```bash
cd worker
npm run deploy
```

For changes involving D1, use this order:

1. `npm run db:migrate:prod`
2. `npm run deploy`
3. run `npm run build` at the repository root
4. push the frontend commit

## Project structure

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

## Known follow-up work

- email verification and password reset;
- validate and harden the legacy credential upgrade path;
- optional profile visibility controls for owner channels;
- typing indicators;
- additional social login providers;
- operational metrics, abuse controls and retention policies.
