# Authentication and Authorization Matrix

This document records the server-side authorization boundary for **yap.**.
Frontend visibility is not treated as access control. A browser-provided
`X-User-Id` becomes trusted only when the request also carries the matching
Worker `INTERNAL_SECRET` from the authenticated Next.js proxy.

Status as of 2026-08-09:

- **Focused/source** means a shared authorization primitive or route invariant
  has direct automated coverage, but
  the complete role transition still needs browser-level regression coverage.
- **Manual** means the production smoke flow exists but should be automated
  before broad public launch.

## Role definitions

| Role | Server evidence |
| --- | --- |
| Guest | No trusted account identity; signed anonymous and device tokens are issued and verified by the Worker where needed. |
| Room viewer | Guest identity plus a room token bound to the channel and current passcode hash. |
| Logged-in user | `X-Internal-Token === INTERNAL_SECRET` plus a server-session-derived `X-User-Id`. |
| Channel owner | Trusted logged-in user whose ID matches `channels.owner_uid`. |
| Platform admin | Trusted logged-in user whose ID matches the configured reports-channel owner. |

## Route matrix

| Worker boundary | Guest | Room viewer | Channel owner | Platform admin | Current enforcement and coverage |
| --- | --- | --- | --- | --- | --- |
| `/api/init` | Public-room bootstrap; locked rooms receive only gate metadata | Full locked-room bootstrap with channel-bound room token | Full data and owner state | Reports channel only through configured ownership | Server checks trusted identity and room token; manual state coverage |
| `/api/data` messages/gallery/links/search | Public room allowed | Locked room allowed with token | Allowed | Reports inbox only for configured owner | Passcode boundary in handler; flat history/query tests |
| `/api/data` dm/blocked/banned-words | Denied | Denied | Allowed for owned channel | No implicit cross-channel override | Shared trusted-identity and pre-switch owner-boundary tests |
| `/api/messages` | Public room allowed with signed actor identity | Locked room allowed with token | Allowed | Reports mutations require configured ownership | Idempotency, reply and actor-identity focused tests; broader action matrix pending |
| `/api/admin` | Denied | Denied | Owned channel only | No implicit ownership of other channels | Shared internal-secret boundary and server owner-check tests |
| `/api/socket-auth` | Public rooms receive no privileged mode | Locked viewer mode requires room token | Admin mode only with trusted matching identity | Reports viewer/admin mode follows configured ownership | Shared trusted-identity and owner-check tests; origin test covers WebSocket entry |
| `/api/upload` | Signed actor required; public message/DM quota applies | Room token plus signed actor required | Channel assets and owner uploads allowed only on owned channel | No implicit cross-channel override | Signature, pre-body authorization and quota ordering tests |
| `/api/media/*` | Public media only where channel policy permits | Protected media requires current room authorization | Owned-channel media allowed | No blanket media override | Cache/access focused tests; browser incognito smoke test |
| `/api/dm` | Signed actor and channel policy required | Same, with room token for locked room | Owner receives data through owner-only data route | No implicit override | Idempotency/identity controls exist; full action regression pending |
| `/api/channel-reports` POST | Signed actor/device required | Locked channel additionally requires room token | Owner cannot report own channel | Same submission rules | Durable quota and target-channel lookup; direct target/evidence expansion pending |
| `/api/channel-reports` PATCH | Denied | Denied | Denied unless also platform admin | Allowed | Shared trusted-identity and platform-role check tests |
| `/api/support` | Signed anonymous/device support subject | Same | Same user support boundary | Same unless using platform route | Actor identity isolation implemented; guided-state regression pending |
| `/api/platform-admin/support` | Denied | Denied | Denied unless platform admin | Allowed | Shared trusted-identity and platform-role check tests |
| `/api/user` account reads/writes | Denied except documented public profile/channel-existence reads | Same | Own account through trusted proxy | Own account through trusted proxy | Functional forged preference-update rejection test |
| `/api/recent-channels` | Browser-local only; Worker account route denied | Same | Own rows through trusted proxy | Own rows through trusted proxy | Identity/email canonicalization exists; action regression pending |
| `/api/auth` | Public credential flow through trusted app origin/proxy contract | Same | Same | Same | Rate limits and token lifecycle implemented; email/legacy monitoring pending |
| `/api/preview` | Allowed with durable IP-derived quota and SSRF policy | Same | Same | Same | SSRF, response-size, metadata and rate-limit focused tests |

## Required regression scenarios

### Highest priority

- [x] The shared trusted-identity primitive rejects a forged `X-User-Id`
  without `INTERNAL_SECRET`, and privileged route source checks prevent
  bypassing that primitive.
- [x] Channel owner and platform-admin comparisons remain server-side after
  trusted identity resolution.
- [x] Owner-only collections are rejected before their data switch.
- [ ] Exercise every `/api/messages` method with another channel's message ID,
  upload ticket and room token.
- [ ] Exercise every report/petition action with normal-user, channel-owner and
  platform-admin sessions.
- [ ] Verify a room token becomes unusable immediately after passcode change,
  channel deletion and live-session expiry.

### Browser-visible state transitions

- [ ] Guided support close/reset/escalate and one-open-ticket enforcement.
- [ ] User ticket close/delete reflected in the platform-admin dashboard.
- [ ] Report open/warn/freeze/unfreeze/petition state reflected in both inbox
  and channel UI without stale privileged data.
- [ ] Logout and account deletion invalidate privileged HTTP and WebSocket
  behavior in another open tab.

## Review rules

1. Never authorize from `X-User-Id` alone.
2. Never use UI hiding as the only owner or platform-admin check.
3. Bind room tokens and media access to the parent channel and current access
   state; tokens from one channel must not authorize another.
4. Resolve message, report, upload and channel IDs inside the requested channel
   before mutation.
5. Add a functional rejection test whenever a privileged route or action is
   added.
6. Do not log secrets, raw passwords, reset tokens, room tokens or private chat
   content in authorization failures.
