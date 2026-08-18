# Unified Chat Pagination

This document tracks the isolated implementation on `codex/unified-chat-pagination`.
Nothing in this project should replace the production message or DM read path until
the shadow-comparison stage is complete.

## Objective

Return public messages, visible private DM roots and their replies as one stable,
authorization-aware visual timeline. A page boundary must never cause a DM to
appear before the root window that actually contains it.

## Current production behavior

- Public messages use root-aware, bidirectional pages.
- DM roots are read separately with a latest-50 limit; replies are fetched in a
  second query.
- The client merges both collections and conditionally reveals DMs using the raw
  timestamps of the currently mounted public messages.
- A recent reply attached to an old public root can widen that timestamp range and
  reveal DMs that belong to a different visual window.

## Non-negotiable invariants

1. A channel owner can see every non-pending-delete DM in that channel.
2. A non-owner can see only DM roots belonging to the server-resolved anonymous
   identity and replies attached to those roots.
3. A client-provided UID is never sufficient authorization.
4. Public-message passcode, moderation, deleted-parent and live-session boundaries
   remain unchanged.
5. Page reads have bounded row counts and bounded D1 variables.
6. The same cursor always produces the same strict before/after partition.
7. A root renders before its replies even when a reply was created much later.
8. No source can be duplicated or skipped when timestamps and IDs collide.

## Cursor contract

The ascending visual tuple is:

1. `visual_root_created_at`
2. `source` (`message` before `dm`)
3. `visual_root_id`
4. `visual_depth` (`0` root, `1` reply)
5. `created_at`
6. `id`

`source` is explicit because rows live in separate tables and table-local IDs must
not be assumed globally unique. Page size defaults to 50 and is capped at 100.

## Rollout stages

### Stage 1 — cursor and authorization contract

- Status: implemented on the feature branch.
- Adds a pure cursor parser, comparator and page-size clamp.
- Adds regression coverage for roots/replies, cross-source ties, malformed cursors
  and page bounds.
- Does not change production reads, rendering or API responses.

### Stage 2 — parallel server reader

- Status: internal reader implemented; it is not routed to an API yet.
- Public-message and authorized-DM parent candidates are fetched in parallel with
  `limit + 1` per source, then merged in Worker memory.
- The final root window is selected before public replies or DM replies are read.
  Reply queries receive only selected root IDs and use bounded placeholder buckets.
- Owner reads use the channel DM index; visitor reads additionally require the
  server-resolved anonymous UID and use the channel/UID/time index.
- Existing `/api/init`, `/api/data?type=messages` and client rendering remain
  unchanged. API exposure belongs to Stage 3 after authorization fixtures expand.

Stage 2 query budget per page:

- two parallel root-candidate reads, each capped at 51 for the normal page size;
- normally zero or one public-reply lookup and zero or one DM-reply lookup;
- page sizes above 50 split root IDs into 50-ID chunks, keeping every reply query
  below the D1 variable limit (at most two chunks per source at the hard maximum);
- at most 102 root candidates sorted in Worker memory;
- exactly 50 or fewer roots expanded into the returned internal page.

Stage 2 intentionally does not hydrate the reports inbox or expose a live route.
Those adapters must be added only after the base owner/visitor visibility matrix is
covered in Stage 3.

### Stage 3 — shadow comparison

- Status: implemented on the feature branch; disabled unless the request carries
  `X-Unified-Timeline-Shadow: 1` and requests the latest normal-channel page.
- The production response remains the legacy public-message response. In parallel,
  the Worker reads the legacy DM window and the new unified page, then compares the
  same bounded 50-root merged window.
- Non-owner comparison runs only when `X-Anonymous-Token` verifies successfully;
  URL parameters and other client-provided UID values are ignored. Owner scope still
  comes only from the trusted app-proxy identity.
- Mismatches record counts, the first mismatch position and source types. Message
  text, DM text, anonymous UIDs and identity tokens are never included.
- Live and reports channels, paginated history requests and unsigned visitors are
  deliberately skipped until their adapters have dedicated coverage.

To exercise this stage from a development client, issue the normal latest-message
request with the shadow header and inspect `X-Unified-Timeline-Shadow` on the
response (`match`, `mismatch`, `identity-required`, `skipped` or `failed`). The app
proxy forwards only the literal opt-in value and signed anonymous token.

### Stage 4 — production-shaped API contract

- Status: next implementation stage; no client should consume it yet.
- Add a dedicated unified-page response rather than overloading the legacy
  `messages` payload. The response contains `items`, `has_more`, complete start/end
  cursors and a contract version.
- Parse every cursor field with the Stage 1 validator. Invalid or partial cursors
  return `400`; they must never silently fall back to the latest page.
- Apply the existing channel-existence, passcode, owner and signed-anonymous gates
  before calling the reader. A missing visitor identity returns `401` for the
  unified route instead of creating a new identity during a history request.
