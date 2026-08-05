# Benchmark Results

> **⚠ PLACEHOLDER — RUN THE BENCHMARK AND REPLACE THE `___` VALUES.**
>
> ```bash
> npm run generate:data -- --records=500000
> npm run start:dev            # terminal 1
> npm run start:worker:dev     # terminal 2
> npm run benchmark -- --file=data-500000.ndjson
> ```
>
> The script prints every figure below. Paste the real numbers, then rewrite
> the **Interpretation** section to match what you actually observed —
> the analysis there is scaffolding, not a prediction.

---

## What Was Measured

Two things simultaneously, because measuring them separately would prove
nothing:

1. **Import throughput** — how fast the worker processes a large file
   end-to-end.
2. **API responsiveness under that load** — whether read endpoints stay fast
   _while_ the worker is saturated.

Testing API latency on an idle system would be meaningless. The load
generator runs concurrently with the import for exactly this reason.

## How It Was Measured

| Aspect           | Method                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| Throughput       | Wall clock from job claim to terminal status; `processedCount ÷ seconds`               |
| Memory           | `process.memoryUsage()` scraped from `/metrics` every 1s, peak retained                |
| Event-loop delay | `perf_hooks.monitorEventLoopDelay()`, p99 per 5s window, sampled in **both** processes |
| API latency      | `autocannon`, 10 connections, 30s, against `GET /v1/imports/:id` **during** processing |
| Data             | Generated with 2% malformed and 3% duplicate records — not a clean-data best case      |

---

## Machine

|            |                                 |
| ---------- | ------------------------------- |
| CPU        | `___`                           |
| Cores      | `___`                           |
| Memory     | `___`                           |
| OS         | `___`                           |
| Node       | `___`                           |
| Postgres   | `___`                           |
| Deployment | `___` (local / Docker / hosted) |

> **Note:** if the API, worker, and Postgres share one machine, they compete
> for the same cores. Say so — it materially affects the numbers.

## Configuration

| Setting                    | Value               |
| -------------------------- | ------------------- |
| `PERSIST_BATCH_SIZE`       | `___` (default 500) |
| `SCORING_BATCH_SIZE`       | `___` (default 500) |
| `WORKER_POOL_SIZE`         | `___` (default 4)   |
| `MAX_CONCURRENT_PERSISTS`  | `___` (default 2)   |
| `RISK_SCORING_HASH_ROUNDS` | `___` (default 600) |
| Workers running            | `___`               |

---

## Results

### Throughput

| Metric          | Value     |
| --------------- | --------- |
| File size       | `___` MB  |
| Records         | 500,000   |
| Upload time     | `___` s   |
| Processing time | `___` s   |
| **Records/sec** | **`___`** |
| Accepted        | `___`     |
| Rejected        | `___`     |
| Duplicates      | `___`     |

### Worker resources

| Metric              | Value    |
| ------------------- | -------- |
| Peak RSS            | `___` MB |
| Peak heap used      | `___` MB |
| Peak event-loop p99 | `___` ms |
| Peak event-loop max | `___` ms |

### API under load

| Metric                    | Value    |
| ------------------------- | -------- |
| Requests/sec              | `___`    |
| Latency mean              | `___` ms |
| Latency p50               | `___` ms |
| Latency p99               | `___` ms |
| Latency max               | `___` ms |
| Errors / non-2xx          | `___`    |
| Peak event-loop p99 (API) | `___` ms |

### Memory scaling — the backpressure proof

A single run proves little; growth under load is also normal GC behaviour.
The meaningful test is whether peak memory **stays flat as file size grows**.

| Records | File size | Peak RSS |
| ------- | --------- | -------- |
| 50,000  | `___` MB  | `___` MB |
| 200,000 | `___` MB  | `___` MB |
| 500,000 | `___` MB  | `___` MB |

> If peak RSS is roughly constant across a 10× size increase, backpressure
> is working. If it scales with file size, batches are accumulating rather
> than being awaited.

---

## Interpretation

### Was the bottleneck DB writes, CPU scoring, or stream parsing?

Determine this from the histograms rather than guessing:

```bash
curl -s localhost:3001/metrics | grep -E 'batch_persist_duration|scoring_batch_duration'
curl -s localhost:3001/metrics | grep -E 'backpressure_waits_total|persist_queue_depth'
```

