# D1 canary report-dispatch exercise

This gate proves that one prepared Chat canary can deliver its durable
`channel_report` events to the control database. It does not enable periodic
dispatch, route a channel, or change production configuration.

## Entry gate

- The frozen copy job is at `delta_channel_reports_verified`.
- Global HTTP and scheduled writes remain paused for the copied channel.
- `D1_CANARY_PROJECTION_DISPATCH_ENABLED` is absent or not `true`.
- The isolated operator Worker has exactly one intended Chat-canary binding and
  a dedicated `D1_CANARY_DISPATCH_TOKEN` secret of 32–256 characters.
- The operator environment uses `WRITE_MAINTENANCE_MODE=true`.
- The reports special channel is never selected.

The endpoint is `POST /internal/d1-canary/dispatch-once`. It accepts only:

```json
{
  "action": "dispatch-channel-reports",
  "shard": "canary-a",
  "channel": "example-channel"
}
```

One call claims at most ten ready or expired-lease events matching both the
exact channel and the `channel_report` aggregate type. It returns only shard,
channel, aggregate type, and claimed/delivered/retried/dead counts. Report
content and identifiers are not returned.

## Exercise sequence

1. Record metadata-only pending-event and control-projection counts.
2. Submit one report through an approved isolated canary mutation path.
3. Call the one-shot dispatcher until `claimed` is zero, recording only count
   results.
4. Verify the control projection is active at the canonical source version.
5. Apply one moderation update, dispatch again, and verify the higher version
   and updated state.
6. Delete the canonical test report after evidence is captured, dispatch
   again, and verify that the projection is absent while its control watermark
   remains `deleted` at the next version.
7. Repeat once with no new event. The zero-claim result proves the operator does
   not replay delivered rows.
8. Remove or rotate the dedicated dispatch secret after the exercise.

Retry and malformed-event dead-letter behavior is covered by the local SQLite
integration test. Do not intentionally damage a shared remote control binding
or insert malformed sensitive payloads merely to reproduce those cases.

## Stop conditions

Stop without retrying broadly if any call:

- returns a fixed `409` prerequisite failure;
- reports `retried` or `dead` unexpectedly;
- advances a different channel or aggregate type;
- leaves canonical, projection, and watermark versions inconsistent;
- exposes report fields in an operator response or log.

Do not enable the scheduled dispatcher to work around a failed one-shot. Keep
the source frozen and investigate with metadata-only queries.

## Irreversibility and cleanup

The first successfully claimed event changes the destination copy from
"unprocessed" to "processed." The existing automated copy-cleanup operator
then fails closed on non-pending event rows. This is deliberate: deleting a
copy after it has emitted control-plane effects requires a separate reviewed
rollback that reconciles those effects first.

Therefore, running this exercise is a no-return gate for ordinary automated
cleanup. It requires a separate production-change approval even after the code
is deployed to an isolated operator environment.

## Performance and tradeoffs

- Candidate reads use the existing status/time indexes and add bound channel
  and aggregate filters. A later migration may add a scope-leading index if
  remote query metadata shows materially excessive rows read; adding one now
  would increase every event write without evidence.
- Claim and acknowledgement remain separate source operations around a
  version-guarded control batch. A crash can cause redelivery after lease
  expiry, but monotonic watermarks make that delivery idempotent.
- A limit of ten makes the operator intentionally slow for large backlogs. This
  is acceptable for a one-channel proof and prevents an accidental broad drain.

No command in this runbook may be executed against a remote or production
environment without a separate production-change review.
