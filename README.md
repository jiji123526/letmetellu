# yap.

**yap.** is a link-based, multi-tenant anonymous chat service built with Next.js and Cloudflare.

Production: [yapndot.com](https://yapndot.com)

## Overview

- Link-only channel access with optional passcodes and hints
- Real-time anonymous chat with replies, reactions, editing, deletion, search and reporting
- Account-backed dashboard for owned and recently joined channels
- Private owner DMs, guided support flow, moderation inbox flow, owner freeze/petition handling and live sessions
- Cloudflare-backed persistence with D1, R2 and one Durable Object per channel

## Current Highlights

- D1-backed durable rate limits and quotas for messages, DMs, preview fetches and daily channel reports
- Append-only moderation audit logs plus operational event logging for `429`, `403`, `5xx` and unhandled exceptions
- The 2026-07-31 bandwidth spike was reduced by moving eligible media reads off the Next.js proxy and by tightening dashboard/support polling and duplicate request paths
- Reduced dashboard and support traffic overhead through bounded polling, lighter support-preview reads and deduped preview/version requests
- The latest Worker cost pass replaces wildcard link-panel scans with an indexed `message_links` table and uses an R2-key media lookup fast path before any legacy reverse-lookup fallback
- Live sessions now auto-expire after 8 hours, and connected viewers are forced through a real expiry recheck at the deadline so the room ends visibly without waiting for a manual refresh
- Locale-aware legal pages now render only the active app language and treat a manual locale choice as higher priority than device language
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

## Service Details

### Access model

- Channels are primarily link-addressed through `/ch/[slug]`.
- Channels may be public or passcode-gated, with an optional passcode hint.
- Anonymous visitors can read and participate without creating an account.
- Logged-in users use the dashboard to create, revisit, pin and manage owned channels.
- Owned channels are private on the owner's public profile by default unless explicitly published.

### Dashboard and account behavior

- The dashboard is the main entry point for both guest and logged-in users.
- Logged-in users can own up to `5` channels.
- Owned and recently joined channels are shown separately for owners.
- The bottom-left help entry opens the user guide and guided `1:1` platform support for everyone.
- Logged-in users also get the admin guide from that same dashboard help entry.
- Logged-in users sync recent channels, pinned state, personal bubble colors, font size and locale through their account.
- Manual locale selection overrides device language for both guests and members, and the legal pages follow that active locale instead of rendering both languages together.
- Guest users keep recent channels and personal UI preferences in the current browser only.
- Exact channel address lookup supports a `/ch/...` path or a full URL, and the dashboard triggers that lookup on paste, `Enter` or mobile keyboard close.

### Chat features

- Real-time channel chat over WebSockets with one Durable Object per channel.
- Replies, reactions, edit/delete, long-message expansion and full-text search.
- Multi-image messages, R2-backed media, gallery view and link panel.
- Native YouTube, X/Twitter and Instagram embeds plus Open Graph previews for other links.
- Cursor-based loading for messages, gallery items and links.
- Historical message-context loading for older gallery or link references without forcing a jump to the newest messages.
- Korean and English UI support.

### Owner and moderation features

- Private DMs to the channel owner.
- Guests and logged-in users can start platform support from a guided chatbot-style flow and escalate to a `1:1` admin ticket only when needed.
- Support allows only one open ticket per signed actor at a time. Users can revisit the guide while a ticket is open, but cannot submit another ticket until the active ticket is closed.
- Closing the guided support panel clears the in-progress guided session so reopening starts from the first step again.
- Guest support previews are mirrored in browser local storage for dashboard reopen convenience, while Worker authorization still uses signed anonymous/device identity cookies.
- Users can remove their temporary `1:1` support dashboard item, and that action also closes the underlying ticket on the super-admin side.
- The dashboard now reads support preview state from a lightweight support-preview endpoint instead of fetching full transcripts or thread messages just to render the temporary `1:1` item.
- Channel rules, notice banner, welcome popup, freeze/unfreeze and banned words with expiry.
- Block and unblock by anonymous identity plus server-issued device token.
- Non-owner channel reports routed to a private reports inbox channel.
- Owner warning, freeze, delete and petition flows for moderated channels.
- Super admin dashboard routing is split between `Report` and `Tickets`: reports still resolve through the reports inbox channel, while escalated support tickets appear as channel-like entries and open in `/support`.
- The reports inbox now keeps unresolved reports at the bottom, exposes a restricted-channel summary, and offers simple `Open`, `Warned`, and `Frozen` filters from the plus menu.
- Support tickets now track unread state, waiting side, stale age and operator summary data so the super admin can triage without reading the whole thread first.
- Super-admin `1:1` ticket rows use topic-specific simple icons instead of a generic profile image slot.
- The super-admin dashboard loads all open tickets plus a bounded recent-closed window instead of reloading the entire historical ticket archive on each refresh.
- Super-admin support threads keep the guided summary as ticket context and suppress the duplicated seed message bubble when that first user message is the same summary text.
- Temporary live sessions with a separate live message stream, title, emoji presets, an 8-hour hard limit, immediate end-state sync for connected viewers at the deadline, and hourly cleanup fallback for abandoned sessions.

### Authentication and safety model

- Auth.js supports Google OAuth plus existing credential accounts.
- Credential signup and password reset use email verification and single-use expiring links.
- Owner actions are authenticated through the Next.js app and re-checked by the Worker with `INTERNAL_SECRET` and owner identity.
- Anonymous write actions use Worker-issued anonymous and device tokens stored in HttpOnly cookies rather than trusting raw client identifiers.
- Anonymous support uses the same signed anonymous identity model through the Next.js `/api/support` proxy rather than trusting a raw browser-local ticket id.
- The service no longer relies on browser-derived fingerprinting for chat identity or abuse control.
- Anonymous and device identifiers are random first-party signed tokens with a 90-day lifetime rather than canvas or user-agent fingerprints.
- Message, DM, report and preview routes now enforce durable D1-backed rate limits or quotas where appropriate.
- Device identifiers are kept for abuse controls such as blocking and report deduplication, but are no longer persisted on normal chat messages.
- Anonymous block actions now resolve from a server-only message or DM actor map, so owners can block by row without receiving raw device identifiers.
- Device-based block keys are HMAC-hashed before persistence, with legacy raw-device and fingerprint lookups kept only as compatibility fallbacks during migration.
- IP-based abuse controls use HMAC-hashed identifiers rather than raw IP storage.
- Moderation actions are recorded in append-only audit logs, and the Worker records lightweight operational failure events for abuse and reliability monitoring.

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

Production frontend values:

```dotenv
AUTH_URL=https://yapndot.com
APP_ORIGIN=https://yapndot.com
NEXT_PUBLIC_APP_ORIGIN=https://yapndot.com
```

Use `https://yapndot.com` as the canonical origin. Redirect `www.yapndot.com`
to the apex domain rather than serving both as independent application origins.

Google OAuth production configuration uses two provider-specific callbacks:

```text
https://yapndot.com/api/auth/callback/google-login
https://yapndot.com/api/auth/callback/google-signup
```

Worker secrets:

```bash
cd worker
npx wrangler secret put INTERNAL_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put APP_ORIGIN
```

Production email is sent through the verified Resend domain as
`yap. <noreply@send.yapndot.com>`. The former `EMAIL_TEST_RECIPIENT` sandbox
gate is no longer used.

Set the production Worker `APP_ORIGIN` secret to `https://yapndot.com`. The
Worker CORS allowlist keeps the Vercel hostname during the DNS transition and
can remove it after the custom domain has been stable and smoke-tested.

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
- `0022`: message paging indexes, upload-ticket quota indexes and retention-support indexes
- `0023`: privacy-focused device-id transition and legacy message-identifier cleanup
- `0024`: server-only anonymous actor identities for message-based block resolution
- `0025`: guided support sessions, escalated support threads and support messages
- `0026`: support read state, support audit logs and operator triage signals
- `0027`: support audit retention index and support-dashboard load shaping support

Frontend deployment is triggered by pushing `main`:

```bash
git push origin main
```

Worker deployment:

```bash
cd worker
npm run deploy
```

Support, moderation and dashboard routing changes often span both runtimes. If a change touches support routes, report routing or dashboard-admin surfaces, deploy the Worker and the Next.js frontend together after any required D1 migration.

Recent deployment notes:

- `Bypass Vercel media proxy for worker assets` was the main fix for the Vercel outgoing-origin-transfer spike: media reads that already have guest or room-token access now redirect straight to the Worker instead of proxying large responses through Vercel.
- `Fix dashboard request loop for admin support` and `Reduce dashboard and support traffic overhead` were the main fixes for the edge-request spike: admin polling was reduced, user support preview is now conditional, support-thread refresh is visibility-aware, `/api/user` became read-first, and duplicate preview/version/locale writes were removed.
- `Reduce dashboard and support traffic overhead` required both Worker and frontend deploys, but no new D1 migration.
- `Optimize media lookup and links indexing` adds D1 migration `0028_media_lookup_and_message_links.sql`, moves the links panel onto an indexed lookup table, reduces protected-media D1 lookup work on the hot path, and further slows background dashboard/support polling.
- `Refine locale-specific legal pages` is frontend-only and does not require a Worker deploy or migration.

See [MIGRATION_NOTES.md](./MIGRATION_NOTES.md) for the full migration inventory, deployment notes and implementation history, including recent frontend-only support/report/dashboard polish that required no schema changes.

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
- [FUTURE_PLANS.md](./FUTURE_PLANS.md): support-flow follow-up, moderation roadmap and remaining platform work
