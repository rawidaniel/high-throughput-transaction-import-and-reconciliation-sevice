# Transaction Import & Reconciliation Service

A high-throughput service for importing financial transactions from NDJSON
files. Handles files of 500,000+ records with bounded memory, CPU-isolated
risk scoring, resumable crash recovery, and effectively-once persistence.

**Live deployment:** _(add your URL)_ · **API docs:** _(your URL)_`/docs`

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env          # then edit DATABASE_URL

# 3. Start Postgres (or point DATABASE_URL at your own)
docker compose up -d postgres

# 4. Apply migrations
npm run db:deploy
npm run db:generate

# 5. Run both processes (separate terminals)
npm run start:dev             # API      → http://localhost:3000
npm run start:worker:dev      # worker   → metrics on :3001
```

Open **http://localhost:3000/docs** for the interactive API.

---

## Everything at Once (Docker)

```bash
docker compose up --build
```

Starts Postgres, the API, and the worker with migrations applied
automatically.

---

## Running the Project

### Development

| Command                    | What it does                         |
| -------------------------- | ------------------------------------ |
| `npm run start:dev`        | API with hot reload                  |
| `npm run start:worker:dev` | Worker with hot reload               |
| `npm run start:debug`      | API with the Node inspector attached |

### Production

```bash
npm run build
npm run start:prod            # API
npm run start:worker          # worker
```

**Both processes are required.** The API only accepts uploads and serves
reads; nothing is processed until a worker is running. You can run multiple
workers — they coordinate safely via database-level job leasing.

---

## Migrations

| Command               | When                                                      |
| --------------------- | --------------------------------------------------------- |
| `npm run db:migrate`  | Development — creates a new migration from schema changes |
| `npm run db:deploy`   | Production/CI — applies existing migrations, no prompts   |
| `npm run db:generate` | Regenerate the Prisma client after a schema change        |
| `npm run db:studio`   | Browse the database in a GUI                              |

Run `db:generate` after every `db:migrate`, or the client won't match the
schema.

---

## Generating Test Data

```bash
# 500,000 records (~150 MB)
npm run generate:data -- --records=500000

# Tune the mix of bad data
npm run generate:data -- --records=100000 --malformed=5 --duplicates=10
```

| Flag           | Default             | Meaning                                        |
| -------------- | ------------------- | ---------------------------------------------- |
| `--records`    | 100000              | How many lines to emit                         |
| `--malformed`  | 2                   | Percent that are deliberately invalid          |
| `--duplicates` | 3                   | Percent that repeat an earlier `transactionId` |
| `--out`        | `./data-<n>.ndjson` | Output path                                    |

Malformed records cycle through six distinct failure modes (broken JSON,
negative amount, invalid currency, unparseable timestamp, missing fields,
over-long description) so the rejection path is exercised realistically.

---

## Running Tests

```bash
npm test                  # unit — fast, no Docker, no database
npm run test:watch        # unit, watch mode
npm run test:cov          # unit with coverage
npm run test:integration  # integration — REQUIRES DOCKER
npm run test:all          # both
```

**Unit tests** use hand-written in-memory fakes. No database, no
filesystem, no HTTP framework — they run in about a second.

**Integration tests** spin up a real Postgres via Testcontainers and apply
your actual migrations, so they verify the constraints the application
depends on. Docker must be running.

> **Note:** the integration script passes `--experimental-vm-modules`,
> required because Prisma 7's WASM query compiler uses dynamic `import()`.

---

## Running Benchmarks

```bash
# 1. Generate a large file
npm run generate:data -- --records=500000

# 2. Start both processes
npm run start:dev
npm run start:worker:dev

# 3. Benchmark — load-tests the read API *while* the import processes
npm run benchmark -- --file=data-500000.ndjson
```

Captures duration, records/sec, peak RSS and heap, event-loop delay for both
processes, API latency percentiles, and machine specs. See
[BENCHMARK.md](./BENCHMARK.md).

### Verifying backpressure separately

```bash
# Throttle persistence so it's clearly the bottleneck
PERSIST_BATCH_SIZE=100 MAX_CONCURRENT_PERSISTS=1 npm run start:worker:dev

