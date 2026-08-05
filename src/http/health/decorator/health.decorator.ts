import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse } from '@nestjs/swagger';

import { EventLoopDto, LivenessDto, ReadinessDto } from '../dto/health.dto';

export function ApiLiveness() {
  return applyDecorators(
    ApiOperation({
      summary: 'Liveness probe',
      description: `
Reports whether the process is alive and its event loop turning. **Performs
no I/O** — deliberately.

Orchestrators use liveness to decide whether to **restart** a container. If
this checked the database, a transient DB outage would kill and restart
every API instance simultaneously, turning a recoverable dependency problem
into an application-wide crash loop — and making recovery *slower*, because
restarting instances cannot serve the traffic that returns when the
database comes back.
      `.trim(),
    }),
    ApiResponse({
      status: 200,
      description: 'Process is alive.',
      type: LivenessDto,
    }),
  );
}

export function ApiReadiness() {
  return applyDecorators(
    ApiOperation({
      summary: 'Readiness probe',
      description: `
Checks database connectivity and reports job-queue depth.

Orchestrators use readiness for **load-balancer rotation**, not restarts. A
failing instance is pulled from rotation temporarily and rejoins
automatically once the dependency recovers — no restart, no lost process
state.

Also returns **503 immediately** once graceful shutdown begins, before any
connection-closing work starts, so traffic stops arriving while in-flight
requests finish.
      `.trim(),
    }),
    ApiResponse({
      status: 200,
      description: 'Ready to serve traffic.',
      type: ReadinessDto,
    }),
    ApiResponse({
      status: 503,
      description:
        'Not ready — the database is unreachable, or the process is shutting down.',
    }),
  );
}

export function ApiEventLoop() {
  return applyDecorators(
    ApiOperation({
      summary: 'Event-loop delay snapshot',
      description: `
Exposed so worker-thread isolation can be observed live rather than assumed.

Percentiles are reset after each sampling window, so the values reflect the
most recent interval rather than being permanently skewed by one startup
spike.

**Caveat worth knowing:** the API and worker are separate *processes*, so
the API's numbers staying low is partly just process isolation. The figure
that actually demonstrates the \`worker_threads\` pool is the **worker's**
event-loop p99, available on the worker's own metrics port.
      `.trim(),
    }),
    ApiResponse({ status: 200, type: EventLoopDto }),
  );
}

export function ApiMetrics() {
  return applyDecorators(
    ApiOperation({
      summary: 'Prometheus metrics',
      description: `
Prometheus text exposition, covering:

- **Pipeline counters** — imports created/completed, records processed,
  rejected (by \`error_code\`), duplicated, retry attempts
- **Histograms** — batch persistence and risk-scoring durations
- **Gauges** — event-loop delay and utilization, process memory by type,
  CPU, active imports, job-queue depth, persist-queue depth
- **Node defaults** — heap, GC, handles, file descriptors

All label values are bounded enumerations. Identifiers are never used as
labels, and that is **enforced at runtime** — a metric call passing an
id-shaped value throws rather than silently exhausting memory through
cardinality explosion.

The **worker process exposes its own metrics separately** on port 3001;
this endpoint covers the API process only.
      `.trim(),
    }),
    ApiProduces('text/plain'),
    ApiResponse({
      status: 200,
      description: 'Prometheus text format (version 0.0.4).',
      schema: {
        type: 'string',
        example:
          '# HELP records_processed_total Records processed\n' +
          '# TYPE records_processed_total counter\n' +
          'records_processed_total 500000',
      },
    }),
  );
}