- Keep live and reports channels disabled with an explicit unsupported response
  until their Stage 7 adapters are ready.
- Sign protected media inside the unified payload in the Next.js proxy exactly as
  legacy message and DM media are signed today.
- Add route-level fixtures for owner, matching anonymous visitor, different visitor,
  invalid room token, changed passcode, deleted channel and malformed cursor.

Exit criteria:

1. The route returns the same root/source order as a matching Stage 3 shadow run.
2. No visitor fixture can observe another visitor's DM root or owner reply.
3. The latest, `before` and `after` pages join without duplicate or missing roots.
4. The response remains bounded at 100 roots and every D1 statement remains below
   the variable limit.

Rollback: remove or disable only the new route. Legacy init/data/client paths remain
untouched in this stage.

### Stage 5 — single client timeline behind a kill switch

#### Stage 5A — state adapter

- Add one `timelineItems` state whose canonical identity is `(source, id)`.
- While existing hooks are migrated, derive public-message and DM views from that
  state with memoized selectors. Do not keep three independently mutable arrays;
  duplicated state would reintroduce reconciliation races.
- Preserve the legacy `messages` and `dmMessages` path behind a server-controlled
  kill switch. The default remains legacy.
- Treat the six-field server cursor as opaque client state. UI code must not derive
  a replacement cursor from DOM order or raw reply timestamps.

#### Stage 5B — bootstrap and reconnect

- Add a versioned unified bootstrap mode so enabled clients receive the latest
  unified page without also downloading legacy message and DM collections.
- Do not implement the rollout by fetching legacy init and then an additional
  unified page; that would double startup reads and produce a visible replacement.
- Reconnect and visibility-resume refreshes replace only the mounted latest root
  window, preserving older mounted pages and pending mutation state.
- A failed unified bootstrap falls back through the kill switch on the next full
  reload, not by merging an incomplete unified response into legacy state.

#### Stage 5C — history and navigation

- Upward pagination uses the page-start unified cursor and one top-visible root
  anchor. Insert the completed page once, then perform one anchor correction.
- Downward pagination uses the page-end cursor and preserves the live-edge rule:
  only users already near the bottom are returned to the bottom.
- Refresh restoration is session-only and stores the unified root/item identity,
  not a channel-persistent pixel offset.
- Message-context/gallery navigation must return a unified window centered on the
  target root. Link-panel behavior remains direct link opening.
- Loading media/widgets must not repeatedly trigger scroll correction. Navigation
  waits for the target window's bounded readiness signal and then performs at most
  one final correction.

#### Stage 5D — mutations and realtime events

- Normalize public-message, DM-root and DM-reply events into the same item shape.
- Deduplicate by `(source, id)` and retain `client_message_id` acknowledgement rules.
- Message/DM deletion removes the root and its children from the single state;
  undo restores the original ordered items once.
- Reactions and public-message edits continue to target only supported public
  sources. DM roots/replies must not accidentally acquire unsupported controls.
- A content-free DM invalidation triggers one bounded unified refresh. Concurrent
  invalidations share the in-flight request rather than starting parallel refreshes.
- Reconnection must never replay an acknowledged local send or append a server row
  twice.

Stage 5 exit criteria:

1. Owner and signed-visitor fixtures pass bootstrap, older/newer paging, reconnect,
   deletion/undo and DM-reply tests with the unified flag on and off.
2. No action maintains a separately mutable `dmMessages` copy when the flag is on.
3. Slow-network gallery navigation and upward history loading have no sustained
   oscillation and no more than one final anchor correction per completed page.
4. Startup makes either legacy reads or unified reads, never both.

Rollback: turn off the server-controlled flag. Keep the legacy client adapter until
the full rollout has remained stable for the agreed observation window.

### Stage 6 — bounded fan-out and query validation

The page limit counts roots, not rendered rows. Fifty roots can still expand into a
large number of public replies or DM replies. Before broad rollout:

- measure selected root count, expanded item count, maximum children under one root,
  Worker duration and D1 rows read for owner and visitor requests;
- inspect owner and visitor query fingerprints separately in D1 Insights;
- verify the owner DM plan uses a channel/time index and the visitor plan uses a
  channel/UID/time index;
- add a warning metric when one page expands beyond a provisional item threshold;
- if real data shows excessive fan-out, introduce an item-budget cursor capable of
  continuing inside one root. Do not silently truncate replies, because that would
  present an incomplete conversation as complete.

Initial rollout gates (to be calibrated with branch traffic, not treated as permanent
SLOs):

- zero authorization or ordering mismatches;
- no D1 variable-limit errors;
- unified P95 server duration no more than 50 ms above the comparable legacy read;
- no page with unexplained root duplication or loss;
- expanded-item distributions reviewed before enabling non-test accounts.

