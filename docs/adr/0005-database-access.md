# ADR 0005 — Database Access: Prisma with Targeted Raw SQL

**Status:** Accepted

## Context

The service needs ordinary CRUD, but also three operations that are awkward
or impossible through a typical ORM:

- `SELECT ... FOR UPDATE SKIP LOCKED` for safe multi-worker job claiming
- `INSERT ... ON CONFLICT DO NOTHING RETURNING id` for an exact duplicate
  count
- Batch inserts of hundreds of rows in one statement

## Decision

Prisma as the primary client, with **raw SQL via `Prisma.sql` tagged
templates** for exactly those operations. All repository implementations sit
behind ports, so the choice is confined to `infrastructure/persistence/`.

## Consequences

**Positive**

- **Type-safe schema and migrations** for the ordinary paths.
- **Raw SQL where it earns its place.** `SKIP LOCKED` has no ORM equivalent,
  and Prisma's `createMany({ skipDuplicates })` doesn't report *which* rows
  were skipped — which the duplicate count needs.
- **`Prisma.sql` tagged templates are parameterized**, so raw SQL doesn't
  reintroduce injection risk. No `$queryRawUnsafe` anywhere on a path
  touching user input.
- **Swappable in principle.** Repositories implement ports; replacing Prisma
  means rewriting `infrastructure/persistence/` and nothing else.
- **Prisma types don't leak.** Repositories map to domain entities at the
  boundary, so `domain/` stays ORM-agnostic.

**Negative**

- **Raw SQL isn't type-checked** against the schema. A renamed column breaks
  at runtime, not compile time — caught only by integration tests.
- **Postgres-specific.** `SKIP LOCKED`, `ON CONFLICT`, and enum casts tie
  these queries to Postgres. Acceptable: the design already depends on
  Postgres semantics.
- **The driver adapter is new and rough.** `@prisma/adapter-pg` surfaces
  errors differently from the standard client (SQLSTATE nested under
  `.cause.originalCode`), and its WASM query compiler requires
  `--experimental-vm-modules` under Jest. Both cost real debugging time.
- **Enum casting in raw SQL** (`'PENDING'::"JobStatus"`) is fragile and
  easy to get subtly wrong.

## Alternatives Considered

**Prisma only, no raw SQL** — would forfeit `SKIP LOCKED` entirely, forcing
a different (worse) job-claiming strategy, and would make the duplicate
count approximate.

**Raw `pg` throughout** — full SQL control and no adapter quirks, but gives
up migrations, type generation, and schema tooling. The ORM earns its place
on the 80% of queries that are ordinary.

**Knex or Drizzle** — closer to SQL while retaining a query builder. Either
would have been defensible; Prisma was chosen for its migration workflow and
generated types. Drizzle in particular would likely have avoided the
driver-adapter friction described above.

**Standard Prisma client without the driver adapter** — would have avoided
the WASM/Jest issues and the unusual error shapes. The adapter was chosen for
explicit connection-pool control, which matters for the benchmark; in
hindsight that benefit was smaller than the friction it introduced.
