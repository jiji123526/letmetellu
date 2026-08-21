# yap. Monetization Plan

Status: active beta implementation; rewarded advertising remains proposed
Last updated: 2026-08-21

## Goals

- Keep the core anonymous-channel experience usable without payment.
- Let free users exchange a completed rewarded advertisement for specific, bounded actions.
- Give paying channel owners a simple ad-free experience and customization benefits.
- Validate willingness to pay before building complex usage-based billing.
- Keep billing and rewarded-ad authorization enforceable by the server rather than trusting browser state.

## Implementation history

Completed work and branch progress are recorded in
[MONETIZATION_LOG.md](./MONETIZATION_LOG.md). New fixes are always added at the
top of that document.

## Current working decisions

Chosen direction as of 2026-08-21:

- Launch Plus with advertisement removal, customization controls, image-quota exceptions and automatic renewal.
- Make live-session creation and channel freezing Plus-only owner features.
- Free image policy: five successful image messages per user per calendar day, resetting at midnight KST.
- Count successful accepted image messages, not upload attempts. Failed uploads, rejected sends and ambiguous retries must not consume the daily allowance.
- Plus image exception scope: all supported image surfaces while the user is entitled, including public channel messages, live-channel messages and owner DMs.
- Entitlement scope: the paying user keeps the Plus image exception in any channel, not only in channels they own.
- Quota identity: use authenticated account ID when available; otherwise use anonymous UID with device-based checks as a secondary anti-abuse backstop.
- Free plan ownership is limited to one channel. Owning more than one channel is a Plus benefit rather than an ad-gated Free action.
- Beta users should receive permanent account-level Plus benefits through a non-billable `grandfathered_beta` entitlement, not through coupons.
- Current authenticated beta accounts should be backfilled into that permanent Plus cohort, and new authenticated accounts created during the beta should receive the same entitlement automatically while the beta-grandfathering flag is enabled.
- Downgrade behavior: reset premium customization values to defaults, lock premium rendering and controls, retain uploaded premium background media for later cleanup rather than deleting it immediately.
- Pricing should be stored and modeled as VAT-exclusive until tax and storefront display rules are finalized.

Implementation consequences:

- Account-wide sender entitlements require the message-send and upload flows to recognize a paid authenticated user even when that person is participating as an ordinary non-owner visitor.
- Automatic renewal narrows the viable Korean payment-method set if Toss automatic billing is used; domestic easy-pay wallets are not automatically covered by that product.
- Granting automatic Plus to beta users requires one permanent, non-billable entitlement source that remains distinguishable from paid subscriptions in analytics and support tooling.

## Recommended beta implementation order

1. Finalize the paid product decisions needed for automatic renewal, pricing and downgrade behavior.
2. Add provider-neutral billing and entitlement records in D1.
3. Add one server-side entitlement helper and use it first for channel customization locking and image-quota bypass decisions.
4. Extend the ordinary non-owner message and upload paths so an authenticated paid user can be recognized server-side without relying on browser-only flags.
5. Implement the chosen automatic-billing flow, confirmation, renewal, cancellation, refund reconciliation and idempotent webhook handling.
6. Add the five-images-per-calendar-day Free quota at message acceptance time, not at upload-ticket creation time.
7. Apply the Plus image exception to every chosen image surface with explicit tests for public channels, live channels and owner DMs.
8. Run the migration for current channels and grandfathered Plus access before enabling premium customization enforcement.
9. Revisit rewarded advertisements only after billing, renewal, downgrade and image-quota behavior are stable.

## Implementation work plan

Phase 1: monetization foundation

- Add D1 schema for billing orders, payments, user entitlements, webhook events and daily image-quota consumption.
- Add a Worker entitlement helper that can answer whether a user currently has Plus and how to derive quota actors for authenticated and anonymous participants.
- Do not change product behavior yet in this phase. The goal is to land durable source-of-truth primitives first.

Phase 2: owner-only Plus gates

- Enforce Free one-channel ownership and Plus five-channel ownership in the channel-creation route.
- Enforce Plus-only live-session creation and Plus-only manual freeze/unfreeze controls in owner admin routes.
- Enforce Plus-only premium customization writes for bubble color, background color, background image and blur.
- Reflect those locks in dashboard and channel settings UI with clear upgrade prompts.

Phase 3: billing flow

- Implement order creation, provider confirmation, recurring renewal, cancellation and refund reconciliation.
- Persist entitlements only after authoritative server-side confirmation.
- Surface current entitlement state to dashboard and channel settings so the client can render locked and unlocked states consistently.

