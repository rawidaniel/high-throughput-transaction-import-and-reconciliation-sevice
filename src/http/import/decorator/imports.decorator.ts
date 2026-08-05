import { applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';

import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  CancelImportResponseDto,
  CreateImportBodyDto,
  CreateImportResponseDto,
  ImportStatusDto,
  ImportSummaryDto,
  RejectedRecordsPageDto,
} from '../dto/import.dto';

const ImportIdParam = () =>
  ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Import id returned by POST /v1/imports.',
    example: 'a1a16868-10a8-4fa9-bf30-d7e5cfa733d9',
  });

const ImportNotFoundResponse = () =>
  ApiResponse({
    status: 404,
    description: 'IMPORT_NOT_FOUND',
    type: ErrorResponseDto,
  });

export function ApiCreateImport() {
  return applyDecorators(
    ApiOperation({
      summary: 'Upload an NDJSON file for asynchronous import',
      description: `
Streams the uploaded file to storage and queues it for processing. Returns
**202 immediately** — no parsing happens in the request handler. Poll
\`GET /v1/imports/{id}\` for progress.

**Idempotency.** The \`Idempotency-Key\` header is required. Replaying the
same key returns the *existing* import rather than creating a duplicate,
and this holds under concurrent requests (enforced by a database unique
constraint, not a check-then-insert).

**Limits.** 500 MB max, one file per request, \`.ndjson\`/\`.jsonl\`/\`.json\`
only. Compressed uploads are rejected. The client-supplied filename and
MIME type are validated but never trusted — files are stored under a
server-generated UUID.

**Note for Swagger UI users:** send the file under the field name \`file\`.
      `.trim(),
    }),
    ApiConsumes('multipart/form-data'),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description:
        'Client-generated unique key. Reusing a key returns the original import instead of creating a new one.',
      example: '060e7c8d-a6bb-4b42-85b7-ed2a3d99223e',
    }),
    ApiBody({ type: CreateImportBodyDto }),
    ApiResponse({
      status: 202,
      description:
        'Accepted and queued. Also returned for an idempotent replay, pointing at the existing import.',
      type: CreateImportResponseDto,
    }),
    ApiResponse({
      status: 400,
      description:
        'MISSING_IDEMPOTENCY_KEY · NO_FILE_UPLOADED · INVALID_FILE_TYPE · INVALID_REQUEST_BODY (wrong content-type, wrong field name, malformed multipart, or a compressed upload)',
      type: ErrorResponseDto,
    }),
    ApiResponse({
      status: 413,
      description: 'IMPORT_FILE_TOO_LARGE — exceeds the 500 MB limit.',
      type: ErrorResponseDto,
    }),
    ApiResponse({
      status: 429,
      description: 'RATE_LIMIT_EXCEEDED',
      type: ErrorResponseDto,
    }),
    ApiResponse({
      status: 503,
      description: 'TOO_MANY_CONCURRENT_UPLOADS — retry shortly.',
      type: ErrorResponseDto,
    }),
  );
}

export function ApiGetImportStatus() {
  return applyDecorators(
    ApiOperation({
      summary: 'Get import status and progress',
      description:
        'Progress counters are updated per batch, in the same transaction as ' +
        'the batch write. `processedCount` may briefly exceed `totalRecords` ' +
        'if a worker crashed mid-file and another reprocessed it — see the ' +
        'at-least-once caveat in ARCHITECTURE.md.',
    }),
    ImportIdParam(),
    ApiResponse({ status: 200, type: ImportStatusDto }),
    ImportNotFoundResponse(),
  );
}

export function ApiCancelImport() {
  return applyDecorators(
    ApiOperation({
      summary: 'Request cancellation of an in-flight import',
      description: `
Flags the import for cancellation and returns **202** — cancellation is
*requested*, not completed. The worker checks the flag between batches,
stops cleanly, and transitions to \`CANCELLED\`.

Work already persisted is **kept**, so counters stay consistent with what
is actually stored. Repeating the request while already \`CANCELLING\` is
idempotent.
      `.trim(),
    }),
    ImportIdParam(),
    ApiResponse({ status: 202, type: CancelImportResponseDto }),
    ImportNotFoundResponse(),
    ApiResponse({
      status: 409,
      description:
        'IMPORT_ALREADY_FINISHED — already COMPLETED, FAILED, or CANCELLED.',
      type: ErrorResponseDto,
    }),
  );
}

export function ApiGetImportSummary() {
  return applyDecorators(
    ApiOperation({
      summary: 'Aggregated statistics for an import',
      description:
        'Aggregated on demand from persisted transactions. Cost grows with ' +
        'import size; a pre-aggregated summary table is the documented ' +
        'scale-up path.',
    }),
    ImportIdParam(),
    ApiResponse({ status: 200, type: ImportSummaryDto }),
    ImportNotFoundResponse(),
  );
}

export function ApiGetRejections() {
  return applyDecorators(
    ApiOperation({
      summary: 'List rejected records (cursor-paginated)',
      description: `
Keyset pagination via \`WHERE id > cursor\`, so every page costs the same
regardless of depth — unlike OFFSET, which degrades as you page deeper.

Pass the \`nextCursor\` from a response as \`?cursor=\` to fetch the next
page. A null \`nextCursor\` means the list is exhausted.

\`limit\` is **capped server-side at 200** regardless of what is requested.
      `.trim(),
    }),
    ImportIdParam(),
    ApiQuery({
      name: 'cursor',
      required: false,
      description:
        'The `nextCursor` from the previous page. Omit for the first page.',
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      description: 'Page size. Values above 200 are clamped to 200.',
    }),
    ApiResponse({ status: 200, type: RejectedRecordsPageDto }),
    ImportNotFoundResponse(),
  );
}
