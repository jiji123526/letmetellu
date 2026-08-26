# Unified Chat Pagination

This document records the implementation merged to `main` and the remaining
production observation/cleanup work. The intended small-installation configuration
uses the explicit global switch; legacy reads remain available for rollback.

## Objective

Return public messages, visible private DM roots and their replies as one stable,
authorization-aware visual timeline. A page boundary must never cause a DM to
appear before the root window that actually contains it.

## Current implementation

- Public roots and authorized DM roots are selected into one bounded visual window
  before their children are expanded.
- Owners receive all channel DM roots; visitors receive only roots belonging to
  their Worker-verified anonymous identity and owner replies under those roots.
- Normal, live and reports views use the same versioned timeline contract. Live
  reads additionally bind to the current session, while reports hydration remains
  owner-only and occurs after page selection.
- The client stores one source-qualified canonical collection, holds the viewport
  through prepend/media layout, and retains legacy state only as rollback
  compatibility.

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

- Status: completed and merged.
- Adds a pure cursor parser, comparator and page-size clamp.
- Adds regression coverage for roots/replies, cross-source ties, malformed cursors
  and page bounds.
- Does not change production reads, rendering or API responses.

### Stage 2 — parallel server reader

- Status: completed and routed through the unified API.
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

- Status: completed; disabled unless the request carries
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

- Status: completed and consumed by the unified client.
- `GET /api/unified-timeline` is a dedicated Worker endpoint with a matching
  Next.js proxy. It does not overload or modify the legacy `/api/data` payload.
- The versioned response contains `contract_version: 1`, `items`, `has_more`,
  `page_start_cursor` and `page_end_cursor`.
- History requests send `direction=before|after` plus all six cursor fields:
  `cursor_visual_root_created_at`, `cursor_source`, `cursor_visual_root_id`,
  `cursor_visual_depth`, `cursor_created_at` and `cursor_id`. The latest page sends
  neither a direction nor cursor.
- Cursor fields are all-or-none and must describe a canonical root boundary:
  depth is zero and the item ID/time equal the visual-root ID/time. Partial,
  duplicate, malformed or reply-level cursors return `400` rather than falling
  back to the latest page.
- Existing channel-existence, current-passcode and trusted-owner checks run before
  the reader. Non-owners require a valid signed anonymous identity; URL UIDs and
  forged user headers are ignored, and missing or invalid identity returns `401`.
- Live and reports timelines return `409 unified_timeline_unsupported` unless the
  global switch or their separate Stage 7 allowlist enables them. A non-owner
  still receives `403` at the reports authorization boundary before rollout
  selection.
- The Next.js proxy forwards only trusted session identity, current room access and
  the signed anonymous token. It applies the existing protected-media signer to
  unified `items`.
- Route fixtures cover owner and visitor DM visibility, owner replies, forged
  identity, passcode rotation, channel deletion, special channels, cursor
  validation, media signing, the 100-root cap and duplicate/gap-free latest,
  `before` and `after` joins.

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

- Status: completed; rollout selection is now controlled by the global switch or
  the retained allowlist/cohort fallbacks.
- `ChatView` now owns one discriminated timeline state. Legacy mode stores the
  existing public-message/DM pair; unified mode stores only `timelineItems`, keyed
  canonically by `(source, id)`, so equal IDs from separate tables cannot collide.
- Existing hooks temporarily receive memoized public-message and DM projections plus
  compatibility setters. In unified mode those setters transact against the single
  timeline collection and preserve the other source rather than mutating separate
  arrays.
- The Worker exposes `unifiedTimelineEnabled` in normal-channel init responses only
  when the exact channel ID appears in the comma-separated
  `UNIFIED_TIMELINE_CHANNEL_ALLOWLIST`. Missing or empty configuration keeps legacy
  mode; live and reports channels remain legacy regardless of the allowlist.
- Enabling a channel converts its current legacy snapshot into canonical unified
  items. Removing it from the allowlist converts mounted unified state back into
  the compatibility pair on the next authoritative init response.
