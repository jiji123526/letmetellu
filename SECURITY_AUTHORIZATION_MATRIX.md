# Authentication and Authorization Matrix

This document records the server-side authorization boundary for **yap.**.
Frontend visibility is not treated as access control. A browser-provided
`X-User-Id` becomes trusted only when the request also carries the matching
Worker `INTERNAL_SECRET` from the authenticated Next.js proxy.

Status as of 2026-08-13:

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
| Live participant state | An authorized parent-room WebSocket connection presenting the session ID that matches the current active, unexpired live configuration. This is temporary connection state, not an independent account role. |

## Route matrix

| Worker boundary | Guest | Room viewer | Channel owner | Platform admin | Current enforcement and coverage |
| --- | --- | --- | --- | --- | --- |
| `/api/init` | Public-room bootstrap; locked rooms receive only gate metadata | Full locked-room bootstrap with channel-bound room token | Full data and owner state | Reports channel only through configured ownership | Uncached current-passcode token binding and deleted-channel rejection have focused coverage; browser transitions pending |
| `/api/data` messages/gallery/links/search | Public room allowed | Locked room allowed with token | Allowed | Reports inbox only for configured owner | Uncached current-passcode boundary and explicit deleted-channel rejection have focused coverage; flat history/query tests |
| `/api/data` dm/blocked/banned-words | Denied | Denied | Allowed for owned channel | No implicit cross-channel override | Shared trusted-identity and pre-switch owner-boundary tests |
| `/api/messages` | Public room allowed with signed actor identity | Locked room allowed with token | Allowed | Reports mutations require configured ownership | Idempotency, reply/report target, actor identity, cross-channel mutation, room lifecycle and expired-live mutation tests |
| `/api/admin` | Denied | Denied | Owned channel only; ending live also requires the exact active session ID | No implicit ownership of other channels | Shared internal-secret and owner checks; focused stale-session end coverage |
| `/api/socket-auth` | Public rooms receive no privileged mode | Locked viewer mode requires room token | Admin mode only with trusted matching identity | Reports viewer/admin mode follows configured ownership | Shared trusted-identity and owner-check tests; origin test covers WebSocket entry |
| `/ws/:channel` | Public-room connection only after allowed-origin upgrade | Locked viewer authorization requires a scoped viewer token | Admin authorization requires a scoped owner token | Reports authorization follows configured ownership | Durable Object revalidates live joins through a tested current-session decision; browser transitions pending |
| `/api/upload` | Signed actor required; public message/DM quota applies | Room token plus signed actor required | Channel assets and owner uploads allowed only on owned channel | No implicit cross-channel override | Signature, pre-body authorization, quota ordering, deleted-channel and expired-live route invariants |
| `/api/media/*` | Public media only where channel policy permits | Protected media requires current room authorization on network access/revalidation | Owned-channel media allowed | No blanket media override | Cache/access focused tests; an already cached private response can remain reusable for its bounded browser-cache window |
| `/api/dm` | Signed actor and channel policy required | Same, with room token for locked room | Owner receives data through owner-only data route | No implicit override | Idempotency/identity controls plus deleted-channel and expired-live route invariants; broader action regression pending |
| `/api/channel-reports` POST | Signed actor/device required | Locked channel additionally requires room token | Owner cannot report own channel | Same submission rules | Durable quota and target-channel lookup; direct target/evidence expansion pending |
| `/api/channel-reports` PATCH | Denied | Denied | Denied unless also platform admin | Allowed | Shared trusted-identity, platform-role, per-action denial and target-lookup tests |
| `/api/support` | Signed anonymous/device support subject | Same | Same user support boundary | Same unless using platform route | Actor identity isolation, owned lifecycle transitions and database-enforced one-open-session/ticket invariants; browser regression pending |
| `/api/platform-admin/support` | Denied | Denied | Denied unless platform admin | Allowed | Shared trusted-identity and platform-role check tests |
| `/api/user` account reads/writes | Denied except documented public profile/channel-existence reads | Same | Own account through trusted proxy | Own account through trusted proxy | Functional forged preference-update rejection test |
| `/api/recent-channels` | Browser-local only; Worker account route denied | Same | Own rows through trusted proxy | Own rows through trusted proxy | Identity/email canonicalization exists; action regression pending |
| `/api/auth` | Public credential flow through trusted app origin/proxy contract | Same | Same | Same | Rate limits and token lifecycle implemented; email/legacy monitoring pending |
| `/api/preview` | Allowed with durable IP-derived quota and SSRF policy | Same | Same | Same | Server-side fetch policy remains authoritative; YouTube uses validated video IDs and deterministic thumbnails without client widgets or metadata fetches |

## Required regression scenarios

### Highest priority

- [x] The shared trusted-identity primitive rejects a forged `X-User-Id`
  without `INTERNAL_SECRET`, and privileged route source checks prevent
  bypassing that primitive.
- [x] Channel owner and platform-admin comparisons remain server-side after
  trusted identity resolution.
- [x] Owner-only collections are rejected before their data switch.
- [x] Exercise every `/api/messages` method with another channel's message ID,
  upload ticket and room token.
- [x] Exercise every report/petition action with normal-user, channel-owner and
  platform-admin sessions.
- [x] A stale owner session ID cannot end a newer live session, and WebSocket
  live presence is accepted only for the current active session.
- [x] Verify a room token becomes unusable immediately after passcode change
  and channel deletion.
- [x] Verify expired live sessions reject live-channel messages, uploads, DMs
  and presence joins while leaving valid normal-room access unchanged.
- [x] Verify guided-support start/escalate races converge on one open session
  and ticket, and close/reset mutations remain bound to the owning user.

### Browser-visible state transitions

- [ ] Exercise guided support close/reset/escalate and one-open-ticket behavior
  through the deployed browser UI; Worker lifecycle invariants are covered.
- [ ] User ticket close/delete reflected in the platform-admin dashboard.
- [ ] Report open/warn/freeze/unfreeze/petition state reflected in both inbox
  and channel UI without stale privileged data.
- [ ] Logout and account deletion invalidate privileged HTTP and WebSocket
  behavior in another open tab.
- [x] A hidden or disconnected live tab reconciles ended/replaced session state
  before restoring presence, and an end action in one tab updates another tab.
- [ ] Media access revocation tests distinguish a new unauthorized network
  request from a copy already retained in the browser's bounded private cache.

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
7. Bind destructive temporary-session actions to an expected session/version
   identifier; owner authorization alone must not allow a stale tab to mutate a
   newer session.
