# Migration Notes

This file records both the original CSS-to-TSX porting constraints and the database/platform changes made during the rebuild.

## D1 migration runbook

D1 migrations are ordered files in `worker/migrations`. Wrangler records applied migrations, so do not rename or edit a migration after it has reached production. Add a new numbered migration instead.

### Apply locally

```bash
cd worker
npm install
npm run db:migrate
```

### Apply to production

```bash
cd worker
npm run db:migrate:prod
```

For code that reads a new table or column, deploy in this order:

1. apply the production D1 migration;
2. deploy the Worker;
3. build and deploy the Next.js frontend.

This order keeps the old application compatible while the schema is changing and avoids runtime `no such table` or `no such column` failures.

### Current migration inventory

#### `0001_initial_schema.sql`

Creates the base multi-tenant schema:

- `channels`
- `messages`
- `blocked`
- `dm`
- `gallery`
- `config`
- `moderators`
- `messages_fts` and its synchronization triggers

It also creates the first channel, message, block and gallery indexes. Live sessions reuse this schema through a temporary `${channelId}_live` channel row.

#### `0002_banned_words.sql`

Adds per-channel banned words with optional expiry and a channel lookup index.

#### `0003_users.sql`

Adds registered users and the unique email index used for OAuth/account ownership.

#### `0004_user_password.sql`

Adds the nullable `users.password_hash` column.

This migration changes only the schema; it does not transform existing password values. Existing credential rows were originally stored as unsalted SHA-256. The current Worker recognizes that legacy format and attempts to replace it with salted PBKDF2 after successful verification. The production upgrade path still needs dedicated end-to-end monitoring and password-reset support.

#### `0005_hot_path_indexes.sql`

Adds indexes used by initialization and moderation:

- message reply/deletion lookup;
- blocked UID lookup;
- blocked fingerprint lookup;
- DM channel/time ordering.

These indexes increase write count slightly but prevent large row scans on common reads.

#### `0006_passcode_hint.sql`

Adds nullable `channels.passcode_hint`. The hint is display-only and must never contain the passcode itself.

#### `0007_user_recent_channels.sql`

Adds account-synced dashboard state:

- `(user_id, channel_id)` composite primary key;
- last visit timestamp;
- pinned state;
- the user's personal bubble color for that channel.

The table intentionally does not store passcodes or room tokens. Channel deletion explicitly removes matching recent records. Logged-in clients migrate existing browser recents in small batches; guest recents remain in browser storage.

The initial implementation returned 20 records. That application-level limit has since been removed; batching remains in place for migration and guest validation so D1 bound-parameter limits are not exceeded.

### Operational checks

After a migration:

```bash
cd worker
npx wrangler d1 migrations list letsplay-db --remote
```

Then verify:

- the Worker deploy completed successfully;
- the frontend production build passes;
- both owner and anonymous channel initialization still work;
- channel deletion cleans up rows introduced by newer migrations;
- no secrets or database exports are staged in Git.

---

# CSS → TSX Style Migration Notes

When porting styles from the vanilla CSS prototype to React/Tailwind components, these differences cause visual mismatches.

## Tailwind base styles inflate element height

Tailwind preflight sets a body line height and makes buttons inherit it. The original browser-button line height was closer to `1.2`, so equivalent Tailwind buttons can appear taller.

Use `lineHeight: 1` where padding, rather than text line height, defines the control height.

## Font-size inheritance

The prototype applied `var(--bubble-font-size, 17px)` globally. The Next.js version must either preserve that value on `body` or explicitly apply it to scalable components.

## Auto-sizing menus

Avoid an arbitrary `min-width` on short context menus. Korean labels are often compact and a forced width introduces excess whitespace.

## Scalable bubble padding

Dimensions that follow the user's font-size setting should use the shared variable:

```tsx
padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)"
```

Media bubbles, embedded widgets and loading bubbles intentionally use their own wrappers. Text or edited labels inside a media bubble should receive text padding explicitly rather than changing the image dimensions.

## Port checklist

1. Preserve the existing icon geometry and stroke widths.
2. Set explicit line height for compact controls.
3. Avoid fixed minimum widths unless the reference UI uses one.
4. Use `calc(var(--bubble-font-size) * ratio)` for scalable dimensions.
5. Use shared color variables such as `--hairline`, `--meta`, `--gray-text` and `--bubble-sent`.
6. Test both Korean and English labels.
7. Test the smallest supported mobile width.
8. Check loading, empty, error and long-content states.

---

## Platform progress log

### Foundation — 2026-07-23

- Rebuilt the prototype with Next.js 16 and Tailwind.
- Added Cloudflare Worker, D1, R2 and a channel-scoped Durable Object.
- Added persistent messages, WebSocket broadcasts and presence.
- Added Auth.js, channel ownership, dashboard and onboarding.
- Added server-side message validation and owner-action proxies.

### Chat, media and live mode — 2026-07-24

- Added R2 uploads, gallery, DMs, reactions, reports and FTS5 search.
- Added multiple-image sending and media loading states.
- Added native X/Twitter and Instagram widgets plus link previews.
- Added temporary live channels, live presence, emoji presets and automatic cleanup.
- Replaced event-wide refetches with payload-based local patches for normal realtime events.
- Added cursor pagination and on-demand gallery/link loading.

### Security and performance hardening

- Restricted CORS and protected internal Worker routes.
- Prevented client-side admin spoofing.
- Added owner-authenticated WebSockets for private DMs.
- Added passcode-bound room tokens and brute-force limiting.
- Added upload validation, hot-path indexes and banned-word caching.
- Added immediate broadcasts for rules, blocking, petitions, DMs, freezes and notices.
- Split large chat rendering work into memoized message, embed and reaction components.

### Dashboard and account synchronization — 2026-07-25

- Made the iMessage-style dashboard the main entry point.
- Added owned/joined section labels, swipe actions, pinning, batch edit/delete and channel deletion dialogs.
- Added guest and first-owner onboarding dialogs.
- Moved login into a dashboard dialog and kept `/login` as a redirect entry point.
- Added exact channel-address lookup while limiting name search to owned/joined channels.
- Added account-synced recent channels, pin state and personal channel colors through `0007_user_recent_channels.sql`.
- Kept guest recent channels and colors browser-local and documented that behavior in onboarding.
- Removed the recent-channel count limit.
- Enforced a maximum of five owned channels per account in a conditional Worker insert.
- Added channel passcode hints and immediate dashboard/channel-setting refresh behavior.
- Made channel deletion remove all users' recent references and notify connected anonymous users.

### Authentication transition

- Disabled new email/password signup until email verification exists.
- Kept Google OAuth as the supported signup path.
- Retained login support for existing credential accounts.
- Added a salted PBKDF2 format and legacy SHA-256 verification/upgrade code.
- Do not introduce a platform-wide administrator account for UI testing; use a scoped QA account and test channels.

## Current follow-up work

- finish email verification, password reset and monitored legacy-password migration;
- add optional owner-profile visibility per channel;
- add typing indicators;
- add operational metrics and retention policies;
- continue mobile and accessibility testing for widgets, dialogs and dashboard gestures.