Phase 4: participant identity extension

- Extend ordinary non-owner write paths so a signed-in paid user can be recognized server-side even when participating as a normal visitor rather than a channel owner.
- Keep anonymous participation working for non-paying visitors without trusting browser-only Plus flags.

Phase 5: daily image quota

- Enforce the Free five-images-per-calendar-day rule at accepted-message time, not upload time.
- Apply Plus bypass after the new participant-identity path is in place.
- Cover public channel messages, live-channel messages and owner DMs with explicit tests.

Phase 6: migration and rollout

- Grant permanent grandfathered Plus access to the beta user cohort through a dedicated entitlement source and keep it distinct from paid subscriptions.
- Turn on premium customization enforcement only after the migration is complete.
- Add rewarded advertisements only if later business validation still requires them.

## Proposed plans

### Free

- Own one channel without watching an advertisement.
- Send up to five successful image messages per calendar day without Plus.
- Use the default bubble color and default channel background.
- Do not create live sessions.
- Do not freeze or unfreeze channel chat.
- See advertisements in free-owned channels according to the final ad placement policy.
- Join and participate in other channels without a subscription.

### Plus

Proposed beta founding price:

- Korean domestic launch candidate: KRW 2,900 for 30 days; or
- Korean domestic launch candidate: KRW 17,000 for 365 days.

Recommended beta behavior is an automatically renewing plan. If Toss automatic billing is selected as the first implementation path, expect card or account-based recurring billing after additional review and contract. That product does not automatically provide recurring Toss Pay, KakaoPay or Naver Pay support. Supporting recurring Korean wallets would require a different PG or direct integration, potentially through PortOne.

An overseas Polar product at USD 2 monthly or USD 12 yearly remains a future option rather than the initial Korean launch path.

Benefits:

- Own up to five channels.
- Remove advertisements from channels owned by the subscriber.
- Bypass the Free daily image quota in any supported channel while entitled, subject to the normal file-count, file-size and abuse-control limits.
- Customize the outgoing bubble color.
- Select a channel background color or upload a background image, including the existing blur option.
- Create and operate live sessions.
- Freeze and unfreeze channel chat.
- Use the same functional moderation, reporting and security limits as Free; payment does not bypass abuse controls.

The beta price should be presented as founding-user pricing. Decide before launch whether active founding subscriptions retain this price after general availability.

## Rewarded-ad entitlement rules

### Photo sending

Recommended rule:

1. A free user selects one to five photos for one outgoing media bundle.
2. Before upload begins, the app asks the user to watch one rewarded advertisement.
3. A verified completion grants one `media_bundle` credit.
4. That credit authorizes exactly one send operation containing up to five photos.
5. The server consumes the credit atomically when it accepts the first message in the bundle.
6. An upload or server failure must not silently consume the credit. The same send attempt may retry with the same idempotency key.
7. Unused credits should expire after a short period, proposed at 30 minutes, and should not become a bankable currency.

Watching one advertisement does not permanently unlock five independent photo sends. It unlocks one bundle of up to five photos. This keeps the rule understandable and limits farming or resale of credits.

Text-only messages should never require an advertisement.

### Channel creation

Recommended rule:

- Channel one: no advertisement.
- Free users are limited to one owned channel.
- Plus subscribers may own up to five channels while their subscription is entitled.
- Deleting a Free-owned channel opens the one available slot for another channel creation.
- The existing global beta channel ceiling remains authoritative above plan-specific limits.

## Media size policy

Initial launch policy:

- Keep the same 10MB per-file server limit for Free and Plus.
- Keep the maximum five-photo bundle and all existing upload frequency, pending-ticket, file-type and moderation limits for both plans.
- Continue compressing ordinary photos to a maximum width of 1200px at JPEG quality 0.8; animated GIFs retain their original data and are therefore the most likely format to reach the limit.
- Plus removes the rewarded-ad requirement for eligible channels but does not grant unbounded upload size or frequency.

The current Worker buffers each accepted upload before writing it to R2, and a five-photo bundle can already reach 50MB in the worst case. Raising the raw limit at launch would increase memory pressure, mobile timeout risk, storage and bandwidth abuse without adding a strong paid benefit.

After launch, monitor `media_too_large` frequency by file type without recording filenames or contents. If legitimate failures are common, prefer a Plus high-quality image profile such as 1600–2000px output before increasing the raw file ceiling. A separate Plus GIF limit around 15MB may be evaluated later, but only with streaming/memory and timeout review.

## Meaning of “ad-free owned channels”

