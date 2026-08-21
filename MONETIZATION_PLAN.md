# yap. Monetization Plan

Status: product proposal; not yet implemented  
Last updated: 2026-08-15

## Goals

- Keep the core anonymous-channel experience usable without payment.
- Let free users exchange a completed rewarded advertisement for specific, bounded actions.
- Give paying channel owners a simple ad-free experience and customization benefits.
- Validate willingness to pay before building complex usage-based billing.
- Keep billing and rewarded-ad authorization enforceable by the server rather than trusting browser state.

## Current beta recommendation

Recommended starting point as of 2026-08-21:

- Launch Plus passes before building rewarded advertisements.
- Replace the initial rewarded-media gate with a simpler Free quota of five successful image messages per rolling 24-hour window.
- Treat the quota as image-message based, not upload-attempt based. Failed uploads or rejected sends must not consume the daily allowance.
- Apply the first Plus media exception at the channel-owner level: channels owned by a Plus subscriber may bypass the public channel image quota.
- Do not initially grant unlimited images to a paying visitor in every channel. The current write path identifies ordinary participants primarily through anonymous and device identities, so account-wide sender entitlements would require a broader identity-model change.
- Keep owner DMs out of the first Plus media exception unless post-launch data shows a clear need. Public-channel image sends and owner DMs have different spam and cost profiles.

Rationale:

- A daily image quota is materially easier to explain, enforce and measure than rewarded-ad grants.
- Plus still has a stronger core reason to pay through ad-free owned channels and customization, so media can remain a secondary benefit.
- Channel-owner-level Plus benefits fit the existing product model better than account-wide sender privileges for anonymous participants.

## Recommended beta implementation order

1. Finalize the paid product decisions needed for Plus passes, pricing and downgrade behavior.
2. Add provider-neutral billing and entitlement records in D1.
3. Add one server-side entitlement helper and use it first for channel customization locking.
4. Implement Toss test-key order creation, confirmation, refund reconciliation and idempotent webhook handling.
5. Launch Plus passes without rewarded ads.
6. Add the five-images-per-24-hours Free quota at message acceptance time, not at upload-ticket creation time.
7. Add the first Plus media exception for public image messages in channels owned by a subscribed owner.
8. Revisit rewarded advertisements only after billing, expiry, downgrade and image-quota behavior are stable.

## Proposed plans

### Free

- Own one channel without watching an advertisement.
- Create channels two through five after completing one rewarded advertisement for each channel creation.
- Send a media bundle containing up to five photos after completing one rewarded advertisement.
- Use the default bubble color and default channel background.
- See advertisements in free-owned channels according to the final ad placement policy.
- Join and participate in other channels without a subscription.

### Plus

Proposed beta founding price:

- Korean domestic launch candidate: KRW 2,900 for 30 days; or
- Korean domestic launch candidate: KRW 17,000 for 365 days.

Recommended beta behavior is a non-renewing pass paid through Toss Payments. It supports a straightforward card, KakaoPay or Naver Pay purchase without storing a billing key. Before expiry, the dashboard invites the user to purchase another pass.

If automatic renewal is later validated as necessary, Toss Payments can provide card or account billing after additional review and contract. Its billing product does not support automatic renewal through Toss Pay, KakaoPay or Naver Pay. Supporting recurring Korean wallets would require a different PG or direct integration, potentially through PortOne.

An overseas Polar product at USD 2 monthly or USD 12 yearly remains a future option rather than the initial Korean launch path.

Benefits:

- Own up to five channels without watching channel-creation advertisements.
- Remove advertisements from channels owned by the subscriber.
- Send photo bundles without watching rewarded advertisements, subject to the normal file-count and file-size limits.
- Customize the outgoing bubble color.
- Select a channel background color or upload a background image, including the existing blur option.
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
- Channels two through five: one verified rewarded advertisement immediately before each creation.
- The credit authorizes one successful channel creation and is consumed atomically with creation.
- If validation fails because the address is taken or the request is malformed, the credit remains usable until expiry.
- Deleting a free-owned channel opens a slot, but creating its replacement requires another rewarded advertisement.
- Plus subscribers bypass this advertisement check while their subscription is entitled.
- The existing global beta channel ceiling and the per-account five-channel ceiling remain authoritative.

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

Recommended downgrade behavior:

- Preserve the saved premium settings in D1 so a later resubscription restores them.
- Render the channel with safe default styling while the owner is not entitled.
- Keep the controls visible but locked with a concise Plus explanation.
- Never delete an uploaded background immediately on downgrade; define a retention period before deleting unreferenced premium media.