- Unified start/end cursors are stored unchanged as opaque six-field server values.
  The adapter has no code that reconstructs them from DOM order, item timestamps or
  the old two-field message cursor.
- Stage 5A intentionally continues consuming the existing init payload. Replacing
  that read with the versioned unified bootstrap, without double-fetching both
  formats, belongs to Stage 5B.

Rollback: remove the channel ID from `UNIFIED_TIMELINE_CHANNEL_ALLOWLIST` and refresh
or trigger an authoritative init. With the variable absent, this commit behaves as
the legacy client did.

#### Stage 5B — bootstrap and reconnect

- Status: completed for normal channels and the global deployment path.
- `/api/init` now selects one timeline reader after authorization. An allowlisted
  normal channel returns a versioned `unifiedTimeline` page and does not execute
  legacy public-message or DM reads; other channels retain the legacy response.
- The existing init request carries channel metadata and the unified latest page
  together. The client does not fetch `/api/init` and then issue a second unified
  request, avoiding doubled startup reads and visible state replacement.
- Unified items inside init receive the same protected-sender marking, app-proxy
  media capabilities and browser media decoration as legacy message/DM arrays.
- Reconnect, `messages-sync` and foreground recovery after a long background period
  use an authoritative unified init when enabled. The incoming latest root window
  replaces stale roots/replies in that window while older mounted roots remain.
- A context-mode view does not inject an unrelated latest page. It preserves its
  current window and marks that newer content is available.
- Missing or unsupported unified contract data fails the request without clearing
  mounted state or issuing a legacy fallback. Rollback occurs only after the server
  allowlist is disabled and the client performs a later full init.
- Live and reports channels continue to use legacy bootstrap. Bidirectional history,
  context and gallery navigation remain on legacy routes until Stage 5C.

Rollback: remove the channel from `UNIFIED_TIMELINE_CHANNEL_ALLOWLIST`. The next
full init returns the legacy payload and the Stage 5A adapter converts its mounted
state back to legacy mode.

#### Stage 5C — history and navigation

- Status: completed for normal channels and the global deployment path.
- Older/newer loads use the opaque unified page-start/page-end cursors and one
  coalesced request. Canonical state merges by `(source, id)` once; no client cursor
  is reconstructed from timestamps or DOM order.
- Upward loads lock one top-visible anchor, wait for bounded media readiness and
  perform one final correction. Downward loads preserve the current anchor and the
  existing live-edge behavior.
- Mounted unified history is bounded near 300 rendered items. Trimming works in one
  linear pass over root groups and never splits a root from its replies; the
  opposite edge is marked pageable after trimming.
- The unified endpoint accepts an authorized target source/ID and returns a centered
  51-root window. Public targets resolve through their root ancestry; private roots
  and replies additionally require owner scope or the matching signed visitor.
- Search, message-context, gallery and refresh restoration consume that centered
  window. Refresh state remains in `sessionStorage` and records `(source, id)`,
  viewport offset, live mode and age; it is not channel-persistent.
- Identical page/context requests share one in-flight promise. The server resolves
  the target once, reads four bounded before/after source ranges in parallel and
  expands replies only for the selected window.
- Live and reports channels remain on their existing navigation paths pending Stage
  7. Link-panel entries continue opening their destination directly.

Trade-off: centered navigation performs one target lookup, four bounded candidate
reads and up to two selected-root reply expansions. This is more queries than a
public-message-only context read, but it keeps DM authorization source-specific and
avoids a global cross-table sort or downloading two client windows.

#### Stage 5D — mutations and realtime events

- **Completed 2026-08-18.** Public-message, DM-root and DM-reply inserts now enter
  canonical state through source-qualified upserts. Send acknowledgements and
  subsequent realtime delivery converge by `(source, id)` and
  `client_message_id`, so reconnect delivery cannot append the committed row
  twice.