npm run verify:backpressure -- --records=200000
```

The meaningful test is **comparative**: run at 50,000 and again at 500,000
records. If backpressure works, peak memory stays in roughly the same
ballpark despite the 10× larger file. A single run proves little, since RSS
growth under load is also normal GC behaviour.

---

## Environment Variables

Copy `.env.example` to `.env`. Only `DATABASE_URL` is required.

### Core

| Variable             | Default             | Purpose                                  |
| -------------------- | ------------------- | ---------------------------------------- |
| `DATABASE_URL`       | —                   | **Required.** Postgres connection string |
| `PORT`               | `3000`              | API port                                 |
| `LOG_LEVEL`          | `info`              | `trace`/`debug`/`info`/`warn`/`error`    |
| `UPLOAD_STORAGE_DIR` | `./storage/uploads` | Where uploaded files are stored          |

### Upload & Security

| Variable                 | Default     | Purpose                              |
| ------------------------ | ----------- | ------------------------------------ |
| `MAX_UPLOAD_BYTES`       | `524288000` | 500 MB file-size ceiling             |
| `JSON_BODY_LIMIT_BYTES`  | `65536`     | 64 KB limit for non-multipart bodies |
| `REQUEST_TIMEOUT_MS`     | `300000`    | Slowloris defence                    |
| `RATE_LIMIT_MAX`         | `100`       | Requests per window per client       |
| `RATE_LIMIT_WINDOW`      | `1 minute`  | Rate-limit window                    |
| `MAX_CONCURRENT_UPLOADS` | `10`        | Simultaneous in-flight uploads       |

### Processing

| Variable                   | Default | Purpose                            |
| -------------------------- | ------- | ---------------------------------- |
| `PERSIST_BATCH_SIZE`       | `500`   | Records per database batch write   |
| `SCORING_BATCH_SIZE`       | `500`   | Records per worker-thread message  |
| `MAX_CONCURRENT_PERSISTS`  | `2`     | Concurrent batch writes per worker |
| `WORKER_POOL_SIZE`         | `4`     | Risk-scoring threads               |
| `RISK_SCORING_HASH_ROUNDS` | `600`   | Artificial CPU cost per record     |

### Jobs & Recovery

| Variable                   | Default  | Purpose                                          |
| -------------------------- | -------- | ------------------------------------------------ |
| `LEASE_DURATION_MS`        | `120000` | How long a claimed job stays owned               |
| `MAX_JOB_ATTEMPTS`         | `3`      | Attempts before a job is marked failed           |
| `RECLAIM_INTERVAL_MS`      | `30000`  | How often idle workers sweep for expired leases  |
| `SHUTDOWN_GRACE_MS`        | `15000`  | API shutdown deadline                            |
| `WORKER_SHUTDOWN_GRACE_MS` | `30000`  | Worker shutdown deadline                         |
| `SHUTDOWN_DRAIN_MS`        | `3000`   | Readiness-false pause before closing connections |

### Retry & Observability

| Variable                     | Default    | Purpose                                     |
| ---------------------------- | ---------- | ------------------------------------------- |
| `RETRY_MAX_ATTEMPTS`         | `4`        | Total attempts for a retryable DB operation |
| `RETRY_BASE_DELAY_MS`        | `200`      | Backoff base                                |
| `RETRY_MAX_DELAY_MS`         | `5000`     | Backoff ceiling                             |
| `WORKER_METRICS_PORT`        | `3001`     | Worker's Prometheus endpoint                |
| `METRICS_SAMPLE_INTERVAL_MS` | `5000`     | Runtime gauge sampling                      |
| `ORPHAN_SWEEP_INTERVAL_MS`   | `3600000`  | Orphaned-file cleanup interval              |
| `ORPHAN_FILE_AGE_MS`         | `86400000` | Age before a file is sweep-eligible         |

**For faster crash-recovery testing:**
`LEASE_DURATION_MS=15000 RECLAIM_INTERVAL_MS=5000`

---

## API Endpoints

| Method | Path                         | Purpose                                          |
| ------ | ---------------------------- | ------------------------------------------------ |
| `POST` | `/v1/imports`                | Upload a file (requires `Idempotency-Key`) → 202 |
| `GET`  | `/v1/imports/:id`            | Status and progress                              |
| `POST` | `/v1/imports/:id/cancel`     | Request cancellation → 202                       |
| `GET`  | `/v1/imports/:id/summary`    | Aggregated statistics                            |
| `GET`  | `/v1/imports/:id/rejections` | Rejected records, cursor-paginated               |
| `GET`  | `/health/live`               | Liveness (no I/O)                                |
| `GET`  | `/health/ready`              | Readiness (checks database)                      |
| `GET`  | `/metrics`                   | Prometheus exposition                            |
| `GET`  | `/docs`                      | Swagger UI                                       |

### Example

```bash
curl -X POST http://localhost:3000/v1/imports \
  -H "Idempotency-Key: my-unique-key-1" \
  -F "file=@sample-transactions.ndjson;type=application/x-ndjson"