Trade-off: an intra-root continuation cursor makes the contract more complicated,
but is safer than allowing one extremely popular root to produce an unbounded page.
It should be added only if measurements show that the current bounded-root model is
insufficient.

### Stage 7 — special-channel adapters

#### Live channels

- Resolve the current unexpired live session before reading its timeline.
- Always enter at the latest unified page and preserve live-session deletion rules.
- Keep presence counts outside timeline pagination.
- Verify that session end/expiry cannot expose deleted live DMs through a parent
  channel cursor.

#### Reports inbox

- Hydrate report placeholders only after the authorized unified root window is
  selected.
- Preserve reports-owner and platform-admin boundaries and current locale-specific
  hydration.
- Compare hydrated IDs/order separately from normal-channel shadow metrics; report
  records are not ordinary public messages or private DMs.

Neither adapter should share a rollout flag with normal channels until its dedicated
authorization and lifecycle fixtures pass.

### Stage 8 — controlled rollout and cleanup

Rollout order:

1. local/preview Worker with deterministic fixtures;
2. channel-owner test accounts only;
3. signed visitors in those same test channels;
4. a small allowlist of normal channels;
5. sampled normal-channel traffic (for example 5%, then 25%);
6. all normal channels;
7. live and reports channels only after Stage 7;
8. remove legacy reads/state after the observation window.

Observe separately for owner and visitor traffic:

- request count, error rate and P50/P95/P99 duration;
- D1 rows read and query count per page;
- root count, expanded item count and maximum fan-out;
- shadow/order mismatch count;
- reconnect refresh count and coalescing rate;
- duplicate-item prevention count;
- navigation timeout and scroll-correction count.

Immediate rollback triggers:

- any cross-user DM visibility or authorization mismatch;
- reproducible missing/duplicated roots across a cursor boundary;
- passcode, deleted-channel or live-session boundary regression;
- repeated scroll oscillation or navigation to the wrong root;
- sustained unified error rate above 1% or P95 more than 100 ms over the current
  production baseline during the same traffic window;
- D1 variable-limit errors or unexpected unbounded row reads.

Cleanup after stable rollout:

- remove Stage 3 double-read shadow code first;
- remove legacy DM bootstrap/history requests and independently mutable client DM
  state;
- remove temporary compatibility selectors only after all mutation/search/context
  consumers use the unified source contract;
- retain cursor/authorization regression tests permanently;
- update `README.md`, `MIGRATION_NOTES.md`, `FUTURE_PLANS.md` and operational runbooks
  with the final contract and rollback history.

## Expected bottlenecks and inefficiencies

- A naive `UNION ALL` followed by a global sort may scan both channel histories on
  every page. Stage 2 must select bounded roots through source-specific indexes
  before merging candidates.
- Expanding replies before selecting roots multiplies rows and destabilizes page
  size. Root selection must happen first.
- Owner DM visibility can produce more candidates than visitor visibility. Query
  plans and row reads must be measured for both roles.
- Shadow comparison temporarily adds read cost and must be opt-in and sampled.
- Maintaining legacy and new client state simultaneously would duplicate memory and
  reconciliation work; the client switch should happen at a single adapter boundary.
- A root-bounded page can still have high reply fan-out. Stage 6 must measure the
  expanded row distribution before deciding whether intra-root continuation is
  required.
- Bootstrap fallback that downloads both formats would hide reliability problems by
  doubling reads. Fallback belongs at the next reload/flag decision, not as a second
  successful-path request.
- Content-free realtime invalidations can create refresh storms unless concurrent
  refreshes share one promise and reconnect bursts are coalesced.

## Implementation checklist

- [x] Stage 1 cursor and authorization contract
- [x] Stage 2 bounded parallel reader
- [x] Stage 3 opt-in latest-page shadow comparison
- [ ] Stage 4 production-shaped unified API contract and route fixtures
- [ ] Stage 5A single-state client adapter and kill switch
- [ ] Stage 5B unified bootstrap/reconnect
- [ ] Stage 5C bidirectional history/context/navigation
- [ ] Stage 5D mutation and realtime normalization
- [ ] Stage 6 fan-out/query measurements and any required continuation design
- [ ] Stage 7 live and reports adapters
- [ ] Stage 8 controlled rollout, observation and legacy cleanup

Every unchecked item should land as its own documented commit. A stage is complete
only when its exit criteria pass; code presence alone is not completion.

## Trade-offs

- The cursor is larger than the current `{created_at, id}` cursor, but it removes
  ambiguous cross-table boundaries.
- Source ordering is an implementation rule visible only when two roots have the
  exact same timestamp. Determinism is more important than pretending those roots
  have an undefined order.
- The staged rollout takes longer than a direct query replacement but materially
  reduces the risk of private DM exposure, missing messages and unrecoverable scroll
  jumps.
- An opted-in latest-page read temporarily performs both legacy and unified reads.
  This is intentionally too expensive for default traffic and must remain off until
  a later sampled rollout.
