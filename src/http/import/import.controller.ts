import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  InvalidRequestBodyError,
  MissingIdempotencyKeyError,
  NoFileUploadedError,
} from '../../domain/domain-errors';
import { CreateImportUseCase } from '../../application/use-cases/create-import.use-case';
import { CreateImportResponseDto } from './dto/create-import-response.dto';

const EXPECTED_FIELD_NAME = 'file';

@Controller('v1/imports')
export class ImportController {
  constructor(private readonly createImport: CreateImportUseCase) {}

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
