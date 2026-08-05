# ADR 0001 — Job Execution Model: Database Polling over Redis

**Status:** Accepted

## Context

Uploads must be processed asynchronously — the API returns 202 and a
background worker does the work. That needs a queue with: durability across
restarts, safe claiming by multiple workers, crash recovery when a worker
dies mid-job, and visibility into queue depth.

## Decision

Use a `processing_jobs` table in PostgreSQL as the queue. Workers claim
rows with `SELECT ... FOR UPDATE SKIP LOCKED` and hold a time-bounded
lease (`leasedBy`, `leasedUntil`) renewed by heartbeat.

No Redis, no RabbitMQ, no BullMQ.

## Consequences

**Positive**

- **One source of truth.** Job state and business data share a transaction
  boundary, so "job marked complete but data not written" cannot happen.
- **Crash recovery is free.** A dead worker stops renewing its lease; the
  lease expires; any worker reclaims it. No separate janitor process, no
  liveness detection.
- **`FOR UPDATE SKIP LOCKED` is exactly the right primitive.** Concurrent
  workers get different rows without blocking each other.
- **One fewer service** to deploy, monitor, secure, and back up.
- **Queue state is queryable** with plain SQL — invaluable when debugging
  a stuck import.

**Negative**

- **Polling has latency.** A job waits up to `POLL_INTERVAL_MS` (2s). Redis
  pub/sub would be near-instant. Acceptable for imports measured in minutes.
- **Polling costs queries** even when idle — one lightweight indexed query
  per worker per 2s.
- **Won't scale to very high job rates.** At thousands of jobs/second, the
  polling query becomes contention. We're at single-digit jobs/minute.
- **A partial index is required** (`WHERE status IN ('PENDING','CLAIMED')`)
  and isn't expressible in Prisma's schema DSL — it's hand-added to the
  migration, which is easy to lose on a schema reset.

## Alternatives Considered

**Redis + BullMQ** — mature, near-instant dispatch, good tooling. Rejected:
job state would live outside the transaction that writes business data, so
crash-consistency between them becomes a distributed-systems problem rather
than a `COMMIT`. Plus a second stateful service to operate.

**In-memory queue** — simplest, but loses everything on restart and can't
coordinate multiple workers. Disqualified by the recovery requirement.

**`LISTEN`/`NOTIFY`** — would remove polling latency while keeping one
datastore. Rejected as an unnecessary complication for this job rate; worth
revisiting if dispatch latency becomes a real complaint. Note that
notifications are not durable, so polling would still be needed as a
fallback.