- Hard deletion removes one source-qualified root group, including mounted
  children. Failed deletion and successful Undo restore the captured items
  idempotently in canonical visual order. A public row and DM with the same ID
  remain independent.
- Public edits and reactions continue through the public-message projection and
  cannot mutate a colliding DM identity. The legacy adapter remains available
  for rollback without adding another mutable collection in unified mode.
- Content-free `dm-threads-changed` events use one bounded unified latest
  refresh when the flag is enabled. Concurrent events share one in-flight
  promise and apply its response once; legacy and live modes retain the
  dedicated DM reader.
- Canonical event work is linear over the bounded mounted window. This stage
  adds no polling, D1 migration or additional read on ordinary message events.

Trade-off: each small canonical insert normalizes and sorts the mounted window
to preserve visual-root ordering. The window is capped near 300 items, making
this bounded client work preferable to maintaining mutable public/DM arrays or
performing a server refresh for every event.

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

- **Instrumentation completed 2026-08-18.** Every allowlisted page, context and
  bootstrap read emits one structured `unified_timeline_read` record containing
  owner/visitor scope, root/item counts, maximum children under one root, source
  counts, query count, D1 rows read, D1 SQL duration and Worker reader duration.
  Explicit shadow comparisons emit the same record.
- Pages above the provisional 300-item mounted budget emit
  `unified_timeline_fanout_warning` instead. This is a log warning, not a D1
  operational-event write, so measurement does not add database work.
- `worker/scripts/audit-unified-timeline-fanout.sql` reports public and DM fan-out
  distributions without selecting content and verifies owner DM, visitor DM,
  public-root and public-child query plans. Run it against production before
  enabling non-test accounts. Execute it with
  `--command "$(cat scripts/audit-unified-timeline-fanout.sql)"`; Wrangler's
  remote `--file` import mode prints only aggregate counts, not the individual
  read-only query results.
- **Production fan-out audit passed 2026-08-26.** Across 1,150 public roots with
  replies, average fan-out was 1.33, maximum fan-out was 15 and no root exceeded
  the 300-item warning budget. Seven DM roots averaged 1.14 replies, had a
  maximum of two and did not exceed the 20-reply product limit. The visitor,
  public-root and public-child plans used their intended indexes.
- The owner DM plan used `dm_channel_created_idx` and created a temporary B-tree
  only for the final `id` ordering term because the older index ends at
  `created_at`. Candidate reads remain capped at 51. Do not add another owner
  index solely for this bounded tie-break sort; reconsider it only if production
  owner metrics show material rows-read or latency.
- After deploying to an allowlisted test channel, run
  `npx wrangler tail --format json` while exercising latest, older, context and
  reconnect reads once as the owner and once as a signed visitor. Review the two
  scopes separately in both tail output and D1 Insights.
- Reader tests preserve exact query/row metadata aggregation, lookup chunking and
  the warning boundary. No replies are truncated, and no intra-root cursor has
  been added without evidence that it is needed.

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
- expanded-item distributions reviewed before enabling non-test accounts
  (completed 2026-08-26).

Trade-off: an intra-root continuation cursor makes the contract more complicated,
but is safer than allowing one extremely popular root to produce an unbounded page.
It should be added only if measurements show that the current bounded-root model is
insufficient.

Current trade-off: allowlisted and explicit-shadow reads produce one small
structured log each. This is acceptable for test-channel calibration and cheaper
than writing telemetry to D1, but logging must be sampled or removed before a broad
rollout if volume becomes material.

### Stage 7 — special-channel adapters

#### Live channels

- **Adapter completed 2026-08-18.** Live rollout uses the separate
  `UNIFIED_TIMELINE_LIVE_CHANNEL_ALLOWLIST`; the normal-channel allowlist cannot
  enable it accidentally.
- Live bootstrap resolves an active, unexpired session before selecting the
  unified reader and revalidates the same session after the read. An ended or
  replaced session discards the page instead of returning rows from the stale
  `_live` channel lifecycle.
