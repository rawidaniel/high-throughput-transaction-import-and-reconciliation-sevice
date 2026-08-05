import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CancelImportUseCase } from '../../application/use-cases/cancel-import.use-case';
import { CreateImportUseCase } from '../../application/use-cases/create-import.use-case';
import { GetImportStatusUseCase } from '../../application/use-cases/get-import-status.use-case';
import { GetImportSummaryUseCase } from '../../application/use-cases/get-import-summary.use-case';
import { GetRejectedRecordsUseCase } from '../../application/use-cases/get-reject-transaction.use-case';
import {
  InvalidRequestBodyError,
  MissingIdempotencyKeyError,
  NoFileUploadedError,
} from '../../domain/domain-errors';
import { ConcurrentUploadLimitInterceptor } from '../common/interceptors/concurrent-upload-limit.interceptor';
import {
  ApiCancelImport,
  ApiCreateImport,
  ApiGetImportStatus,
} from './decorator/imports.decorator';
import { CreateImportResponseDto } from './dto/create-import-response.dto';
import { ImportSummaryDto, RejectedRecordsDto } from './dto/import-reports.dto';
import { ImportStatusDto } from './dto/import-status.dto';

const EXPECTED_FIELD_NAME = 'file';

@Controller('v1/imports')
export class ImportController {
  constructor(
    private readonly createImport: CreateImportUseCase,
    private readonly getImportStatus: GetImportStatusUseCase,
    private readonly cancelImport: CancelImportUseCase,
    private readonly getImportSummary: GetImportSummaryUseCase,
    private readonly getRejectedRecords: GetRejectedRecordsUseCase,
  ) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(ConcurrentUploadLimitInterceptor)
  @ApiCreateImport()
  async create(
    @Req() request: FastifyRequest,
  ): Promise<CreateImportResponseDto> {
    const idempotencyKey = request.headers['idempotency-key'];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      throw new MissingIdempotencyKeyError();
    }

    if (!request.isMultipart()) {
      throw new InvalidRequestBodyError(
        'Request must be multipart/form-data containing a file field.',
      );
    }

    const contentEncoding = request.headers['content-encoding'];
    if (contentEncoding && contentEncoding !== 'identity') {
      throw new InvalidRequestBodyError(
        'Compressed uploads are not supported. Send the file uncompressed.',
      );
    }

    const part = await this.readFilePart(request);

    if (!part) {
      throw new NoFileUploadedError();
    }

    if (part.fieldname !== EXPECTED_FIELD_NAME) {
      throw new InvalidRequestBodyError(
        `Expected a file field named "${EXPECTED_FIELD_NAME}".`,
      );
    }

    assertNotCompressedArchive(part.filename, part.mimetype);

    const result = await this.createImport.execute({
      idempotencyKey,
      fileStream: part.file,
      originalFilename: part.filename,
      mimeType: part.mimetype,
    });

    return CreateImportResponseDto.from(result.importRecord);
  }

  @Get(':id')
  @ApiGetImportStatus()
  async getStatus(@Param('id') id: string): Promise<ImportStatusDto> {
    const record = await this.getImportStatus.execute(id);
    return ImportStatusDto.from(record);
  }

  @Post(':id/cancel')
  @HttpCode(202)
  @ApiCancelImport()
  async cancel(@Param('id') id: string) {
    const result = await this.cancelImport.execute(id);
    return { id, status: result.status };
  }

  @Get(':id/summary')
  async getSummary(@Param('id') id: string) {
    const summary = await this.getImportSummary.execute(id);
    return ImportSummaryDto.from(summary);
  }

  @Get(':id/rejections')
  async getRejections(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;
    const page = await this.getRejectedRecords.execute(
      id,
      cursor ?? null,
      parsedLimit,
    );
    return RejectedRecordsDto.from(page);
  }

  private async readFilePart(request: FastifyRequest) {
    try {
      return await request.file();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Malformed multipart request.';
      throw new InvalidRequestBodyError(message);
    }
  }
}

function assertNotCompressedArchive(filename: string, mimeType: string): void {
  const COMPRESSED_EXTENSIONS = /\.(gz|zip|bz2|xz|7z|rar|tar|tgz|zst|lz4|br)$/i;
  const COMPRESSED_MIMES = new Set([
    'application/gzip',
    'application/x-gzip',
    'application/zip',
    'application/x-zip-compressed',
    'application/x-bzip2',
    'application/x-xz',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/zstd',
  ]);

  if (
    COMPRESSED_EXTENSIONS.test(filename ?? '') ||
    COMPRESSED_MIMES.has(mimeType)
  ) {
    throw new InvalidRequestBodyError(
      'Compressed or archive uploads are not supported. Send plain NDJSON.',
    );
  }
}
