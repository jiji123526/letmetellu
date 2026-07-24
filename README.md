# letsplay-v2

Multi-tenant anonymous chat platform — rebuilt on Next.js + Cloudflare.

## Status

**Production-ready MVP.** Fully functional multi-tenant anonymous chat with real-time messaging, auth, admin controls, image upload (R2), search, reactions, DM, live mode, and full server-side security. Embeds and platform features remaining.

---

## Architecture

```
Browser ←── HTTP/SSR ──→ Vercel (Next.js 16, App Router, Tailwind)
Browser ←── WebSocket ──→ Cloudflare Worker (Durable Objects)
Browser ←── HTTP/API ──→ Cloudflare Worker (D1, R2)
```

| Layer | Technology | Status |
|-------|-----------|--------|
| Frontend | Next.js 16 (App Router) + Tailwind CSS | ✅ Deployed |
| Database | Cloudflare D1 (SQLite) | ✅ Schema applied, messages persisting |
| Realtime | Cloudflare Durable Objects + WebSocket | ✅ Working (multi-tab confirmed) |
| Auth | Auth.js (NextAuth v5) | ✅ Google OAuth + email/password |
| Storage | Cloudflare R2 | ✅ Working (upload + serve) |
| Backend API | Cloudflare Workers | ✅ Full validation (rate limit, banned words, fingerprint) |

---

## What's Done

### Chat UI (complete, mock mode)
- [x] iMessage-style bubbles (scales with font setting)
- [x] Context menu (long-press: reply, report, edit, delete)
- [x] Emoji picker (quick bar + full picker via emoji-picker-element)
- [x] Reaction badges (Slack-style pills below bubbles)
- [x] Reply threading with curved arrows
- [x] DM mode (purple styling, admin-only visibility)
- [x] Photo staging with preview thumbnails + caption
- [x] Report system (local marking + admin notification)
- [x] Scroll-to-bottom button
- [x] Welcome popup (first-time visitors)
- [x] Korean IME Enter key fix

### Real-time Messaging (working)
- [x] Messages persist in Cloudflare D1
- [x] WebSocket realtime via Durable Objects (multi-tab/user confirmed)
- [x] Send → D1 insert → DO broadcast → all clients refetch
- [x] Presence counting via DO connections

### Auth & Channel Management
- [x] Auth.js (NextAuth v5) — Google OAuth + email/password
- [x] Login page (Korean UI)
- [x] Dashboard — list channels, create new channel
- [x] Onboarding page — 2-step (create channel + admin guide accordion)
- [x] User sync — upsert to D1 `users` table on login
- [x] Channel ownership — `channels.owner_uid` = session user ID
- [x] Admin auto-detection via `useAuth` hook (no triple-click needed)
- [x] Admin proxy route — Vercel verifies session → forwards to Worker with signed token
- [x] Root `/` redirect based on auth state

### Server-Side Security
- [x] Rate limiting — 5 messages per 10 seconds per UID (429)
- [x] Message length cap — 5000 characters max (400)
- [x] Banned words — checked against `banned_words` table with expiry (403)
- [x] Block check — by UID AND fingerprint (403)
- [x] Freeze enforcement — non-admin can't send when frozen (403)
- [x] Admin token verification — `X-Internal-Token` + `X-User-Id` + ownership check
- [x] Delete/Edit ownership — only message sender can modify
- [x] Fingerprint — canvas + UA hash, sent with every message, stored for ban evasion detection

### Backend-Wired Features
- [x] Reactions — toggle via PATCH, persisted in D1 `messages.reactions`
- [x] DM messages — persisted in D1 `dm` table, broadcast via DO, image upload supported
- [x] Search — FTS5 full-text search with highlight (yellow/orange, nav arrows)
- [x] Photo upload — R2 binary upload, served via `/api/media/{key}`
- [x] Banned words CRUD — admin panel → D1 `banned_words` table
- [x] Welcome popup config — D1 `config` table, loaded on init
- [x] Notice banner — D1 `config` table, broadcast via DO
- [x] Channel profile/name/color/freeze — all persist via admin actions
- [x] Admin messages detection — Worker checks `owner_uid`, stores `is_admin=1`
- [x] Long message truncation — >1000 chars with expandable overlay
- [x] Offline/reconnection banner — WebSocket state drives UI
- [x] Auto-reload stale tabs — 5-min background refetch + version check

