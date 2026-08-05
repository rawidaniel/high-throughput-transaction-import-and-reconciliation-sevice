import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const DESCRIPTION = `
A high-throughput service for importing and reconciling financial transactions
from NDJSON files.

## How it works

1. **POST /v1/imports** — the file is streamed directly to storage (never
   buffered in memory) and a job row is queued. Returns **202 immediately**;
   no parsing happens in the request handler.
2. A separate **worker process** claims the job, streams the file line by line,
   validates and fingerprints each record, scores risk on a **worker_threads**
   pool, and persists in batches.
3. **GET /v1/imports/{id}** — poll for progress. Then fetch
   **/summary** for aggregates or **/rejections** for per-record failures.

## Try it in this UI

Upload any \`.ndjson\` file with one JSON object per line:

\`\`\`json
{"transactionId":"txn-1","accountId":"acc-1","merchantId":"m-1","amount":10.50,"currency":"USD","timestamp":"2026-01-15T10:30:00Z","description":"Coffee"}
{"transactionId":"txn-2","accountId":"acc-1","merchantId":"m-2","amount":99.99,"currency":"EUR","timestamp":"2026-01-15T11:00:00Z"}
\`\`\`

Remember to set an **\`Idempotency-Key\`** header — it is required, and
reusing one returns the original import rather than creating a duplicate.

## Guarantees

- **Effectively-once persistence** via a unique constraint on
  \`(provider, transactionId)\` plus atomic batch writes, over
  **at-least-once job delivery**. Reprocessing after a crash never
  duplicates rows.
- **Bounded memory** regardless of file size — backpressure pauses the parse
  stream whenever persistence falls behind.
- **Cooperative cancellation** — the worker stops between batches and keeps
  work already committed.

## Errors

Every error returns the same shape, with a stable \`code\`, a message safe to
display, and a \`requestId\` for correlation. Stack traces, SQL, and internal
paths are never exposed.

\`\`\`json
{ "error": { "code": "IMPORT_NOT_FOUND", "message": "The requested import does not exist.", "requestId": "550e8400-..." } }
\`\`\`
`.trim();

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Transaction Import & Reconciliation Service')
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addTag(
      'Imports',
      'Upload, monitor, cancel, and report on transaction imports',
    )
    .addTag(
      'Health & Observability',
      'Liveness, readiness, and Prometheus metrics',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/openapi.json',
    yamlDocumentUrl: 'docs/openapi.yaml',
    customSiteTitle: 'Transaction Import API',
    swaggerOptions: {
      requestInterceptor: (req: Record<string, unknown>) => req,
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      tryItOutEnabled: true,
    },
  });
}
