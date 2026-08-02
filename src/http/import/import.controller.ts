import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  InvalidRequestBodyError,
  MissingIdempotencyKeyError,
  NoFileUploadedError,
} from '../../domain/domain-errors';
import { CreateImportUseCase } from '../../application/use-cases/create-import.use-case';
import { CreateImportResponseDto } from './dto/create-import-response.dto';

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

    const part = await request.file();
    if (!part) {
      throw new NoFileUploadedError();
    }

    const result = await this.createImport.execute({
      idempotencyKey,
      fileStream: part.file,
      originalFilename: part.filename,
      mimeType: part.mimetype,
    });

    return CreateImportResponseDto.from(result.importRecord);
  }
}
