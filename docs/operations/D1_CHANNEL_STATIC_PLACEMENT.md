# D1 static channel placement

This first cutover mechanism routes a small explicit channel allowlist without
performing a control-D1, KV, or Cache API lookup on each request. It is a
temporary canary mechanism before a versioned virtual-bucket map exists.

## Configuration

Both variables are required together:

```text
D1_CHANNEL_PLACEMENTS=canary-a:zziks
D1_CHANNEL_PLACEMENT_VERSION=2
```

The map accepts at most 20 comma-separated `shard:parent-channel` entries.
Only `canary-a` and `canary-b` are valid during the first rollout. Parent and
`_live` channel IDs resolve to the same placement. Unlisted channels remain on
primary placement version 1.

The complete configuration fails closed when a shard is unknown, a channel is
duplicated, a live ID is listed instead of its parent, the reports channel is
listed, a binding is missing or aliases the control database, or the placement
version is absent/invalid. Silent fallback to primary is forbidden because it
could split reads and writes across two databases.

## Activation gate

Do not add these variables or a Chat binding to the production Worker until:

1. every channel-local read and mutation resolves the same placement (ordinary
   message mutations are complete; DM, upload/config/moderation and channel
   lifecycle mutation coverage remains);
2. control-only account, auth, push and global operational state remains on
   control D1;
3. frozen final reconciliation and integrity checks pass;
4. shadow comparisons produce no unexplained mismatch;
5. rollback behavior is tested with the exact deployment configuration.

Changing the placement version invalidates placement-aware channel read
capabilities. Keep the old source database intact and read-only during the
rollback window.

## Tradeoffs

- Resolution is local and adds no network round trip, but changing the map
  requires a Worker deployment.
- A malformed map causes affected requests to fail rather than write to the
  wrong database. This favors consistency over availability during operator
  error.
- A single map version is simple for the bounded canary. Per-channel movement
  versions and tombstones are still required before general migration.