### Admin Panel (fully backend-wired)
- [x] Admin mode toggle (triple-click avatar + auto-detect via channel ownership)
- [x] Admin/user view toggle with return banner
- [x] 채널 settings: profile image, name, color, passcode, rules editor
- [x] 관리 settings: banned words (with duration), blocked users, petition toggle, DM toggle
- [x] Chat freeze/unfreeze (global, persisted, broadcast)
- [x] Live mode — full backend (start/end, separate channel, emoji presets, auto-purge)

### Panels & Settings
- [x] Header menu (설정, 갤러리, 링크, 관리자 설정)
- [x] Settings panel (font size, bubble color with custom picker)
- [x] Notice panel (channel rules display)
- [x] Gallery panel (photo grid, empty state)
- [x] Links panel (URL extraction from messages)
- [x] Plus menu (photo, DM toggle)

### Infrastructure
- [x] Cloudflare Worker deployed (`letsplay-api.letmetellu.workers.dev`)
- [x] D1 database with full schema + FTS5 search
- [x] Durable Object (ChatRoom) for WebSocket + presence + broadcast
- [x] API routes: `/api/init`, `/api/messages`, `/api/data`, `/api/admin`
- [x] CORS configured
- [x] Vercel deployment with Next.js framework preset

---

## What's Next

### Phase 2: Auth & Real Messages ✅
- [x] Auth.js integration (Google OAuth + email/password)
- [x] Wire send/receive to Worker (messages persist in D1)
- [x] WebSocket realtime loop (signal + refetch)
- [x] Admin determined by channel ownership
- [x] Login page + onboarding
- [x] Dashboard (list/create channels)
- [x] Server-side validation (rate limit, banned words, fingerprint, message cap)

### Phase 3: Media & Polish
- [x] Enable R2, wire image upload
- [ ] Embeds (YouTube, Twitter, Instagram, link previews)
- [x] Search (FTS5 via Worker)
- [x] Long message truncation (>1000 chars)
- [ ] Typing indicator
- [x] Offline/reconnection banner
- [x] Auto-reload stale tabs

### Phase 3.5: Live Mode ✅
- [x] Start/end live (admin action → D1 config + DO broadcast)
- [x] Temporary `_live` channel for FK constraint (created on start, deleted on end)
- [x] Live messages stored separately (`channel_id = 'x_live'`)
- [x] Live DMs stored separately, purged on end
- [x] Auto-purge all live data + R2 media on end-live
- [x] Non-admin popup/banner on live-started broadcast
- [x] Session tracking (liveSeen prevents re-popup on dismiss)
- [x] localStorage persistence (survives page refresh)
- [x] Live-only viewer count (join-live/leave-live DO tracking)
- [x] Emoji bar with preset emojis (admin-configurable)
- [x] Emoji presets synced to all clients in real-time (broadcast)
- [x] Emoji effects broadcast via WebSocket
- [x] Admin "종료" ends for everyone, non-admin "나가기" only leaves
- [x] Live-ended popup shown to all users including admin
- [x] Stale closure fixes (inLiveModeRef for all subscribe handlers)

### Phase 4: Platform
- [ ] Embeds (YouTube, Twitter, Instagram, link previews)
- [ ] Typing indicator
- [ ] Channel deletion from dashboard
- [ ] Channel discovery
- [ ] Social login (Kakao, Apple)
- [ ] SSR landing page
- [ ] RSS feed
- [ ] Email verification
- [ ] Password hashing upgrade (SHA-256 → bcrypt)

---

## Development

### Local (mock mode)
```bash
npm install
npm run build
npx next start --port 3000 --hostname 0.0.0.0
# Visit /ch/test — uses in-memory mock data
```

Set `NEXT_PUBLIC_MOCK=true` in `.env.local` for mock mode.

### Production
```bash
# Frontend auto-deploys via Vercel on git push
git push origin main

# Worker
cd worker && npx wrangler deploy
```

### Environment Variables

