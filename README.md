# letsplay-v2

Multi-tenant anonymous chat platform — rebuilt on Next.js + Cloudflare.

## Status

**Phase 1-3 complete. Real-time messaging working.** Full chat interface with persistent messages, WebSocket realtime via Durable Objects, and all UI features (non-admin + admin). Auth is next.

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
| Auth | Auth.js (NextAuth v5) | ⬜ Phase 2 |
| Storage | Cloudflare R2 | ⬜ Not enabled yet |
| Backend API | Cloudflare Workers | ✅ Routes working (init, messages, data) |

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

### Admin Panel (complete, local state)
- [x] Admin mode toggle (triple-click avatar)
- [x] Admin/user view toggle with return banner
- [x] 채널 settings: profile image, name, color, passcode, rules editor
- [x] 관리 settings: banned words (with duration), blocked users, petition toggle, DM toggle
- [x] Chat freeze/unfreeze
- [x] Live mode placeholder

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

### Phase 2: Auth & Real Messages
- [ ] Auth.js integration (Google OAuth + email/password)
- [x] ~~Wire send/receive to Worker (messages persist in D1)~~
- [x] ~~WebSocket realtime loop (signal + refetch)~~
- [ ] Admin determined by channel ownership (JWT)
- [ ] Login page + onboarding
- [ ] Dashboard (list/create/delete channels)

### Phase 3: Media & Polish
- [ ] Enable R2, wire image upload
- [ ] Embeds (YouTube, Twitter, Instagram, link previews)
- [ ] Search (FTS5 via Worker)
- [ ] Long message truncation (>1000 chars)
- [ ] Typing indicator
- [ ] Offline/reconnection banner
- [ ] Auto-reload stale tabs

### Phase 4: Platform
- [ ] Dashboard (list/create/delete channels)
- [ ] Login/onboarding pages
- [ ] Root `/` redirect logic
- [ ] Channel discovery

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

**`.env.local` (local):**
```
NEXT_PUBLIC_MOCK=true
NEXT_PUBLIC_WORKER_URL=https://letsplay-api.letmetellu.workers.dev
```

**Vercel:**
```
NEXT_PUBLIC_WORKER_URL=https://letsplay-api.letmetellu.workers.dev
NEXT_PUBLIC_MOCK=false
```

---

## Project Structure

```
/
├── src/
│   ├── app/                    ← Next.js pages
│   │   ├── page.tsx            → / (redirect to login)
│   │   ├── login/page.tsx
│   │   └── ch/[slug]/page.tsx  → Chat page
│   ├── components/
│   │   ├── chat/              → ChatView, ContextMenu, ReactionBadge, ReplyBar,
│   │   │                        EmojiPicker, HeaderMenu, PlusMenu, SettingsPanel,
│   │   │                        NoticePanel, GalleryPanel, LinksPanel, ScrollToBottom,
│   │   │                        WelcomePopup
│   │   └── admin/             → AdminPanel
│   ├── hooks/
│   │   └── useRealtime.ts     → WebSocket connection manager
│   └── lib/
│       ├── api.ts             → Worker API client (mock/real switch)
│       └── mock-api.ts        → In-memory mock for local dev
├── worker/
│   ├── src/
│   │   ├── index.ts           → Worker entry, router, CORS
│   │   ├── types.ts
│   │   ├── realtime/
│   │   │   └── chat-room.ts   → Durable Object (WebSocket + presence)
│   │   └── routes/
│   │       ├── init.ts        → Consolidated page load
│   │       ├── messages.ts    → Send message
│   │       ├── data.ts        → Read data (messages, blocked, gallery, dm)
│   │       └── admin.ts       → Admin actions (verified via internal token)
│   ├── migrations/
│   │   └── 0001_initial_schema.sql
│   └── wrangler.toml
├── MIGRATION_NOTES.md          ← CSS→TSX porting gotchas
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