- Older/newer and centered requests carry `live_session_id`. The Worker checks it
  before and after every read, so a cursor from an ended session cannot read a new
  session that later reuses the same `_live` channel ID.
- Reconnect, message/DM invalidation, search/context and refresh restoration stay
  on unified reads while live. Invalidation refreshes remain single-flight and
  reconcile the returned session before applying items.
- Live bootstrap still enters at the latest page. Presence joins/counts continue
  through the Durable Object and are not part of timeline pages or D1 fan-out.
- Lifecycle tests cover missing/stale session IDs, session replacement, a session
  ending during a database read and the default-off separate rollout boundary.

Trade-off: allowlisted live reads add one indexed config lookup before and after
timeline access. The second lookup is deliberate revocation validation; it costs
less than session-specific storage tables while preventing stale private-DM
exposure across live-session reuse.

#### Reports inbox

- **Adapter completed 2026-08-18.** Reports rollout uses the separate
  `UNIFIED_TIMELINE_REPORTS_CHANNEL_ALLOWLIST`; normal and live allowlists cannot
  enable it accidentally, and missing configuration keeps legacy reads active.
- The existing reports-channel owner check runs before rollout selection. Unified
  bootstrap, page and context reads select the authorized root window first, then
  hydrate only selected public-message placeholders in the owner's current locale.
- Hydration uses two constant-shape `json_each(?)` lookups for reports and
  petitions. Item count no longer expands bound parameters or SQL fingerprints,
  and no lookup runs for an empty or DM-only page. Migration `0048` adds the
  missing petition inbox-message index so both metadata lookups are indexed.
- A reports-specific identity/order comparison guards the adapter boundary.
  Hydration may add `report_meta` or `petition_meta`, but cannot add, remove or
  reorder `(source, id)` entries. Mismatches fail closed and emit only counts,
  never IDs or report content.
- Direct page/context access retains owner-only authorization. Report metadata
  remains outside normal-channel shadow comparisons and private DM rows are never
  passed to the report hydrator.

Trade-off: an allowlisted reports page performs up to two indexed metadata lookups
after timeline selection. That is the same logical hydration work as the legacy
inbox, but with a stable query shape and without reading metadata for placeholders
outside the selected page.

### Stage 8 — controlled rollout and cleanup

#### Authoritative kill switch

- **Completed 2026-08-18.** The normal-channel allowlist is now enforced by both
  bootstrap and every direct unified page/context request. Live and reports
  requests retain their separate allowlists.
- Removing a channel returns `409 unified_timeline_disabled` to an already-open
  normal-channel tab. The browser performs one guarded reload and bootstraps the
  legacy reader; it does not retry the failed unified request or issue both read
  formats.
- A session-scoped 30-second guard prevents reload loops during edge propagation.
  This path runs only after an explicit server rejection and adds no normal-path
  request, polling, storage write or D1 query.

From `worker/`, configure one comma-separated channel allowlist at a time:

```bash
npx wrangler secret put UNIFIED_TIMELINE_CHANNEL_ALLOWLIST
npx wrangler secret put UNIFIED_TIMELINE_LIVE_CHANNEL_ALLOWLIST
npx wrangler secret put UNIFIED_TIMELINE_REPORTS_CHANNEL_ALLOWLIST
```

Rollback the corresponding path immediately by deleting its binding:

```bash
npx wrangler secret delete UNIFIED_TIMELINE_CHANNEL_ALLOWLIST
npx wrangler secret delete UNIFIED_TIMELINE_LIVE_CHANNEL_ALLOWLIST
npx wrangler secret delete UNIFIED_TIMELINE_REPORTS_CHANNEL_ALLOWLIST
```

Only configure the flag currently under test. Do not put `*`, percentages or user
IDs in these values: matching is by exact parent channel ID.

#### Stable prepend rendering

- **Completed 2026-08-18.** Canonical unified items retain object identity across
  older-page merges. Existing public and DM bubbles no longer rerender merely
  because a new root window was prepended.