Recommended product interpretation: when the owner has Plus, no visitor sees product advertisements inside any channel owned by that account. This gives the owner a visible benefit they can offer their community.

An alternative is to hide advertisements only for the paying owner. That is cheaper to provide but substantially weaker as a reason to subscribe. The final interpretation must be chosen before UI copy and ad placement are implemented.

Advertisements must not imitate messages, cover moderation controls, interrupt message composition, or appear inside private message content. Initial placement should be deliberately sparse.

## Customization entitlement

Plus controls:

- Bubble color selection.
- Background color presets and custom color picker.
- Background image upload.
- Background image blur toggle.

Chosen downgrade behavior:

- Reset premium customization values to defaults when entitlement ends.
- Render the channel with locked premium styling and controls while the user is not entitled.
- Keep premium background media rather than deleting it immediately; define a later cleanup policy for unreferenced retained assets.

Chosen migration policy for beta users:

- Beta users should receive permanent account-level Plus through `user_entitlements` with `source_type = 'grandfathered_beta'`.
- This entitlement should be non-billable, non-renewing and have no expiry by default.
- Do not model this benefit as a coupon. Coupons belong to checkout pricing, while this policy is a server-side entitlement and should work even without any payment flow.

## Billing provider direction

The initial launch should prioritize Korean customers, KRW settlement and Korean tax reporting through a domestic business and PG contract.

### Current preferred path: automatic billing

- Sell a 30-day and 365-day Plus plan with automatic renewal.
- Offer only the payment methods that the chosen recurring-billing provider contract can actually support.
- Naver Pay can be exercised with general test keys; KakaoPay becomes available for testing only after the merchant contract and MID test keys are issued.
- Treat the payment-window success redirect as untrusted input. The Worker must compare the authenticated user, pending order, plan and authoritative amount before calling the Toss payment confirmation API.
- Grant the entitlement only after server-side confirmation succeeds and is durably recorded.
- Use payment status webhooks for renewal, cancellation and refund reconciliation; make event handling idempotent.

If Toss automatic billing is chosen, yap. must issue and securely store a billing key, schedule recurring charges itself, implement retry and dunning rules, stop scheduling after cancellation, and handle expired or replaced payment instruments.

### Overseas path: Polar

Polar remains a Merchant of Record candidate for meaningful overseas demand. It can handle international indirect sales tax and foreign subscriptions, but running Polar and Toss simultaneously creates two checkout, refund, reconciliation and entitlement paths. Add it only after the Korean billing flow is stable.

### Business and storefront prerequisites

Before applying for live domestic payments:

- Register an appropriate Korean sole proprietorship or company and settlement account.
- Confirm business category, VAT treatment and simplified or general taxpayer status with a tax professional or the relevant authority.
- Determine whether a mail-order business report is required and complete it where applicable.
- Display business name, representative, registration number, mail-order registration number where applicable, address and customer contact details in the site footer.
- Publish pass duration, supply timing, cancellation, refund, expiry and downgrade terms.
- Provide Toss and card reviewers a production-like website and test account.
- Ask Toss for the exact contracted methods, transaction fee, setup, annual or minimum fee and settlement schedule. Do not infer them from SDK availability.

Domestic PG sales, advertising revenue and related expenses remain part of Korean bookkeeping and tax reporting. Customer-facing KRW pricing should state clearly whether VAT is included or excluded. The current working decision is to model pricing as VAT-exclusive, but public display and legal wording still require professional confirmation.

## Server-side source of truth

Neither a successful redirect nor a browser flag grants Plus. The Worker verifies the provider result, updates D1, and reads D1 before enforcing paid capabilities.

Suggested records:

### `billing_orders`

- `order_id`
- `user_id`
- `plan`
- `amount`
- `currency`
- `status`
- `created_at`
- `expires_at`

### `payments`

- `provider_payment_id` with a unique constraint
- `order_id`
- `user_id`
- `provider`
- `method`
- `amount`
- `currency`
- `status`
- `approved_at`
- `canceled_at`

### `user_entitlements`

- `user_id`
- `provider`
- `plan`
- `status`
- `starts_at`
- `ends_at`
- `source_order_id`
- optional `provider_customer_id` and `provider_subscription_id` for later recurring billing
- `updated_at`

### `billing_webhook_events`

- `provider_event_id` with a unique constraint
- `event_type`
- `received_at`
- `processed_at`
- `status`
- bounded failure classification without secrets or full provider payloads

### `rewarded_ad_grants`

- opaque grant ID
- authenticated user ID
- purpose: `media_bundle` or `channel_creation`
- provider verification reference with a unique constraint
- issued and expiry timestamps
- consumed timestamp
- associated send-attempt or created-channel ID after consumption

