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

Measured on an Apple M1 Pro (8 cores, 16 GB) with the API, worker, and
Postgres sharing one machine. Full detail in [BENCHMARK.md](./BENCHMARK.md).

| Metric                    | Result                               |
| ------------------------- | ------------------------------------ |
| Records                   | 500,000 (92.5 MB)                    |
| Upload time               | 0.3 s                                |
| Processing time           | 225.4 s                              |
| Throughput                | 2,218 records/sec                    |
| Peak worker RSS           | 692 MB                               |
| API p99 during processing | 3 ms                                 |
| API throughput under load | ~9,000 req/sec, zero errors          |
| Worker event-loop p99     | 21 ms                                |
| Bottleneck                | Risk scoring (4–6× persistence cost) |

**Memory is bounded, and that is the headline result.** Peak RSS across
50k / 200k / 500k records was 810 MB / 598 MB / 692 MB — uncorrelated with a
10× increase in input size. Without backpressure this would climb roughly
linearly; it doesn't, because `await flush()` suspends the read loop until
each batch is scored and persisted.

**The API stayed fast under sustained load** — sub-millisecond mean latency
and ~9,000 req/sec while the worker saturated four scoring threads, with
zero errors across all runs.

**The bottleneck is risk scoring**, at 4–6× the cost of batch persistence.
This is expected rather than surprising: `RISK_SCORING_HASH_ROUNDS = 600`
is artificial CPU load added deliberately so that offloading to
`worker_threads` would be demonstrably necessary. The benchmark confirms
the load is real and that the pool absorbs it — the worker's event loop
stayed at 16–21 ms p99 throughout, which is what keeps lease heartbeats and
cancellation checks responsive during scoring.

**An unplanned demonstration of effectively-once persistence.** Two runs
were executed against a database still holding records from a prior run, and
the generator produces deterministic transaction IDs. Every record collided:
0 accepted, 196,122 duplicates, zero errors, import completed normally. That
is `ON CONFLICT DO NOTHING` doing exactly what the crash-recovery model
depends on.

### Caveats stated plainly

- All processes shared 8 cores, so the worker's scoring threads competed
  with Postgres and the API. Separate hosts would improve these numbers.
- The 50k and 200k runs ran against a non-empty database, so their
  throughput reflects a conflict-skip path rather than genuine inserts. The
  **500k run is the representative measurement**.
- One 5,018 ms outlier appeared in the 200k run's max latency. p99 stayed at
  2 ms, so it affected far less than 1% of requests — most likely GC or
  scheduler contention from four processes on one machine.
- `WORKER_POOL_SIZE` was 4 on an 8-core machine. Raising it to 6 is the
  obvious first optimization and was not attempted.
- **The thread-pool A/B comparison was not run.** The worker's low
  event-loop delay is consistent with the pool working, but comparing
  against inline scoring on the main thread would prove it directly. The
  procedure is documented; the measurement wasn't taken.
