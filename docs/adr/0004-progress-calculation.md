# ADR 0004 — Progress Calculation: Counting Pass plus Atomic Increments

**Status:** Accepted

## Context

`GET /v1/imports/:id` needs to report meaningful progress during a
multi-minute import. That requires a numerator (records handled) and a
denominator (records total).

The client's claimed record count cannot be trusted. A batch write has no
knowledge of total file size, so the denominator can't be derived
incrementally.

## Decision

**Denominator** — one sequential byte-scan of the file before processing
starts, establishing `totalRecords`. Written as an **absolute** value.

**Numerator** — counters incremented per batch, **in the same transaction**
as the batch write.

**Critical invariant:** both sides exclude blank lines. If the counting pass
counted them and the processing pass didn't, `processedCount` could never
reach `totalRecords` and a progress bar would stall short of 100%.

## Consequences

**Positive**

- **Accurate progress from the first batch**, rather than a number that only
  becomes meaningful once the import is finished.
- **Counters can't drift from stored data.** Sharing a transaction with the
  batch write makes "batch succeeded, counter update failed" impossible.
- **`totalRecords` survives reprocessing** — an absolute write sets the same
  value again rather than doubling.
- **The counting pass is cheap relative to processing** — a byte scan with
  no JSON parsing, validation, or per-record allocation. It's several times
  faster than reusing `readline`.

**Negative**

- **An extra full read of the file.** On a 500 MB file this is measurable
  I/O, paid before any useful work begins.
- **Increment-based counters are at-least-once.** After a crash and
  reprocess, already-committed batches increment again — so
  `processedCount`, `rejectedCount`, and `duplicateCount` can overshoot.
  `acceptedCount` stays correct because it derives from `RETURNING id`,
  which returns nothing on a full-conflict retry.
- **The blank-line invariant is easy to break.** It's enforced by a test
  asserting both rules agree, but it isn't structurally guaranteed.

## Alternatives Considered

**Set `totalRecords` at the end** — free, but useless as a progress
denominator: you learn the total only once you no longer need it.

**Estimate from file size** — cheap and immediate: sample N lines, compute
average bytes per line, divide. Rejected because presenting an estimate
through a field named `totalRecords` is quietly misleading; it would need
renaming to `estimatedTotalRecords` to be honest. Worth reconsidering if the
counting pass proves costly in benchmarks.

**Derive all counters via `COUNT(*)` at completion** — perfectly accurate
and immune to the overshoot problem, but gives no live progress during the
import, which is the main thing the status endpoint exists for.

**Resumable byte offsets** — would fix the overshoot properly by letting a
reclaimed job resume rather than restart. Not implemented: it requires
persisting a committed offset per batch and seeking on resume, which is
meaningful complexity for a correctness issue that affects only display
values, not stored data.
