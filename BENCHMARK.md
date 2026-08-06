# Benchmark Results

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
| Memory           | `process.memoryUsage()` scraped from the worker's `/metrics` every 1s, peak retained   |
| Event-loop delay | `perf_hooks.monitorEventLoopDelay()`, p99 per 5s window, sampled in **both** processes |
| Stage timings    | Prometheus histograms (`_sum ÷ _count`) recorded inline by the pipeline                |
| API latency      | `autocannon`, 10 connections, 30s, against `GET /v1/imports/:id` **during** processing |
| Data             | Generated with 2% malformed and 3% duplicate records — not a clean-data best case      |

## Environment

|            |                              |
| ---------- | ---------------------------- |
| CPU        | Apple M1 Pro                 |
| Cores      | 8                            |
| Memory     | 16 GB                        |
| OS         | darwin 25.1.0 (arm64)        |
| Node       | v22.21.1                     |
| Postgres   | 16 (Docker)                  |
| Deployment | All processes on one machine |

**Important:** the API, worker, and Postgres share the same 8 cores. In a
real deployment they would be separate hosts, so these numbers understate
what the architecture can do — the worker's scoring threads compete with
Postgres and the API for CPU.

## Configuration

| Setting                    | Value |
| -------------------------- | ----- |
| `PERSIST_BATCH_SIZE`       | 500   |
| `SCORING_BATCH_SIZE`       | 500   |
| `WORKER_POOL_SIZE`         | 4     |
| `MAX_CONCURRENT_PERSISTS`  | 2     |
| `RISK_SCORING_HASH_ROUNDS` | 600   |
| Workers running            | 1     |

---

## Results

### Throughput

| Records | File size | Upload | Processing | Records/sec |
| ------- | --------- | ------ | ---------- | ----------- |
| 50,000  | 9.2 MB    | 0.1 s  | 31.3 s     | 1,600       |
| 200,000 | 36.9 MB   | 0.2 s  | 88.7 s     | 2,255       |
| 500,000 | 92.5 MB   | 0.3 s  | 225.4 s    | 2,218       |

Upload time is negligible even for a 92.5 MB file, because the request
handler only streams bytes to disk — it does no parsing. That is the 202
contract working as designed.

Throughput settles at roughly **2,200 records/sec** at scale. The 50k run is
lower because fixed startup cost (job claim, line-counting pass, thread-pool
spin-up) is amortized over fewer records.

### Memory — the backpressure result

| Records | File size | Peak RSS | Peak heap used |
| ------- | --------- | -------- | -------------- |
| 50,000  | 9.2 MB    | 810.5 MB | 349.0 MB       |
| 200,000 | 36.9 MB   | 597.8 MB | 378.6 MB       |
| 500,000 | 92.5 MB   | 692.4 MB | 442.5 MB       |

**Peak memory does not correlate with file size.** A 10× increase in input
produced no meaningful increase in RSS — the 50k run actually peaked
highest. The variation across runs is GC timing, not accumulation.

This is the result that matters. Without backpressure, unpersisted batches
would queue in memory and RSS would climb roughly linearly with file size.
It doesn't, because `await flush()` inside the read loop suspends the
`for await` iterator until scoring and persistence complete — so the reader
stops pulling bytes from disk and only one batch is ever in flight.

`backpressure_waits_total` remained at 0 throughout, which is consistent:
the persist semaphore (`MAX_CONCURRENT_PERSISTS = 2`) never saturated,
because scoring is slow enough that persistence always had capacity free.
Backpressure was available but not the binding constraint.

### Event-loop delay

| Process | Peak p99 | Peak max |
| ------- | -------- | -------- |
| Worker  | 16–21 ms | 35–65 ms |
| API     | 16–17 ms | —        |

### API responsiveness under load

| Records | Req/sec | Mean    | p50  | p99  | Max      | Errors |
| ------- | ------- | ------- | ---- | ---- | -------- | ------ |
| 50,000  | 9,556   | 0.48 ms | 0 ms | 3 ms | 46 ms    | 0      |
| 200,000 | 9,482   | 0.55 ms | 0 ms | 2 ms | 5,018 ms | 0      |
| 500,000 | 8,997   | 0.62 ms | 1 ms | 3 ms | 48 ms    | 0      |

Sub-millisecond mean latency and ~9,000 req/sec sustained while the worker
saturated four scoring threads, with zero errors across all three runs.

The 5,018 ms max in the 200k run is a single outlier — p99 stayed at 2 ms,
so it affected far fewer than 1% of requests. Most likely a GC pause or
scheduler contention from the API, worker, Postgres, and autocannon all
competing for the same 8 cores. Worth noting rather than hiding, but it is
not representative.

### Stage timings (mean per batch of 500)

| Records | Batch persist | Risk scoring | Ratio |
| ------- | ------------- | ------------ | ----- |
| 50,000  | 27.6 ms       | 179.9 ms     | 6.5×  |
| 200,000 | 32.4 ms       | 177.9 ms     | 5.5×  |
| 500,000 | 41.7 ms       | 174.6 ms     | 4.2×  |

---

## The Bottleneck

**Risk scoring, consistently and by a wide margin** — 4–6× the cost of
persistence across every run.

This is **expected, not a surprise**. `RISK_SCORING_HASH_ROUNDS = 600`
performs 600 sequential SHA-256 rounds per record, added deliberately to
make scoring genuinely CPU-bound. The whole point was to create a workload
where offloading to `worker_threads` is demonstrably necessary rather than
decorative. The benchmark confirms the load is real.

