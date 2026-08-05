# Submission

## Summary

A transaction import service that ingests NDJSON files of 500,000+ records
without loading them into memory, isolates CPU-heavy risk scoring from the
event loop, survives worker crashes without duplicating data, and reports
live progress throughout.

The core design commitment is that **PostgreSQL enforces correctness**.
Duplicate detection, request idempotency, and job coordination are all
database constraints rather than application logic — so they hold under
concurrency, across restarts, and across multiple workers, none of which an
in-memory approach could claim.

**Deployment:** `___` · **API docs:** `___`/docs

---

## Architecture Overview

Two processes, one database, no message broker.

```
Client ──POST──► API ──stream──► Disk
                 │
                 └──BEGIN: import + key + file + job──► Postgres ◄──claim (SKIP LOCKED)── Worker
                                                            ▲                                │
                                                            │                          read stream
                                                            │                                │
                                                            │                     parse → validate
                                                            │                       → fingerprint
                                                            │                                │
                                                            │                    worker_threads pool
                                                            │                       (risk scoring)
                                                            │                                │
                                                            └──BEGIN: rows + rejections ──────┘
                                                                    + counters
```

The **API** streams uploads to disk, queues a job, returns 202, and serves
reads. It never parses file contents.

The **worker** claims jobs via a time-bounded lease, streams the file line
by line, and persists in batches. Scoring runs on a thread pool so the
worker's own event loop stays responsive enough to keep renewing that lease
and honouring cancellation.

**Layering:** `domain/` (pure rules) ← `application/` (use cases + port
interfaces) ← `infrastructure/` (Prisma, disk, threads) with `modules/` as
the single wiring point. Dependencies point inward; `infrastructure/`
implements interfaces owned by `application/`.

Full detail in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Important Decisions

Five ADRs in [`docs/adr/`](./docs/adr/); the headlines:

**Postgres as the job queue, not Redis.** Job state and business data share
a transaction boundary, so "job marked complete but rows not written" cannot
occur. `SELECT ... FOR UPDATE SKIP LOCKED` gives safe multi-worker claiming,
and lease expiry gives crash recovery without a separate janitor process.
Costs up to 2s of dispatch latency, which is irrelevant for minute-long
imports.

**Unique constraints for idempotency and duplicates.** `UNIQUE (provider,
transactionId)` and `UNIQUE (idempotency_keys.key)` — attempt the write,
handle the conflict. Never check-then-act, which races. Verified by an
integration test firing 20 concurrent identical requests and asserting
exactly one import exists.

**One transaction per batch, covering rows _and_ counters.** Makes the
dual-write failure — "batch succeeded, progress update failed" —
structurally impossible rather than something to reconcile afterward.

**Worker threads for scoring, batched at 500.** Not because the API needs
protecting (separate processes already handle that) but because the
_worker's_ loop must keep serving heartbeats and cancellation checks while
CPU work runs.

**Ports and adapters throughout.** Twelve injected dependencies, all
interfaces. The payoff is concrete: use cases are unit-tested by calling
`new` with hand-written fakes — no container, no database, no filesystem.

---

## Trade-offs

| Chose                              | Over                         | Why                                                          | Cost                                         |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| DB polling                         | Redis pub/sub                | One datastore, transactional consistency                     | ≤2s dispatch latency                         |
| First-write-wins                   | Last-write-wins              | Re-imports are non-destructive and order-independent         | Genuine upstream corrections are rejected    |
| Restart from line 1                | Resumable offsets            | Unique constraint already makes it safe; far less complexity | Wasted work after a crash; counter overshoot |
| Counting pre-pass                  | Estimate from file size      | Exact progress denominator from batch one                    | One extra full read of the file              |
| Reject compressed uploads          | Decompress with ratio limits | Small, verifiable control                                    | No gzip support                              |
| On-demand summary aggregation      | Pre-aggregated table         | Always consistent, no write-path complexity                  | Cost scales with import size                 |
| Cancellation checked per 500 lines | Per line                     | Avoids a DB round-trip per record                            | Up to ~500 records of latency                |
| Hand-rolled thread pool            | Piscina                      | ~120 lines, no dependency, explicit behaviour                | Maintained ourselves                         |
| Reject over-long descriptions      | Silently truncate            | Failure is visible in `rejected_records`                     | Stricter than some clients expect            |

---

## Benchmark Summary

> **Replace once the benchmark has been run** — see
> [BENCHMARK.md](./BENCHMARK.md).

| Metric                    | Result            |
| ------------------------- | ----------------- |
| Records                   | 500,000           |
| Processing time           | `___` s           |
| Throughput                | `___` records/sec |
| Peak worker RSS           | `___` MB          |
| API p99 during processing | `___` ms          |
| Worker event-loop p99     | `___` ms          |
| Bottleneck identified     | `___`             |

The measurement that matters most is **memory flatness across file sizes**
(50k vs 500k records). Backpressure is only demonstrated by peak RSS staying
in the same ballpark despite a 10× larger input — a single run's absolute
number proves nothing.

---

## Known Risks

**No authentication.** The API is entirely open. Anyone reaching it can
upload files and read every import. This is the largest gap for real use and
was out of scope for the exercise.

**Prisma 7 driver adapter friction.** `@prisma/adapter-pg` is new and
behaves unusually in two ways that cost real debugging time: SQLSTATE codes
arrive nested under `.cause.originalCode` instead of `meta.target`, and its
WASM query compiler needs `--experimental-vm-modules` under Jest. Both are
handled, but both are version-sensitive and could break on upgrade.

