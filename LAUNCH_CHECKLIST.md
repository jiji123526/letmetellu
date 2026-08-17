# Launch Checklist

Core launch status for **yap.**, reviewed 2026-08-17. Detailed implementation
history belongs in `MIGRATION_NOTES.md`; longer-term work belongs in
`FUTURE_PLANS.md`.

## Core Tasks Done

- [x] `yapndot.com` is the canonical production origin, `www` redirects to it,
  and Google OAuth plus Resend use the production domain.
- [x] Core anonymous chat, locked channels, protected media, live sessions,
  account flows, support and moderation passed the limited-beta smoke tests.
- [x] Worker authorization coverage protects trusted identity, privileged
  routes, cross-object mutations, room/live lifecycle, media revocation,
  support invariants and private DM boundaries.
- [x] Cross-tab logout and account deletion revoke stale HTTP and WebSocket
  owner privileges.
- [x] Root-owned history paging keeps replies attached to their parent, and
  production reply audits found no broken, nested or cross-channel threads.
- [x] In-chat search uses trigram indexing for longer queries and navigates by
  rendered root/reply order, starting at the bottom-most visual match.
- [x] Live-session actions are session-ID guarded, stale/background tabs
  reconcile authoritative state, and viewer-count work is limited to live mode.
- [x] Private DM threads are sender-isolated. Owners can send up to 20 replies
  with text and one image, while senders can delete threads they started.
- [x] Admin message and DM deletion uses a durable five-second Undo operation;
  large threads use bounded D1 staging, grouped Undo and chunked cleanup.
- [x] Guided support enforces one active session and ticket per user, and
  ticket/report views perform authoritative state refreshes.
- [x] Channel and account deletion use retryable D1, Durable Object and R2
  cleanup with operational visibility.
- [x] Production health baselines, calibrated severity, the operator runbook
  and duplicate-free critical/recovery email alerts are in place.
- [x] Privacy-bounded monitoring exists for email verification, password reset
  and legacy SHA-256-to-PBKDF2 password upgrades.
- [x] GitHub Actions runs Worker tests, TypeScript checks and a Wrangler dry-run
  for relevant pushes and pull requests.

## Core Tasks To Do

- [ ] Apply every unapplied production migration through `0047`, then deploy
  the latest Worker and frontend.
- [ ] Verify the latest private DM flow in two isolated browser profiles:
  sender isolation, text/image replies, the one-image and 20-reply limits,
  sender thread deletion, owner reply deletion and cross-tab refresh.
- [ ] Verify durable deletion in production for normal roots, replies, DM roots
  and DM replies: refresh must not resurrect pending rows, Undo must restore
  within five seconds, and expiry must permanently clean records and media.
- [ ] Verify visual-order search with a newer root and a later reply under an
  older root. The visually lower match must open first, arrows must follow
  screen order, and pagination beyond 30 matches must not skip or duplicate.
- [ ] Complete deployed browser checks for guided-support close/reset/escalate,
  user/admin ticket closure synchronization, and report
  open/warn/freeze/unfreeze/petition transitions.
- [ ] Rehearse production email verification, password reset and one disposable
  legacy SHA-256 login. Confirm one PBKDF2 upgrade event, no failure, a
  `pbkdf2-sha256$` replacement and no second upgrade event.
- [ ] Complete nonce-based CSP enforcement, or record an explicit public-launch
  security review accepting the remaining `script-src 'unsafe-inline'` risk.
- [ ] Remove temporary legacy Worker CORS and OAuth origins after rollback no
  longer depends on them.
- [ ] Expand durable cross-channel abuse controls and validate direct-API
  report targets and evidence before materially widening access.
- [ ] Before public launch, confirm the latest production smoke test has no
  active core `5xx` regression and record the last known-good Worker and
  frontend deployments for rollback.