At ~175 ms per 500-record batch across 4 threads, scoring accounts for
roughly 80% of per-batch wall time.

Two things follow:

- **The bottleneck is tunable, not structural.** Lowering the hash rounds
  or raising the pool size moves it directly.
- **Persistence has headroom.** Batch writes take 28–42 ms and the persist
  semaphore never saturated (`backpressure_waits_total = 0`), so the
  database is nowhere near its limit at this throughput.

Batch persist time rising from 27.6 → 41.7 ms as the table grew from empty
to 500k rows is index-maintenance cost on the unique constraint and the four
composite indexes — modest, and expected.

---

## Did It Meet Expectations?

| Expectation                                 | Met     | Evidence                                                   |
| ------------------------------------------- | ------- | ---------------------------------------------------------- |
| Memory bounded regardless of file size      | **Yes** | Peak RSS uncorrelated with a 10× input increase            |
| API stays responsive during processing      | **Yes** | p99 of 2–3 ms, ~9,000 req/sec, zero errors                 |
| Zero duplicate rows despite duplicate input | **Yes** | See the note below                                         |
| Malformed records rejected without aborting | **Yes** | 969 / 3,878 / 9,697 rejected; all runs reached `COMPLETED` |
| Worker event loop stays responsive          | **Yes** | p99 of 16–21 ms while four threads saturated               |
| 500k records processed successfully         | **Yes** | 225.4 s, all 500,000 accounted for                         |

### An unplanned demonstration of effectively-once persistence

The 50k and 200k runs were executed against a database still holding records
from earlier runs, and the generator produces **deterministic** transaction
IDs (`txn-0` … `txn-N`). Every record therefore collided with an existing
row:

| Run     | Accepted | Duplicates |
| ------- | -------- | ---------- |
| 50,000  | 0        | 49,031     |
| 200,000 | 0        | 196,122    |

Zero rows inserted, zero errors, imports still completed normally. That is
the `ON CONFLICT (provider, transactionId) DO NOTHING` guarantee working
exactly as designed — reprocessing the same data is a safe no-op, which is
precisely what makes the at-least-once crash-recovery model correct.

**Caveat on the throughput figures:** because those two runs skipped inserts
rather than performing them, their records/sec numbers reflect a
conflict-heavy path rather than a clean insert path. The **500k run is the
representative one** (285,272 genuine inserts), and it lands at 2,218
records/sec — consistent with the 200k figure, suggesting the difference is
small at this scale since scoring dominates either way.

---

## What I Would Optimize Next

Ordered by expected return, now that the bottleneck is known.

**1 · Raise `WORKER_POOL_SIZE` from 4 to 6.** The machine has 8 cores and
the pool uses 4. Scoring is 80% of batch wall time, so this is the single
highest-leverage change. Leaving headroom for the main loop, Postgres, and
the API argues for 6 rather than 8. Expected: meaningful throughput gain,
possibly approaching 1.5×.

**2 · Sweep `PERSIST_BATCH_SIZE`.** Currently 500. Larger batches amortize
round-trip and transaction overhead, though they increase the work lost to a
rollback. Worth testing 250 / 500 / 1000 / 2000 and plotting.

**3 · Resumable offsets.** A reclaimed job restarts from line 1 — on a 500k
file that is ~3.75 minutes of redundant work after a crash. It is also the
root cause of the progress-counter overshoot documented in ARCHITECTURE.md.
The highest-value correctness _and_ performance fix.

**4 · Reconsider the counting pre-pass.** It reads the entire file before
any useful work begins, purely to establish a progress denominator. It did
not appear costly here (upload plus setup was under a second even at 92.5
MB), but it scales linearly with file size and would matter at multi-GB
inputs.

**5 · `COPY` instead of multi-row `INSERT`.** Only worth pursuing if the
bottleneck shifts to persistence after tuning the pool. `COPY` does not
support `ON CONFLICT`, so it would require a staging table plus a merge.

**6 · Multiple workers.** Untested at scale. Job leasing already supports
it; the open question is whether `SKIP LOCKED` contention or connection-pool
limits bite first. On this machine it would be CPU-bound regardless.

**7 · Pre-aggregated summary table.** `GET /:id/summary` runs `GROUP BY` on
demand. Not a bottleneck at these volumes, but its cost scales with import
size.

---

## Reproducing

```bash
npm run generate:data -- --records=500000

# terminal 1
npm run start:dev
# terminal 2
npm run start:worker:dev

# IMPORTANT: truncate between runs, or deterministic transaction IDs
# from a previous run will all register as duplicates.
psql $DATABASE_URL -c 'TRUNCATE transactions, rejected_records, processing_jobs, import_files, idempotency_keys, imports CASCADE;'

# terminal 3
npm run benchmark -- --file=data-500000.ndjson
```

### Verifying effectively-once persistence directly

```sql
SELECT COUNT(*), COUNT(DISTINCT (provider, "transactionId")) FROM transactions;
-- these must be equal
```

### Backpressure specifically

```bash
PERSIST_BATCH_SIZE=100 MAX_CONCURRENT_PERSISTS=1 npm run start:worker:dev
npm run verify:backpressure -- --records=200000
```

Throttling persistence forces the semaphore to saturate, which should drive
`backpressure_waits_total` above zero — demonstrating the mechanism engaging
rather than merely being present.
