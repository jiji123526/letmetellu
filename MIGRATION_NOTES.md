# CSS → TSX Style Migration Notes

When porting styles from the vanilla CSS prototype to React/Tailwind components, these
differences cause visual mismatches:

## Problem: Tailwind's Base Styles Inflate Element Height

Tailwind's `preflight` (based on `modern-normalize`) sets:
- `line-height: 1.5` on `body` (inherited by all elements)
- `line-height: inherit` on `button` elements

The original CSS doesn't set `line-height` on menu items or buttons — browsers default
to ~1.2 for buttons. This makes Tailwind buttons **~25% taller** than identical CSS.

**Fix:** Add `lineHeight: 1` to inline styles for menu items, action buttons, and
any element where padding defines the height (not line-height).

## Problem: `font-size` Inheritance

The original sets `font-size: var(--bubble-font-size, 17px)` on `html, body`, making
it the inherited default everywhere. In Next.js with Tailwind, the base font-size is
`16px` (from preflight), and `var(--bubble-font-size)` is only applied where explicitly
set.

**Fix:** Either set `font-size: var(--bubble-font-size)` on `body` in `globals.css`
(which we do), or explicitly set `fontSize: "var(--bubble-font-size)"` on every
component that needs it.

## Problem: `min-width` on Auto-Sizing Menus

Setting `minWidth: "180px"` on context menus/dropdowns makes them wider than the
original, which auto-sizes to content. Korean labels like "답장" or "신고" are short
(~40px), so forcing a min-width creates excess whitespace.

**Fix:** Omit `minWidth` — let the menu auto-size to its content.

## Problem: Tailwind Class Padding vs CSS Variable Padding

Using Tailwind classes like `px-[14px] py-[10px]` produces fixed pixel values. The
original uses `calc(var(--bubble-font-size) * ratio)` so padding scales with font size.

**Fix:** Use inline `style` with `calc()` expressions for any dimension that should
scale with the font setting:
```tsx
padding: "calc(var(--bubble-font-size) * 0.588) calc(var(--bubble-font-size) * 0.824)"
```

## Summary: Port Checklist

When porting a CSS component to TSX:
1. Use `dangerouslySetInnerHTML` for SVG icons to preserve exact `stroke-width` attributes
2. Add `lineHeight: 1` to buttons/menu items
3. Omit `minWidth` unless the original explicitly sets it
4. Use `calc(var(--bubble-font-size) ± Xpx)` for all scalable dimensions
5. Use `var(--hairline)`, `var(--meta)`, `var(--gray-text)` etc. in inline styles
6. Don't use Tailwind utility classes for dimensions that need to scale with font settings


---

## Progress Log

### Session 1 (2026-07-23)

**Infrastructure:**
- Created Next.js 16 project with App Router + Tailwind
- Created Cloudflare Worker with D1 + Durable Objects
- Deployed both (Vercel + Workers)
- D1 schema applied (channels, messages, blocked, dm, gallery, config, FTS5)
- Test channel seeded

**UI (all working in mock mode):**
- ChatView with iMessage-style bubbles, fully scalable with `--bubble-font-size`
- Context menu (reply, report/unreport, edit, delete) with reaction bar
- Emoji picker (emoji-picker-element, positioned dynamically)
- Reaction badges (Slack-style pills, toggle on/off)
- Reply threading (arrows, indentation, follows parent side)
- DM mode (purple styling, plus menu toggle, admin-only visibility)
- Photo staging (compress, preview thumbnails, caption, multi-select)
- Report system (local marking + report message to admin)
- Admin panel with full navigation (채널/관리 categories)
- Channel settings: profile image, name, color picker, passcode, rules editor
- Manage settings: banned words (with duration), blocked users, petition/DM toggles
- Settings panel (font size, bubble color)
- Header menu, plus menu, notice panel, gallery panel, links panel
- Welcome popup, scroll-to-bottom, frozen banner, toast banners
- Korean IME fix, admin view toggle with return banner

**Key Decisions:**
- Mock mode (`NEXT_PUBLIC_MOCK=true`) for local dev without Worker
- `wrangler dev` doesn't work in this environment (glibc issue) — develop against remote Worker
- All dimensions use `calc(var(--bubble-font-size) ± offset)` for scalability
- No message grouping (every message independent)
- Non-admin: all non-admin messages on right, admin on left
- Admin: all admin messages on right, others on left
- Replies always follow parent's side

**Not Yet Wired (next session):**
- Messages don't persist (mock mode only)
- Auth (admin is triple-click, not ownership)
- Image upload to R2
- WebSocket realtime loop
- Embeds, search, typing indicator
- Dashboard, login, onboarding pages


### Session 1 Completion (2026-07-23, end)

**Real-time messaging wired:**
- Messages persist in D1 (Cloudflare)
- WebSocket via Durable Objects — realtime across multiple tabs/users confirmed working
- Send → D1 insert → DO broadcast → all clients refetch
- Fixed: SQLite integer fields (edited: 0) rendering as "0" in React JSX (use `!!` coercion)

**Current state: Fully functional anonymous chat**
- Visit `/ch/test` → real messages, realtime updates, persistent storage
- Infrastructure cost: ~$5/mo (Workers Paid + D1 + DO)
- No auth yet — admin is client-side toggle (server-side protected by internal token)

**Ready for Phase 2 (Auth):**
- Auth.js integration (Google OAuth + email/password)
- Channel ownership → automatic admin detection
- Dashboard (create/manage channels)
- Login + onboarding pages


### Session 1 Final (2026-07-23, late)

**Auth wired:**
- Auth.js (NextAuth v5) with Google OAuth + Credentials provider
- Login page, dashboard, onboarding (2-step with admin guide accordion)
- User sync to D1 `users` table on login
- Channel creation from dashboard and onboarding
- `useAuth` hook detects channel ownership → auto admin mode
- Admin proxy route: Vercel checks session → Worker checks token + ownership
- Triple-click fallback preserved for testing

**Server-side security wired:**
- Rate limiting: 5 messages / 10 seconds per UID
- Message length cap: 5000 chars
- Banned words: checked against `banned_words` table (with expiry support)
- Block check: by UID AND fingerprint (double identification)
- Freeze enforcement: already existed
- Delete/Edit: ownership verification (msg.uid must match requester)
- Fingerprint: canvas + UA hash, generated client-side, sent with every message

**Schema additions:**
- `users` table (id, email, name, image)
- `banned_words` table (word, channel_id, expires)
- Worker routes: /api/user (sync + list channels), create-channel admin action

**Remaining for production:**
- R2 for image uploads
- Search (FTS5 wired to UI)
- Embeds (YouTube/Twitter/link previews)
- Channel discovery
- Social login (Kakao, Apple)