**`.env.local` (local dev):**
```
NEXT_PUBLIC_MOCK=false
NEXT_PUBLIC_WORKER_URL=https://letsplay-api.letmetellu.workers.dev
NEXTAUTH_SECRET=<random-string>
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
INTERNAL_SECRET=<shared-with-worker>
```

**Vercel:**
```
NEXT_PUBLIC_WORKER_URL=https://letsplay-api.letmetellu.workers.dev
NEXTAUTH_SECRET=<same-as-local>
GOOGLE_CLIENT_ID=<same>
GOOGLE_CLIENT_SECRET=<same>
INTERNAL_SECRET=<same-as-worker>
```

**Worker (via `wrangler secret put`):**
```
INTERNAL_SECRET=<same-as-vercel>
```

---

## Project Structure

```
/
├── src/
│   ├── app/                    ← Next.js pages
│   │   ├── page.tsx            → / (redirect based on auth)
│   │   ├── login/page.tsx      → Login/signup (Korean UI)
│   │   ├── onboarding/page.tsx → Channel creation + admin guide
│   │   ├── dashboard/page.tsx  → List/create channels
│   │   ├── ch/[slug]/page.tsx  → Chat page
│   │   └── api/               → Auth, admin proxy, user sync, version
│   ├── components/
│   │   ├── chat/              → ChatView, ContextMenu, ReactionBadge, ReplyBar,
│   │   │                        EmojiPicker, EmojiBar, HeaderMenu, PlusMenu,
│   │   │                        SettingsPanel, NoticePanel, GalleryPanel, LinksPanel,
│   │   │                        ScrollToBottom, WelcomePopup, SearchBar, LiveMode,
│   │   │                        NoticeBanner, NoticeEditDialog, ConfirmDialog, EditDialog
│   │   └── admin/             → AdminPanel (채널/관리 categories)
│   ├── hooks/
│   │   ├── useRealtime.ts     → WebSocket connection + presence + live count
│   │   ├── useAuth.ts         → Channel ownership detection
│   │   └── useAutoUpdate.ts   → Version check auto-reload
│   └── lib/
│       ├── api.ts             → Worker API client (mock/real switch)
│       ├── mock-api.ts        → In-memory mock for local dev
│       ├── auth.ts            → NextAuth config (Google + Credentials)
│       └── fingerprint.ts     → Canvas + UA hash
├── worker/
│   ├── src/
│   │   ├── index.ts           → Worker entry, router, CORS
│   │   ├── types.ts           → Env interface (DB, MEDIA, CHAT_ROOM, secrets)
│   │   ├── realtime/
│   │   │   └── chat-room.ts   → Durable Object (WebSocket, presence, live viewers)
│   │   ├── routes/
│   │   │   ├── init.ts        → Consolidated page load (channel, messages, dm, gallery, live)
│   │   │   ├── messages.ts    → Send/edit/delete/react (supports _live channels)
│   │   │   ├── data.ts        → Read data (messages, search, blocked, gallery, dm)
│   │   │   ├── admin.ts       → Admin actions (freeze, block, live, profile, notice, presets)
│   │   │   ├── dm.ts          → Direct messages
│   │   │   ├── upload.ts      → R2 image upload + media serve
│   │   │   ├── auth.ts        → Signup/login (SHA-256 password hash)
│   │   │   └── user.ts        → User sync + channel listing
│   │   └── lib/
│   │       └── validation.ts  → Rate limit, message length, banned words
│   ├── migrations/            → D1 SQL migrations (schema, banned_words, users)
│   └── wrangler.toml          → D1, R2, DO bindings
├── .env.local                  → Local dev secrets (git-ignored)
├── MIGRATION_NOTES.md          ← CSS→TSX porting notes + session logs
├── vercel.json
└── package.json
```

---

## Reference

The original vanilla JS + Supabase prototype is at `/home/jjiwoo/letsplay-platform/`.
Key reference files:
- `src/app.js` — behavioral spec (all UI/UX logic)
- `styles.css` — visual spec
- `AI_GUIDE.md` — feature documentation
- `MIGRATION_PLAN.md` — full rebuild plan

---

## License

Private project.