The Worker must verify webhook/ad-provider signatures, reject replayed provider references, use transactions or equivalent conditional writes for consumption, and apply existing rate limits.

### `usage_quotas` or equivalent daily image ledger

- actor identifier
- actor type: authenticated user or anonymous/device-backed visitor
- quota date bucket
- image message count
- last consumed at

The ledger must support idempotent consumption so a retry of the same accepted image message does not double-charge the daily allowance.

## Failure and abuse handling

- Ad blockers, consent denial or a lack of available inventory can make rewarded ads unavailable. Do not leave users in an unexplained disabled state.
- Decide on a fallback before launch: retry later, a bounded daily free grant, or a direct Plus prompt. A daily free fallback is the safest UX during early ad-fill testing.
- Never grant a credit from a client-side `onComplete` callback alone. Require a server-verifiable completion or signed server-side callback from the ad provider.
- Bind credits to an authenticated account, purpose and short expiry. Do not allow transfer between accounts or purposes.
- Reuse the existing message client ID and channel-creation idempotency controls so network retries cannot consume several credits or create duplicates.
- Apply file-size, file-type, moderation, storage and channel-count limits equally after an ad or payment.
- Rate-limit ad grant creation and verification to prevent automated farming.
- Record aggregate grant, consumption, failure, subscription and downgrade metrics without storing message contents.

## Key UX flows

### Free daily image allowance

Select photos → if the sender is not currently Plus-entitled, check the remaining five-image daily allowance → upload/send → consume allowance only when the Worker accepts each image message → show the remaining allowance or a limit-reached prompt.

### Free second-to-fifth channel

Tap create → complete valid channel form → explain slot and ad requirement → verified ad → create atomically → open channel.

The advertisement should appear only after the form is valid so users do not watch an ad and then discover an avoidable validation error.

### Plus purchase

Open Plus sheet → select 365 days by default or 30 days → create a server-priced pending order → provider billing-window flow → Worker confirms payment with the provider → D1 entitlement begins → billing key or equivalent recurring authorization is stored if required → dashboard refreshes account state → premium controls unlock.

### Cancellation

For automatic billing, cancellation must stop future renewals without deleting current entitlement history. A refund request follows the published policy and provider cancellation API, with the entitlement adjusted only after the server records the result. At expiry after cancellation or payment failure, downgrade by resetting premium values, locking premium rendering and retaining background media for later cleanup.

## Metrics for deciding whether this model works

- Percentage of active channel owners who encounter an ad gate.
- Ad start, verified completion, unavailable-inventory and abandonment rates.
- Photo bundle and additional-channel creation success after ad completion.
- Plus checkout start, server-confirmed completion, refund and repeat-purchase rates.
- 30-day versus 365-day selection.
- Renewal purchase rate before and after pass expiry.
- Conversion after encountering each paid gate.
- Infrastructure and storage cost per Free and Plus owner.
- Reports or spam changes after rewarded media and channel creation launches.

Do not optimize for ad views alone. The primary health measures are successful channel creation, successful media sends, retained channel owners and paid conversion.

## Recommended rollout

1. Register the Korean business and tax setup and confirm the automatic-billing-capable provider, contracted payment methods, fees and review requirements.
2. Finalize the remaining implementation clarifications below.
3. Add provider-neutral D1 order, payment, entitlement, webhook-event and daily image-ledger schema.
4. Implement automatic-billing order creation, payment confirmation, recurring renewal scheduling, cancellation, refund reconciliation and idempotency tests.
5. Add one server-side entitlement helper used by message sending, media uploads and customization updates.
6. Extend ordinary participant write flows so a paid authenticated user can be recognized separately from anonymous-only participation.
7. Implement the five-images-per-calendar-day Free quota with idempotent consumption on accepted image messages.
8. Run the migration that grants permanent grandfathered Plus access to the beta user cohort and keep the same automatic grant path on for new beta accounts until the beta ends.
9. Enforce premium customization locking, image-quota bypass and advertisement removal from the shared entitlement helper.
10. Add rewarded advertisements only if the later growth model still requires them.

## Remaining implementation clarifications

- Which provider and payment-method scope will back automatic renewal at launch if recurring Korean wallets are required.
- Whether image-quota bypass in “all channels” also includes every DM and live-message surface from day one or rolls out in phases.
- Final VAT-exclusive price points, public storefront wording and refund calculations after tax and PG review.
- The exact placement and maximum frequency of non-rewarded advertisements in free-owned channels.
