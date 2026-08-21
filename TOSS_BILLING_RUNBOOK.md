# Toss Automatic Billing Runbook

This runbook covers the `yap.` Plus card automatic-billing flow. Never commit
client-specific secret keys, billing keys or real payment responses.

## Current flow

1. The authenticated frontend asks the Worker to create a server-priced order.
2. The checkout page opens Toss billing authorization with SDK v2.
3. Toss redirects with `authKey` and `customerKey`.
4. The Worker issues a billing key and immediately charges the pending order.
5. The Worker verifies payment type, status, order ID, amount and currency
   before storing payment, entitlement and subscription records.
6. The production Worker cron charges due subscriptions. Three failures stop
   renewal; cancellation stops the next charge without removing the current
   paid period.

The monthly final charge is `2,900 KRW` and the yearly final charge is
`17,000 KRW`. Both include VAT.

## Provider prerequisites

- Use API individual integration keys from one Toss merchant ID. The client
  key and secret key must belong to the same test or live merchant.
- Automatic billing must be enabled for that merchant contract. SDK support
  alone does not enable the product.
- Start with test keys. Do not put a live secret in Vercel or frontend code.

## Preview configuration

Set these Vercel Preview variables:

```text
TOSS_PAYMENTS_CLIENT_KEY=test_ck_...
NEXT_PUBLIC_WORKER_URL=https://letsplay-api-preview.letmetellu.workers.dev
INTERNAL_SECRET=<same value as the preview Worker>
```

Set the Worker secrets through interactive prompts:

```bash
cd worker
npx wrangler secret put INTERNAL_SECRET --env preview
npx wrangler secret put TOSS_PAYMENTS_SECRET_KEY --env preview
printf "0" | npx wrangler secret put PLUS_BETA_GRANDFATHER_ALL_USERS --env preview
```

Apply schema and deploy:

```bash
npx wrangler d1 migrations apply letsplay-db-preview --env preview --remote
npx wrangler deploy --env preview
```

Redeploy the Vercel preview after changing its variables. Preview Worker crons
are intentionally disabled, so they do not execute automatic renewals.

## Test checkout

1. Sign in to the Vercel preview with a non-grandfathered test account.
2. Open the Plus panel and choose the 30-day plan.
3. Confirm that the checkout displays `2,900 KRW` and VAT included.
4. Complete Toss billing authorization with a supported test card.
5. Confirm that the success page opens and Plus becomes active.
6. Record the test user's ID and inspect only that user's billing records.

Replace `<USER_ID>` before running:

```bash
cd worker
npx wrangler d1 execute letsplay-db-preview --env preview --remote --command "
SELECT order_id, billing_cycle, amount, currency, status, auto_renews, created_at
FROM billing_orders
WHERE user_id = '<USER_ID>'
ORDER BY created_at DESC
LIMIT 10;

SELECT provider_payment_id, order_id, amount, currency, status, approved_at
FROM payments
WHERE user_id = '<USER_ID>'
ORDER BY created_at DESC
LIMIT 10;

SELECT plan, status, starts_at, ends_at, auto_renews, source_order_id
FROM user_entitlements
WHERE user_id = '<USER_ID>'
ORDER BY created_at DESC
LIMIT 10;

SELECT plan, billing_cycle, status, current_period_started_at,
       current_period_ends_at, next_charge_at, failure_count
FROM billing_subscriptions
WHERE user_id = '<USER_ID>';
"
```

Expected state after one successful monthly checkout:

- one `paid` order for `2900 KRW`;
- one `paid` payment with the same order ID and amount;
- one active Plus entitlement with `auto_renews = 1`;
- one active monthly subscription with `failure_count = 0`.

Do not print or share the `billing_key` column.

## Production blockers

- Implement and test a Toss-specific webhook payload and authentication
  adapter before registering a webhook URL in the Toss dashboard. The current
  endpoint accepts a normalized internal event and must not receive Toss
  payloads directly.
- Confirm cancellation, refund and chargeback payloads against real Toss test
  samples and verify replay behavior.
- Decide how billing keys are encrypted or otherwise isolated at rest before
  live billing. D1 currently stores the key required for renewal.
- Complete the Toss automatic-billing contract, business disclosure, refund
  policy and tax review.
- Replace both client and secret test keys with a matching live key pair only
  after the preceding checks pass.