**Hand-added partial index.** The `processing_jobs` polling index is a
partial index that Prisma's schema DSL can't express, so it's edited into
the migration by hand. A schema reset would silently lose it — the query
still works, just slower as completed jobs accumulate.

**Recovery latency is bounded by the lease.** A crashed worker's job waits
out `LEASE_DURATION_MS` before reclaim, because "dead worker" and "slow
worker" are indistinguishable from the database's view. Shortening the lease
speeds recovery but risks stealing jobs from healthy-but-slow workers.

**Single-instance rate limiting.** In-memory, so N replicas allow N× the
intended rate.

**Local disk storage.** Uploads go to the local filesystem, so the API is
not horizontally scalable as-is — a second instance couldn't read the
first's files. Object storage is the obvious fix; `FileStoragePort` already
abstracts it.

**Risk weights are illustrative.** Plausible heuristics, not fitted against
labelled data. Presented as such rather than as a tuned model.

---

## What I Would Improve With More Time

**1 · Authentication and authorization.** API keys or JWT, with imports
scoped to their owner. The clearest missing piece.

**2 · Resumable offsets.** Persist the committed byte offset per batch and
resume there. Fixes both the wasted reprocessing and the counter overshoot —
the single highest-value change on this list.

**3 · Object storage.** Swapping `DiskFileStorage` for S3 makes the API
horizontally scalable. The port already exists; only the adapter and
deployment config change.

**4 · Wire up `CONTENT_MISMATCH`.** `findFingerprints()` and
`classifyDuplicate()` are implemented and tested, but nothing calls them —
so all conflicts currently record as plain duplicates. Roughly an hour of
work to connect.

**5 · Register `EventLoopMonitor` comparison in the worker.** The
infrastructure exists; what's missing is the A/B run against inline scoring
that would _prove_ the thread pool's value rather than assert it.

**6 · Periodic reclaim independent of idle polling.** Reclaim currently runs
at startup and during idle polls. A busy worker never idles, so on a
single-worker deployment a crashed job could wait longer than intended.

**7 · Dead-letter queue.** Jobs exceeding `MAX_JOB_ATTEMPTS` are marked
`FAILED` and left. A DLQ with replay would make operational recovery less
manual.

**8 · Distributed tracing.** Request IDs exist and propagate through logs,
but there's no OpenTelemetry span linking an upload to its worker
processing.

---

## Incomplete Requirements — Stated Explicitly

Gaps listed deliberately rather than left to be discovered.

| Item                                  | Status                    | Detail                                                                                                                       |
| ------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `CONTENT_MISMATCH` classification     | **Built but not wired**   | Domain logic and repository method exist with tests; nothing invokes them                                                    |
| Progress counter accuracy after crash | **Partial**               | `acceptedCount` and `totalRecords` are exact; `processedCount`, `rejectedCount`, `duplicateCount` can overshoot on reprocess |
| Thread-pool isolation proof           | **Not measured**          | Infrastructure and procedure documented; the A/B comparison hasn't been run                                                  |
| Benchmark numbers                     | **Not yet run**           | BENCHMARK.md is a template with placeholders — no invented figures                                                           |
| Authentication                        | **Not implemented**       | Out of scope, but the largest real-world gap                                                                                 |
| HTTP e2e tests                        | **Not written**           | Controllers are thin translation layers, covered indirectly by use-case unit tests                                           |
| Worker-thread integration tests       | **Not written**           | Spawning real threads in Jest is slow and flaky; covered by unit tests with a synchronous fake                               |
| CI pipeline                           | **Not configured**        | Integration tests need Docker, so a runner providing it is required                                                          |
| Compressed upload support             | **Deliberately excluded** | Rejected outright rather than partially defended against bombs                                                               |
| Multi-file imports                    | **Not supported**         | Schema permits it (`import_files` is one-to-many); no code path uses it                                                      |
| Horizontal API scaling                | **Blocked by local disk** | Workers scale fine; API instances can't share uploaded files                                                                 |

---

## Verifying the Core Claims

Each headline claim, with the command that demonstrates it.

**Effectively-once persistence:**

```sql
SELECT COUNT(*), COUNT(DISTINCT (provider, "transactionId")) FROM transactions;
-- equal, even after a crash and full reprocess
```

**Concurrent idempotency:**

```bash
npm run test:integration -- -t "creates exactly ONE import"
```

**Crash recovery:**

```bash
LEASE_DURATION_MS=15000 npm run start:worker:dev
# upload a large file, then: kill -9 $(pgrep -f worker.main)
# restart; after the lease lapses the job is reclaimed and completes
```

**Bounded memory:**

```bash
npm run verify:backpressure -- --records=50000
npm run verify:backpressure -- --records=500000
# peak RSS should stay in the same ballpark
```

**API responsiveness under load:**

```bash
npm run benchmark -- --file=data-500000.ndjson
```

---

## Repository Guide

| Path                         | Contains                                           |
| ---------------------------- | -------------------------------------------------- |
| `src/domain/`                | Pure business rules — no framework, no I/O         |
| `src/application/ports/`     | Interfaces and DI tokens                           |
| `src/application/use-cases/` | Business workflows                                 |
| `src/infrastructure/`        | Prisma, disk, threads, Pino, prom-client           |
| `src/http/`                  | Controllers, DTOs, exception filter                |
| `src/worker/`                | Job poller, metrics server, orphan sweeper         |
| `src/modules/`               | The only place tokens bind to implementations      |
| `test/unit/`                 | ~140 tests, no database or Docker                  |
| `test/integration/`          | ~25 tests against real Postgres via Testcontainers |
| `scripts/`                   | Data generator, benchmark, backpressure verifier   |
| `docs/adr/`                  | Five architecture decision records                 |