- Parent traversal and object creation remain only for non-canonical
  legacy/realtime inputs. Unified merges still deduplicate and sort once, without
  adding a second state collection or DOM measurement pass.
- The prepend path continuously holds the pre-request viewport anchor while newly
  inserted images and embeds settle, then applies a final correction. It no longer
  waits for media stabilization while the old content is visibly displaced.

#### Deterministic normal-channel cohorts

- **Completed 2026-08-18.** Normal channels can enter a deterministic percentage
  cohort through `UNIFIED_TIMELINE_SAMPLE_PERCENT` plus
  `UNIFIED_TIMELINE_SAMPLE_SALT`. Both are required; missing, malformed, zero or
  out-of-range values fail closed.
- The cohort hashes the secret salt and parent channel ID into 10,000 buckets.
  Owners and visitors therefore use the same path for a channel, and repeated
  bootstrap/page/context requests cannot alternate between legacy and unified.
- Exact `UNIFIED_TIMELINE_CHANNEL_ALLOWLIST` entries always win. Percentage
  sampling never applies to live or reports channels, which retain their dedicated
  exact allowlists.
- Structured read records include `rollout_mode` as `allowlist`, `sample` or
  `shadow`. They do not include channel IDs, user IDs, cursor values or content.
- Hashing is synchronous in-memory work over one short channel ID. It adds no
  cookie, random decision, D1 lookup, telemetry write or client request.

After exact-channel calibration succeeds, set one stable salt and start at 5:

```bash
npx wrangler secret put UNIFIED_TIMELINE_SAMPLE_SALT
npx wrangler secret put UNIFIED_TIMELINE_SAMPLE_PERCENT
```

Enter `5` for the first sampled window, then replace only the percentage with `25`
after the observation gates pass. Keep the salt unchanged so the 5% cohort remains
inside the 25% cohort. Use `100` only after the 25% window passes.

Rollback sampled traffic by deleting the percentage:

```bash
npx wrangler secret delete UNIFIED_TIMELINE_SAMPLE_PERCENT
```

Exact allowlisted channels remain enabled during that rollback. Delete
`UNIFIED_TIMELINE_CHANNEL_ALLOWLIST` too for a complete normal-channel rollback.

#### Small-installation global switch

- **Completed 2026-08-18.** `UNIFIED_TIMELINE_GLOBAL_ENABLED=1` enables unified
  pagination for normal, live and reports channels without cohorts or per-channel
  allowlists.
- The switch changes only rollout selection. Reports remain owner-only, room
  passcodes remain current-hash bound, private DMs remain viewer scoped and live
  requests still require the current active session ID before and after reads.
- Any value other than the exact string `1` fails closed. Global reads emit
  `rollout_mode=global` without identifiers or content.

For a small installation that has completed active-channel checks, enable global
mode:

```bash
npx wrangler secret put UNIFIED_TIMELINE_GLOBAL_ENABLED
```

Enter `1`. After it is active, remove obsolete cohort configuration:

```bash
npx wrangler secret delete UNIFIED_TIMELINE_SAMPLE_PERCENT
npx wrangler secret delete UNIFIED_TIMELINE_SAMPLE_SALT
```

Delete any timeline allowlist secrets too if they are no longer used. This matters
for rollback: remove all fallback rollout settings first, then global rollback is:

```bash
npx wrangler secret delete UNIFIED_TIMELINE_GLOBAL_ENABLED
```

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

For the current deployment, analyze `rollout_mode=global` separately from any old
allowlist, sample or shadow records.

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
- [x] Stage 4 production-shaped unified API contract and route fixtures
- [x] Stage 5A single-state client adapter and kill switch
- [x] Stage 5B unified bootstrap/reconnect
- [x] Stage 5C bidirectional history/context/navigation
- [x] Stage 5D mutation and realtime normalization
- [ ] Stage 6 fan-out/query measurements and any required continuation design
- [x] Stage 7 live and reports adapters
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