curl http://localhost:3000/v1/imports/<id>
curl http://localhost:3000/v1/imports/<id>/summary
curl "http://localhost:3000/v1/imports/<id>/rejections?limit=20"
```

### Record format

```json
{
  "transactionId": "txn-1",
  "accountId": "acc-1",
  "merchantId": "m-1",
  "amount": 10.5,
  "currency": "USD",
  "timestamp": "2026-01-15T10:30:00Z",
  "description": "Coffee"
}
```

`description` is optional; everything else is required. `provider` may be
supplied per record, otherwise the import-level value is used.

---

## Known Limitations

Stated plainly rather than left for discovery.

### No authentication or authorization

The API is entirely unauthenticated. Anyone who can reach it can upload
files and read any import. **This is the single largest gap for real
deployment** and was out of scope for the exercise.

### Progress counters are at-least-once

If a worker crashes mid-file and another reprocesses it, the file restarts
from line 1. Already-persisted rows are correctly skipped by the unique
constraint, but `processedCount`, `rejectedCount`, and `duplicateCount` use
increments and are applied again — so they can overshoot `totalRecords`.

`acceptedCount` and `totalRecords` stay accurate (the former derives from
`RETURNING id`, the latter is written absolutely). Fixing the rest needs
resumable byte offsets or deriving counters at completion.

### No resumable offsets

A reclaimed job restarts the whole file. Safe, thanks to the unique
constraint, but wasteful on large files — and the cause of the counter issue
above.

### Cancellation granularity

Checked every 500 lines, so a cancel request takes effect within roughly
that many records rather than instantly.

### Rate limiting is per-instance

In-memory, so multiple API replicas each enforce their own budget. A shared
Redis store would be needed for a true global limit.

### Compressed uploads rejected outright

A gzip bomb can expand catastrophically, and handling that safely needs an
expansion-ratio ceiling plus an absolute output cap. Since nothing requires
compressed uploads, they're rejected — a smaller, more verifiable control
than a partially-correct defence.

### Summary aggregation cost scales with import size

`GET /:id/summary` runs `GROUP BY` queries on demand. Fine at current
volumes; a pre-aggregated summary table is the documented scale-up path.

### Reclaim cannot distinguish slow from dead

A crashed worker's job is only reclaimable after its lease expires, because
"slow worker" and "dead worker" are indistinguishable from the database's
perspective. Recovery therefore takes up to `LEASE_DURATION_MS`.

### Risk-scoring weights are illustrative

Plausible heuristics, not values fitted against labelled fraud data.

### Deployment upload ceiling

The hosted instance may accept smaller uploads than 500 MB due to platform
body limits. Self-hosted deployments handle the full size.

---

## Further Reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — components, boundaries, strategies
- [BENCHMARK.md](./BENCHMARK.md) — performance results and interpretation
- [SUBMISSION.md](./SUBMISSION.md) — summary, decisions, known gaps
- [docs/adr/](./docs/adr/) — architecture decision records
