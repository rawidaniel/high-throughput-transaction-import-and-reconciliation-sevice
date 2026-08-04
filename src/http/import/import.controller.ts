import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CancelImportUseCase } from '../../application/use-cases/cancel-import.use-case';
import { CreateImportUseCase } from '../../application/use-cases/create-import.use-case';
import { GetImportStatusUseCase } from '../../application/use-cases/get-import-status.use-case';
import { GetImportSummaryUseCase } from '../../application/use-cases/get-import-summary.use-case';
import {
  InvalidRequestBodyError,
  MissingIdempotencyKeyError,
  NoFileUploadedError,
} from '../../domain/domain-errors';
import { CreateImportResponseDto } from './dto/create-import-response.dto';
import { ImportSummaryDto } from './dto/import-reports.dto';
import { ImportStatusDto } from './dto/import-status.dto';

const EXPECTED_FIELD_NAME = 'file';

@Controller('v1/imports')
export class ImportController {
  constructor(
    private readonly createImport: CreateImportUseCase,
    private readonly getImportStatus: GetImportStatusUseCase,
    private readonly cancelImport: CancelImportUseCase,
    private readonly getImportSummary: GetImportSummaryUseCase,
  ) {}

  @Post()
  @HttpCode(202)
  async Create(@Req() request: FastifyRequest) {
    const idempotencyKey = request.headers['idempotency-key'];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      throw new MissingIdempotencyKeyError();
    }

    if (!request.isMultipart()) {
      throw new InvalidRequestBodyError(
        'Request must be multipart/form-data containing a file field.',
      );
    }

    const part = await this.readFilePart(request);

    if (!part) {
      throw new NoFileUploadedError();
    }

    if (part.fieldname !== EXPECTED_FIELD_NAME) {
      throw new InvalidRequestBodyError(
        `Expected a file field named "${EXPECTED_FIELD_NAME}", received "${part.fieldname}".`,
      );
    }

    const result = await this.createImport.execute({
      idempotencyKey,
      fileStream: part.file,
      originalFilename: part.filename,
      mimeType: part.mimetype,
    });

    return CreateImportResponseDto.from(result.importRecord);
  }

  @Get(':id')
  async getStatus(@Param('id') id: string): Promise<ImportStatusDto> {
    const record = await this.getImportStatus.execute(id);
    return ImportStatusDto.from(record);
  }

  @Post(':id/cancel')
  @HttpCode(202)
  async cancel(@Param('id') id: string) {
    const result = await this.cancelImport.execute(id);
    return { id, status: result.status };
  }

  @Get(':id/summary')
  async getSummary(@Param('id') id: string) {
    const summary = await this.getImportSummary.execute(id);
    return ImportSummaryDto.from(summary);
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
