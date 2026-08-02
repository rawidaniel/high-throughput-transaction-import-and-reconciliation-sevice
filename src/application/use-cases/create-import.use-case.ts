import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  InvalidFileTypeError,
  NoFileUploadedError,
} from '../../domain/domain-errors';
import { type ClockPort } from '../ports/clock.port';
import { type FileStoragePort } from '../ports/file-storage.port';
import { type IdGeneratorPort } from '../ports/id-generator.port';
import {
  ImportRecord,
  type ImportRepositoryPort,
} from '../ports/import-repository.port';
import {
  CLOCK,
  FILE_STORAGE,
  ID_GENERATOR,
  IMPORT_REPOSITORY,
} from '../ports/tokens';

const ALLOWED_EXTENSIONS = new Set(['.ndjson', '.jsonl', '.json']);
const ALLOWED_MIME_TYPES = new Set([
  'application/x-ndjson',
  'application/json',
  'text/plain',
  'application/octet-stream',
]);
const MAX_UPLOAD_BYTES =
  parseInt(process.env.MAX_UPLOAD_BYTES || '500') * 1024 * 1024;

export interface CreateImportCommand {
  idempotencyKey: string;
  fileStream: Readable;
  originalFilename: string;
  mimeType: string;
}

export interface CreateImportResult {
  importRecord: ImportRecord;
  isNew: boolean;
}

@Injectable()
export class CreateImportUseCase {
  constructor(
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStoragePort,
    @Inject(IMPORT_REPOSITORY)
    private readonly importRepository: ImportRepositoryPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: CreateImportCommand): Promise<CreateImportResult> {
    if (!command.fileStream) {
      throw new NoFileUploadedError();
    }

    const extension = this.extractExtension(command.originalFilename);
    this.assertAllowedFileType(extension, command.mimeType);

    const savedFile = await this.fileStorage.save(
      command.fileStream,
      extension,
      MAX_UPLOAD_BYTES,
    );

    const result = await this.importRepository.createOrReturnExisting({
      id: this.idGenerator.generate(),
      createdAt: this.clock.now(),
      idempotencyKey: command.idempotencyKey,
      file: savedFile,
    });

    if (!result.isNew) {
      await this.fileStorage.delete(savedFile.storagePath);
    }

    return result;
  }

  private extractExtension(filename: string): string {
    const match = /\.[^.]+$/.exec(filename ?? '');
    return match ? match[0].toLowerCase() : '';
  }

  private assertAllowedFileType(extension: string, mimeType: string): void {
    const extensionOk = ALLOWED_EXTENSIONS.has(extension);
    const mimeOk = ALLOWED_MIME_TYPES.has(mimeType);
    if (!extensionOk || !mimeOk) {
      throw new InvalidFileTypeError(
        `${mimeType} (${extension || 'no extension'})`,
      );
    }
  }
}