Existing free channels may already have custom colors or backgrounds. Before enforcing this entitlement, choose one migration policy:

1. Grandfather existing customization until it is changed; recommended for the least disruptive beta transition.
2. Preserve the values but render defaults until Plus is activated.
3. Give existing owners a time-limited Plus trial.

Do not silently erase existing settings.

## Billing provider direction

The initial launch should prioritize Korean customers, KRW settlement and Korean tax reporting through a domestic business and PG contract.

### Recommended beta path: Toss Payments passes

- Sell a 30-day and 365-day Plus pass without automatic renewal.
- Offer contracted domestic cards and easy-pay methods through the Toss Payments payment window or widget.
- Naver Pay can be exercised with general test keys; KakaoPay becomes available for testing only after the merchant contract and MID test keys are issued.
- Treat the payment-window success redirect as untrusted input. The Worker must compare the authenticated user, pending order, plan and authoritative amount before calling the Toss payment confirmation API.
- Grant the entitlement only after server-side confirmation succeeds and is durably recorded.
- Use payment status webhooks for cancellation and refund reconciliation; make event handling idempotent.

### Optional later path: Toss automatic billing

Toss automatic billing supports cards and account transfer, not domestic easy-pay wallets. It also requires risk review and an additional contract. yap. would need to issue and securely store a billing key, schedule charges itself, implement retry and dunning rules, stop scheduling after cancellation, and handle expired or replaced payment instruments.

Do not add this complexity until pass renewal behavior demonstrates a real need for automatic renewal.

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

Domestic PG sales, advertising revenue and related expenses remain part of Korean bookkeeping and tax reporting. Customer-facing KRW pricing should state clearly whether VAT is included; VAT-inclusive display is the recommended consumer presentation subject to professional confirmation.

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

### Free photo bundle

Select photos → explain “Watch one ad to send up to 5 photos” → completed and server verified → upload/send → retry safely on ambiguous failure.

### Free second-to-fifth channel

Tap create → complete valid channel form → explain slot and ad requirement → verified ad → create atomically → open channel.

The advertisement should appear only after the form is valid so users do not watch an ad and then discover an avoidable validation error.

### Plus purchase

Open Plus sheet → select 365 days by default or 30 days → create a server-priced pending order → Toss payment window → Worker confirms payment with Toss → D1 entitlement begins → dashboard refreshes account state → premium controls unlock.

### Cancellation

For a non-renewing pass, no cancellation is needed to stop future charges. A refund request follows the published policy and provider cancellation API, with the entitlement adjusted only after the server records the result. At normal expiry, downgrade non-destructively and preserve recoverable premium settings.

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

1. Register the Korean business and tax setup and ask Toss about the specific UGC SaaS, payment methods, fees and review requirements.
2. Finalize the unresolved product decisions below.
3. Add provider-neutral D1 order, payment, entitlement, webhook-event and rewarded-ad grant schema.
4. Implement Toss test-key order creation, payment confirmation, cancellation and refund reconciliation, and idempotency tests.
5. Add one server-side entitlement helper used by channel creation, media sending and customization updates.
6. Complete merchant and card review, then test all contracted methods with the merchant MID test keys, including mobile redirect behavior.
7. Launch Plus passes without ads first to validate purchase, expiry and downgrade behavior.
8. Add rewarded ads behind a feature flag for a small percentage of Free users.
9. Measure ad availability and completion before enforcing the gate for all Free users.
10. Consider card automatic billing only after repeat-purchase data demonstrates sufficient demand.
11. Add Polar only after overseas demand justifies a second billing and tax path.

## Decisions still required

- Whether the initial Korean product is definitively a non-renewing 30-day and 365-day pass; recommended for beta.
- Final VAT-inclusive KRW prices and refund amounts after receiving the PG fee quote.
- Whether Plus removes ads for every visitor in the owner channels or only for the owner; recommended: every visitor.
- The exact placement and maximum frequency of non-rewarded advertisements in free-owned channels.
- The fallback when no rewarded advertisement is available; recommended during beta: one bounded daily fallback grant.
- The migration treatment for existing customized channels; recommended: grandfather until changed or offer a transition trial.
- Whether active founding users keep their launch price on later repeat purchases.
- The retention period for premium background images after downgrade.
- Minimum account age or verification requirements before rewarded channel creation.
