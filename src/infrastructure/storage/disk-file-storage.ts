import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FileTooLargeError } from 'src/domain/domain-errors';
import {
  FileStoragePort,
  SavedFile,
} from '../../application/ports/file-storage.port';

const STORAGE_ROOT =
  process.env.UPLOAD_STORAGE_DIR ??
  path.resolve(process.cwd(), 'storage/uploads');

@Injectable()
export class DiskFileStorage implements FileStoragePort {
  async save(
    source: Readable,
    extension: string,
    maxBytes: number,
  ): Promise<SavedFile> {
    await mkdir(STORAGE_ROOT, { recursive: true });

    const generatedName = `${randomUUID()}${extension}`;
    const storagePath = path.join(STORAGE_ROOT, generatedName);

    const hash = createHash('sha256');
    let bytesWritten = 0;

    const guard = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > maxBytes) {
          callback(new FileTooLargeError(maxBytes));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(source, guard, createWriteStream(storagePath));
    } catch (err) {
      await rm(storagePath, { force: true });
      throw err;
    }

    return {
      storagePath,
      size: bytesWritten,
      checksum: hash.digest('hex'),
    };
  }

  async delete(storagePath: string): Promise<void> {
    await rm(storagePath, { force: true });
  }
}
