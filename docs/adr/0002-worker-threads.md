# ADR 0002 — Worker Threads over Child Processes for Risk Scoring

**Status:** Accepted

## Context

Risk scoring is deliberately CPU-bound (repeated SHA-256 rounds, tunable via
`RISK_SCORING_HASH_ROUNDS`). Run inline, it would block the worker's event
loop for the duration of every batch — starving cancellation checks, lease
heartbeats, and batch writes. A worker that can't renew its lease gets its
job stolen while still working on it.

## Decision

A fixed-size `worker_threads` pool, sized by `WORKER_POOL_SIZE`, created
once at process startup. Work is dispatched in **batches of 500**, not
per-record.

## Consequences

**Positive**

- **The main loop stays responsive.** Heartbeats and cancellation checks
  keep running while scoring saturates the pool.
- **Cheaper than processes.** Threads share the process's memory space; each
  child process would carry its own V8 heap and module graph.
- **Fast message passing** via structured clone, without IPC serialization
  overhead.
- **Batching keeps overhead proportionate.** One message per record would
  make message-passing cost dominate the actual work.
- **Behind a port.** `RiskScoringPoolPort` means unit tests inject a
  synchronous fake — no threads spawned in the test suite.

**Negative**

- **A crashing thread can destabilize the process** in ways a crashing child
  process cannot. Mitigated by respawning dead threads, but the isolation is
  genuinely weaker.
- **Only structured-cloneable data crosses the boundary** — functions and
  class instances don't survive, so `Date` handling is explicit at the edge.
- **Pool size is static.** Not adaptive to CPU count or observed load.
- **Debugging is harder** — breakpoints in worker threads need extra setup.

## Alternatives Considered

**Inline on the main thread** — simplest, and correct for the *output*. Only
rejected because of what it does to the worker's loop: heartbeats and
cancellation would stall for the duration of every batch. This is the
comparison worth measuring; see BENCHMARK.md.

**`child_process` fork pool** — stronger isolation, and a segfault couldn't
take down the parent. Rejected: higher memory per worker, slower startup,
and IPC serialization on every batch. The isolation benefit doesn't justify
it for a pure function with no I/O and no untrusted code execution.

**A separate scoring microservice** — best isolation and independent
scaling. Rejected as disproportionate: it adds a network hop, a deployment,
and a failure mode, for a function that takes milliseconds.

**Piscina** (an off-the-shelf pool) — would have been reasonable. A
hand-rolled pool was chosen because it's ~120 lines, avoids a dependency,
and makes the queueing and respawn behaviour explicit rather than
configured.
