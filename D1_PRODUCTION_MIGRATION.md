# D1 production migration staging

## 2026-09-06 — Preview snapshot prepared

Production remains bound to `letsplay-db` (`66a364d6-b00a-42df-b1b4-004e284dd686`).
Writes and scheduled jobs are enabled in production. No production binding has
been changed.

A replacement database, `letsplay-db-prod-20260906-v2`
(`70df52e9-07b3-4cdc-b9f7-1488d081c65f`), was created in ENAM and all 63
repository migrations were applied. A live production snapshot was imported
for Preview validation.

Cloudflare D1 export cannot export an FTS5 virtual table. The copy therefore
excluded `messages_fts` and its shadow tables; message insert triggers rebuilt
the trigram index during import. `gallery` was also excluded because its
canonical consistency trigger rebuilt it from messages. The seeded
`operational_health_alert_state` row was left at its migration default, and
`notification_outbox` was intentionally excluded so the staging Worker cannot
later deliver notifications already processed by production.

Validation immediately after import:

- users: 42 source / 42 target
- channels: 36 source / 36 target
- messages: 16,603 source / 16,603 target
- DMs: 74 source / 74 target
- gallery: 242 source / 242 target
- message links: 420 source / 420 target
- FTS rows: 16,603 source / 16,603 target
- push subscriptions: 7 source / 7 target
- orphan gallery rows: 0
- missing gallery rows: 0
- `PRAGMA quick_check`: `ok`
- `PRAGMA foreign_key_check`: no violations

The isolated Worker is `letsplay-api-d1-cutover-preview`. It has no cron
triggers and uses the probe-only R2 bucket, so Preview uploads and deletes
cannot modify production media. Existing production media is not copied and
may therefore be absent from Preview; this does not test R2.

## Cutover consistency requirement

The Preview snapshot is a validation copy, not yet a cutover-ready live
replica. Writes made in production after the snapshot are not automatically
copied. Do not point production at this database without a final consistency
step.

Safe choices for the final switch:

1. Briefly reject writes, make/import a final snapshot, verify counts, switch
   the binding, deploy, run a write smoke test, then reopen writes. Reads stay
   available throughout.
2. Implement and validate dual-write for every mutation path before cutover.
   This avoids the brief pause but adds substantially more consistency and
   rollback risk.

The optional `WRITE_MAINTENANCE_MODE` guard exists for choice 1 but is disabled
unless the environment variable is explicitly set to `true`.

## Rollback

Keep the old production D1 unchanged after cutover. If health checks or writes
fail, restore the previous database ID in `worker/wrangler.toml` and redeploy
the Worker. Do not delete the old D1 until the observation period is complete.
