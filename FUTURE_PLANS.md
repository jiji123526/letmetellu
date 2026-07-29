# Future Plans

Since the reporting flow is already in place, the next direction should be
moderation hardening and operations, not more surface features.

## Recommended Order

1. **Abuse controls**  
   Add durable server-side limits for reports, messages, uploads, and preview
   fetches. The biggest remaining gap is that some limits are still
   memory-local or too soft.

2. **Moderation audit trail**  
   Store every freeze, unfreeze, delete, resolve, dismiss, and petition
   decision in an append-only log. Once moderation affects real users,
   traceability matters more than new UI.

3. **Owner moderation lifecycle**  
   Tighten the full flow for warned or frozen channel owners: `warning` ->
   `freeze` -> `petition` -> `accept/reject` -> `unfreeze/delete`. This is
   where product quality will matter most.

4. **Security headers and dependency cleanup**  
   Add CSP, `nosniff`, referrer policy, frame policy, and HSTS, then do
   dependency upgrades safely. This is straightforward risk reduction before a
   wider launch.

5. **Operational visibility**  
   Add basic metrics and alerts for report volume, moderation actions,
   `403`/`429`/`5xx` rates, upload failures, and WebSocket auth failures.

## Not Yet

- Full multi-moderator RBAC
- A large separate super-admin console
- General support inbox or 1:1 support threads

These are worth doing only after the current single-admin moderation flow is
stable.

## If The Goal Is To Ship Soon

- Durable quotas and rate limits
- Audit log
- Security headers
- Moderation edge-case testing

## If The Goal Is To Grow The Product

After the hardening work above, the next feature is more likely separate
support threads, not more reporting UI.
