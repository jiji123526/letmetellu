# D1 Canary Channel Shadow Reads

## Purpose

This gate checks a small set of copied channel rows before any request is
routed to a Chat shard. It is evidence gathering only. The control D1 remains
the source used by `/api/init`, authorization, mutations, and the response sent
to the user.

Production remains disabled unless both physical canary bindings and
`D1_CANARY_SHADOW_CHANNELS` are configured.

## Configuration

Use a static comma-separated mapping:

```text
canary-a:channel-one,canary-b:channel-two
```

Rules:

- only `canary-a` and `canary-b` are accepted;
- channel IDs must match `^[a-z0-9-]{3,30}$`;
- at most 20 parent channel IDs are accepted;
- duplicate or conflicting channel placements invalidate the entire setting;
- the configured reports channel is always excluded;
- a `_live` request is compared against its configured parent channel;
- a missing, empty, or invalid setting performs no shadow D1 reads.

Do not place secrets in this variable. Do not configure a channel before its
canonical row has been copied and audited on the selected canary.

## Runtime behavior

After a successful `GET /api/init`, the Worker schedules the comparison with
`waitUntil`. It reads one explicit row from the control D1 and one from the
selected canary. It compares only:

- row existence;
- channel and owner identity;
- passcode equality and frozen state;
- channel instance ID;
- profile visibility;
- projection source version.

The comparison does not select messages, DMs, notices, profile images,
backgrounds, media, or other channel content. It never changes the response,
authorization result, channel placement, or write destination.

Matches create no operational-event write. Mismatches produce
`canary_channel_shadow_mismatch` with only the shard ID and fixed reason codes.
Failures produce `canary_channel_shadow_failed` with a fixed error code. Raw D1
errors and compared values are not recorded. Repeated identical observations
are suppressed for five minutes per Worker isolate, and the in-memory key set
is capped.

## Activation sequence

1. Bootstrap and audit an empty canary database.
2. Copy one low-risk, non-reports parent channel by an independently reviewed
   migration procedure.
3. Re-run the canary schema audit and projection reconciliation.
4. Add only that channel to `D1_CANARY_SHADOW_CHANNELS`.
5. Deploy without changing `resolveChannelDatabase`.
6. Observe mismatch and failure events for at least one normal operational
   window.
7. Remove the setting immediately if canary reads add measurable D1 pressure
   or failures.

Do not combine shadow-read activation with dispatcher activation, data copy,
or routing cutover in one deployment.

## Tradeoffs

- Each allowlisted successful init adds two metadata reads. `waitUntil` keeps
  them outside the response dependency chain but does not make their D1 and
  Worker resource cost free.
- Isolate-local event suppression is deliberately approximate. A new isolate
  may record the same issue again, while repeated issues in one isolate may be
  hidden for five minutes.
- Equality proves only the selected metadata contract at the observation time.
  It does not prove message, DM, media, search, maintenance, or mutation
  correctness.
- Exact passcode comparison occurs only in Worker memory. No passcode value is
  returned or logged, but the canary is therefore security-sensitive and must
  receive the same access controls as the control database.
