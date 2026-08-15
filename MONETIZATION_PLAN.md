# yap. Monetization Plan

Status: product proposal; not yet implemented  
Last updated: 2026-08-15

## Goals

- Keep the core anonymous-channel experience usable without payment.
- Let free users exchange a completed rewarded advertisement for specific, bounded actions.
- Give paying channel owners a simple ad-free experience and customization benefits.
- Validate willingness to pay before building complex usage-based billing.
- Keep billing and rewarded-ad authorization enforceable by the server rather than trusting browser state.

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

- USD 2 per month; or
- USD 12 per year.

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

Polar is the leading Merchant of Record candidate because it supports South Korean payouts, subscriptions, a hosted customer portal, webhook synchronization and a TypeScript/Next.js SDK.

Before implementation:

- Ask Polar to confirm that a moderated anonymous user-generated-content SaaS is acceptable.
- Explain reporting, blocking, prohibited-word controls, platform moderation, suspension and content removal.
- Create monthly and annual products in the Polar sandbox.
- Confirm the Korean-customer card, currency and tax experience in sandbox or provider review.
- Confirm whether founding subscribers retain their original product price.

The low monthly price has a high proportional transaction cost because Polar currently charges a fixed per-transaction component. The annual product should therefore be the default presentation, while monthly remains the low-commitment option.

## Server-side source of truth

Neither a successful checkout redirect nor a browser flag grants Plus. Polar webhooks update D1, and Worker authorization reads D1 before enforcing paid capabilities.

Suggested records:

### `user_subscriptions`

- `user_id`
- `provider`
- `provider_customer_id`
- `provider_subscription_id`
- `product_id`
- `plan`
- `status`
- `current_period_end`
- `cancel_at_period_end`
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

Open Plus sheet → select annual by default or monthly → hosted checkout → webhook confirms entitlement → dashboard refreshes account state → premium controls unlock.

### Cancellation

Open hosted customer portal → cancel → retain Plus until the paid period ends → downgrade non-destructively → preserve recoverable settings.

## Metrics for deciding whether this model works

