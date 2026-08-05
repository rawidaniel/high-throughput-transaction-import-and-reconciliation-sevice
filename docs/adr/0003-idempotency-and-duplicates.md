# ADR 0003 — Idempotency and Duplicate Detection via Unique Constraints

**Status:** Accepted

## Context

Two distinct problems:

1. **Request idempotency** — a client retrying an upload after a timeout
   must not create a second import.
2. **Record duplication** — the same transaction may appear twice in a file,
   across files, or when a crashed job is reprocessed from line 1.

Both are concurrency problems. Any check-then-act approach races.

## Decision

Enforce both with **database unique constraints**, and let the write attempt
fail rather than checking first.

**Idempotency** — `UNIQUE (idempotency_keys.key)`. The create path attempts
the insert inside a transaction; on conflict it rolls back entirely and
returns the existing import.

**Duplicates** — `UNIQUE (provider, transactionId)` with
`INSERT ... ON CONFLICT DO NOTHING RETURNING id`. The returned count gives
an exact duplicate tally.

**Policy: first-write-wins.** The stored row is never overwritten.
Differing content is recorded as `CONTENT_MISMATCH` rather than plain
`DUPLICATE`.

## Consequences

**Positive**

- **Correct under concurrency.** 20 simultaneous requests with the same key
  produce exactly one import — verified by integration test. A pre-check
  would have every racer see "no existing key" before any wrote one.
- **Survives restarts.** No in-memory state to lose.
- **Bounded memory.** An in-memory `Set` for a 500k-record file would grow
  with the file; a constraint costs nothing.
- **Works across imports.** The same transaction in a later, unrelated file
  is still detected.
- **Makes retry safe.** Reprocessing after a crash cannot duplicate rows,
  which is what permits the whole at-least-once recovery model.
- **Rollback is total.** A losing racer's import, file, and job rows all
  roll back — not just the key insert.

**Negative**

- **Error-shape coupling.** Detecting the conflict means inspecting driver
  errors. `@prisma/adapter-pg` nests the SQLSTATE under
  `.cause.originalCode` rather than populating `meta.target`, which took
  empirical debugging to establish and could change between versions.
- **Constraint names are ambiguous.** Postgres's default `_key` suffix means
  *every* unique constraint's name contains "key" — substring matching would
  misclassify unrelated violations. Matching is on column names instead.
- **Legitimate corrections are rejected.** An amended transaction with the
  same id is treated as a duplicate.
- **`CONTENT_MISMATCH` costs a lookup** per batch containing duplicates.

## Alternatives Considered

**Check-then-insert** — races under concurrency, which is precisely the
scenario that matters. Rejected outright.

**In-memory `Set` for duplicates** — fast, but loses state on restart,
doesn't work across imports, doesn't work across multiple workers, and grows
with file size.

**Last-write-wins upsert** — would apply corrections automatically. Rejected:
it makes an accidental re-import a data-modifying event, and the outcome
becomes dependent on processing order.

**Advisory locks** — would serialize the create path. Rejected as heavier
than a constraint for no additional guarantee.
