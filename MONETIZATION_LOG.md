# yap. Monetization Implementation Log

This file records completed work and active branch progress for
`monetization-beta`. Add every new fix directly below `## Latest changes`, so
the newest entry is always first. Product decisions and future work belong in
[MONETIZATION_PLAN.md](./MONETIZATION_PLAN.md).

## Latest changes

### 2026-08-21

#### Toss checkout uses the official SDK v2 flow

- Replaced the legacy global payment script with the official `@tosspayments/tosspayments-sdk` package.
- Initialize a customer-scoped payment instance and request card billing authorization through the current SDK v2 API.
- Kept server-authoritative orders, callback URLs and abandoned-order cancellation behavior unchanged.

#### Billing webhooks claim events before reconciliation

- Added an atomic `processing` claim so concurrent deliveries of one provider event cannot both reconcile billing state.
- Reject reuse of a provider event ID with a different provider or event type, and allow a stale claim to be safely retried after five minutes.
- Return a retryable non-success response while another delivery owns a fresh claim, preventing an interrupted first delivery from being silently abandoned.
- Persist a default retained-channel choice when subscription cancellation or refund reconciliation can lead to Plus expiry.
- Added migration `0059_billing_webhook_claims.sql` and a billing reconciliation audit.

#### Clarify the owned-channel image benefit

- Replaced the Plus panel's owned-channel advertising benefit copy with unlimited image sending in channels owned by the subscriber.
- Updated both Korean and English panel copy while keeping `Plus` as the plan name.

#### Expired Plus retains one active channel

- Added an owner-selected retained channel for accounts that will end Plus with more than one owned channel. Cancellation and the third renewal failure choose the most recently active channel by default.
- Made every other owned channel read-only after expiry while preserving its messages and media. Message, private-message, upload and owner-setting writes are rejected by the Worker; channel reads and deletion remain available.
- Added the channel chooser and lock status to the dashboard and a dedicated read-only state to chat. Renewing Plus removes all derived locks immediately.
- Preserved paid appearance data on read-only channels for renewal, while the one retained Free channel is reset to default appearance. Active live sessions are ended when their parent channel locks.
- Added migration `0058_channel_retention_choices.sql`, route wiring and regression coverage.

#### Personal bubble colors require Plus

- Added a viewer-specific entitlement snapshot to chat initialization so a paid participant does not depend on the channel owner's plan.
- Disabled personal bubble color controls for anonymous and Free users while showing the `Plus` badge only in the locked state.
- Enforced the same entitlement on account color writes and ignored retained local or account color overrides until the viewer has Plus again.
- Kept personal colors scoped to the subscriber's own view; channel-wide defaults remain an owner customization.

#### Remove duplicate Free plan status copy

- Kept the Free status badge as the single plan indicator in the details panel and removed the repeated sentence below it.
- Preserved Plus status details because they communicate renewal, expiry or grandfathered-entitlement state.

#### Monetization history is separated from the plan

- Moved implementation history out of `MONETIZATION_PLAN.md` so the plan contains only product decisions, architecture and remaining work.
- Standardized the Korean paid-plan name as `Plus` while keeping surrounding Korean copy localized.
- Kept both Korean and English application names fixed to the canonical `yap.` brand.

#### `4f2a47a` Keep the canonical application name

- Set both locale values for the application name to `yap.`.

#### `7f39ba9` Clarify Plus benefits in onboarding and guides

- Added `Plus` badges to paid-only color, background, chat-freeze and live controls in first-channel onboarding and the reusable admin guide.
- Added a short general-user guide section explaining the free five-image daily limit and the signed-in Plus bypass.
- Replaced the generic payment-success page with a concise activation card linking to channel creation and the existing admin guide.

#### `60dc660` Clear abandoned billing checkout state

- Removed prepared-order status from the plan panel.
- Added authenticated, ownership-scoped cancellation for pending orders when checkout is closed or fails.
- Preserved canceled order rows for audit history while preventing confirmed or foreign orders from being changed.

`27f3fb8` Add Toss checkout flow skeleton

- Added the first Toss automatic-billing checkout skeleton with authenticated prepare and confirm routes, a dashboard checkout entry point, and success and failure callback pages.
- Kept the Worker authoritative for order ownership and plan validation instead of trusting browser-side redirect parameters.

`12a04fb` Add billing key storage and renewals

- Added durable `billing_subscriptions` storage for the billing key, current period and next scheduled charge state.
- Wired scheduled renewal attempts into maintenance and added the first 24-hour retry behavior for failed recurring charges.

`2e3b41d` Optimize visible message reads and document monetization beta plan

- Updated the plan to reflect the current Plus direction, implementation order and phased work plan.
- Landed the visible-message read optimization that reduced the main remaining steady-state read-volume path before monetization work continued.

Completed follow-up after `12a04fb`:

- Extended the billing state read so the dashboard can see the current subscription status, retry count and cancellation state rather than only the entitlement snapshot.
- Added a self-serve dashboard cancellation path backed by `POST /api/billing/cancel`, which flips the current subscription and current billing order to `non_renewing` and clears `user_entitlements.auto_renews`.
- Tightened renewal failure handling so the third failed recurring charge stops future renewal scheduling by moving the subscription to `non_renewing` instead of leaving it indefinitely `past_due`.
- Added regression coverage for subscription state reads, self-serve cancellation and the three-strike renewal-failure cap.
- Extended ordinary anonymous message and upload proxies with trusted authenticated account identity while preserving anonymous public sender identity.
- Preserved authenticated participant identity on message and DM upload tickets for server-side quota and entitlement checks.
- Added a shared accepted-image quota helper with Plus bypass, authenticated-account preference and anonymous-device secondary enforcement.
- Enforced the free daily image quota at message acceptance time for public messages, live messages, DM sends and owner DM replies.
- Added client-facing quota feedback and regression coverage for Plus bypass, anonymous secondary checks and route wiring.

`0dfdb7d` Add monetization foundation and plus owner gates

- Added D1 monetization foundation schema for billing orders, payments, entitlements, webhook events and daily image quota events.
- Added Worker entitlement helpers and owner plan gate helpers.
- Enforced the first owner-side Plus rules on the server: Free 1 channel, Plus 5 channels, Plus-only freeze, Plus-only live start and Plus-only premium customization writes.
- Added regression tests for the foundation and server-side Plus gates.

`9ea7771` Expose owner plus plan state in dashboard and chat

- Exposed owner plan state from the Worker through `user` and `channel-state` reads.
- Reflected the plan snapshot in the dashboard create flow so channel-slot limits are visible before create attempts.
- Reflected the same snapshot in chat owner UI so live, freeze and customization entry points show Plus-locked state before mutation attempts.

Completed follow-up after `9ea7771`:

- Chose permanent grandfathered Plus entitlements for beta users rather than coupons or temporary discounts.
- Added a permanent `grandfathered_beta` entitlement path with a backfill migration for current users and an automatic grant path for new beta accounts while the flag is enabled.