| Evidence                                                                                                  | Bottleneck                            | Next move                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `batch_persist_duration` p99 ≫ `scoring_batch_duration` p99, `backpressure_waits_total` climbing steadily | **Database writes**                   | Raise `PERSIST_BATCH_SIZE` and `MAX_CONCURRENT_PERSISTS`; check pool size and index overhead on `transactions` |
| `scoring_batch_duration` dominates, worker CPU pinned near 100%                                           | **CPU scoring**                       | Raise `WORKER_POOL_SIZE` toward core count; lower `RISK_SCORING_HASH_ROUNDS` (the cost is artificial)          |
| Both histograms low, throughput still modest, worker loop p99 low                                         | **Stream parsing / I/O**              | Larger read buffer; check disk throughput; consider a faster JSON parser                                       |
| `persist_queue_depth` consistently 0                                                                      | Persistence is **not** the constraint | Look upstream                                                                                                  |

**Observed bottleneck:** `___`

**Evidence:** `___`

### Did it meet expectations?

State the expectation, then whether it held.

| Expectation                                            | Met?  | Notes                       |
| ------------------------------------------------------ | ----- | --------------------------- |
| Memory stays bounded regardless of file size           | `___` |                             |
| API p99 stays under ~100 ms during processing          | `___` |                             |
| Zero duplicate rows despite duplicates in the input    | `___` | Verify with the query below |
| Malformed records rejected without aborting the import | `___` |                             |
| Throughput ≥ `___` records/sec                         | `___` |                             |

Verify effectively-once persistence directly:

```sql
SELECT COUNT(*), COUNT(DISTINCT (provider, "transactionId"))
FROM transactions WHERE "importId" = '<id>';
-- these must be EQUAL
```

### On the API latency figure

Worth being precise about what it does and doesn't prove.

The API and worker are **separate processes**, so low API latency during
processing is substantially just process isolation — it would hold with or
without a worker-thread pool. It confirms the process split works; it does
not by itself validate the threading strategy.

The figure that demonstrates the **thread pool** specifically is the
**worker's** event-loop p99. To show its value properly, compare:

```bash
# With the pool (default)
WORKER_POOL_SIZE=4 npm run start:worker:dev

# Against inline scoring on the main thread
# (temporarily bypass the pool in the flush path)
```

Without the pool, the worker's loop p99 should climb sharply, and lease
heartbeats and cancellation checks would begin to stall.

**Comparison result:** `___`

---

## What I Would Optimize Next

Ordered by expected return, to be re-ranked once the real bottleneck is
known.

1. **Tune whichever stage the histograms identify.** Batch size and pool
   size are env vars specifically so this is measurable rather than
   guesswork. Sweep `PERSIST_BATCH_SIZE` across 250/500/1000/2000 and plot
   throughput.

2. **Resumable offsets.** A reclaimed job currently restarts from line 1.
   On a 500k file that's minutes of redundant work after a crash — and it's
   the root cause of the counter-overshoot issue. The highest-value
   correctness _and_ performance fix.

3. **Drop the counting pre-pass, or make it optional.** It's a full extra
   read before any useful work. If it's a meaningful share of total time,
   estimating from file size (renamed to `estimatedTotalRecords`) would
   trade exactness for a faster start.

4. **`COPY` instead of multi-row `INSERT`.** If DB writes dominate,
   Postgres's `COPY` is substantially faster for bulk loads. It doesn't
   support `ON CONFLICT`, so it would need a staging table plus a merge —
   more complexity, but potentially a large win.

5. **Multiple workers.** Untested at scale here. Job leasing already
   supports it; the open question is whether `SKIP LOCKED` contention or
   connection-pool limits bite first.

6. **Pre-aggregated summary table.** `GET /:id/summary` runs `GROUP BY` on
   demand, so its cost scales with import size. Maintaining counts
   incrementally in the same transaction as each batch — the trick already
   used for progress counters — makes it O(1).

7. **Adaptive pool sizing.** `WORKER_POOL_SIZE` is fixed. Sizing from
   `os.cpus().length` with headroom for the main loop would be a small
   change with a real benefit on varied hardware.

---

## Reproducing

```bash
npm run generate:data -- --records=500000
npm run start:dev
npm run start:worker:dev
npm run benchmark -- --file=data-500000.ndjson

# Backpressure specifically, with persistence throttled:
PERSIST_BATCH_SIZE=100 MAX_CONCURRENT_PERSISTS=1 npm run start:worker:dev
npm run verify:backpressure -- --records=200000
```
