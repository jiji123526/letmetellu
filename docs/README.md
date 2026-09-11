# Project documentation

Project documentation is grouped by purpose. Start here instead of adding new
Markdown files to the repository root.

## Product

- [Future plans](./product/FUTURE_PLANS.md): current priorities and deferred work
- [Monetization plan](./product/MONETIZATION_PLAN.md): free/paid product rules and payment direction
- [Notification plan](./product/NOTIFICATION_PLAN.md): Web Push product behavior and remaining work
- [Marketing visual prompts](./product/MARKETING_VISUAL_PROMPTS.md): promotional asset requirements and prompts

## Architecture and security

- [Unified chat pagination](./architecture/UNIFIED_CHAT_PAGINATION.md): timeline model, rollout stages, and query constraints
- [D1 partitioning strategy](./architecture/D1_PARTITIONING_STRATEGY.md): channel sharding trade-offs, rollout plan, and platform case studies
- [Security authorization matrix](./architecture/SECURITY_AUTHORIZATION_MATRIX.md): identity evidence and privileged boundaries
- [Notification delivery optimization](./architecture/NOTIFICATION_DELIVERY_OPTIMIZATION.md): notification query costs and scaling priorities
- [Next.js + Worker edge architecture guide (Korean)](./architecture/NEXTJS_WORKER_EDGE_ARCHITECTURE_KO.md): deep explanation of the browser, Next.js, Worker, D1, Durable Object, R2, and Cache API structure

## Operations

- [Launch checklist](./operations/LAUNCH_CHECKLIST.md): release gates and production smoke tests
- [Operations runbook](./operations/OPERATIONS_RUNBOOK.md): health signals, incident response, and recovery procedures
- [D1 production migration](./operations/D1_PRODUCTION_MIGRATION.md): 2026-09-06 database cutover and rollback record
- [D1 canary shard bootstrap](./operations/D1_CANARY_SHARD_BOOTSTRAP.md): guarded empty-shard preparation and audit procedure
- [D1 canary projection reconciliation](./operations/D1_CANARY_PROJECTION_RECONCILIATION.md): secret-gated, read-only cross-database audit procedure

## History

- [Migration notes](./history/MIGRATION_NOTES.md): shipped changes, trade-offs, migrations, and deployment notes
- [Notification implementation log](./history/NOTIFICATION_IMPLEMENTATION_LOG.md): chronological Web Push implementation record
- [D1 partitioning implementation log](./history/D1_PARTITIONING_IMPLEMENTATION_LOG.md): channel database routing rollout and verification record

## Placement rules

- Put current product decisions and planned work in `product/`.
- Put durable system design, data-flow, and security references in `architecture/`.
- Put procedures that an operator follows during release or incidents in `operations/`.
- Put append-only implementation and migration records in `history/`.
- Keep `README.md`, `AGENTS.md`, and `CLAUDE.md` at the repository root because
  they are project and tooling entry points.
