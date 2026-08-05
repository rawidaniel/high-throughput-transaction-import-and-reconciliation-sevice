import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  FileStoragePort,
  SavedFile,
} from '../../application/ports/file-storage.port';
import { FileTooLargeError } from '../../domain/domain-errors';

const STORAGE_ROOT = path.resolve(
  process.env.UPLOAD_STORAGE_DIR ?? path.join(process.cwd(), 'storage/uploads'),
);

const ORPHAN_AGE_MS = Number(
  process.env.ORPHAN_FILE_AGE_MS ?? 24 * 60 * 60 * 1000,
);

@Injectable()
export class DiskFileStorage implements FileStoragePort {
  async save(
    source: Readable,
    extension: string,
    maxBytes: number,
  ): Promise<SavedFile> {
    await mkdir(STORAGE_ROOT, { recursive: true });

    const generatedName = `${randomUUID()}${sanitizeExtension(extension)}`;
    const storagePath = path.join(STORAGE_ROOT, generatedName);

    assertWithinStorageRoot(storagePath);

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

    const wasTruncated =
      (source as unknown as { truncated?: boolean }).truncated === true;
    if (wasTruncated) {
      await rm(storagePath, { force: true });
      throw new FileTooLargeError(maxBytes);
    }

    return { storagePath, size: bytesWritten, checksum: hash.digest('hex') };
  }

  async delete(storagePath: string): Promise<void> {
    assertWithinStorageRoot(path.resolve(storagePath));
    await rm(storagePath, { force: true });
  }

  async cleanupOrphans(referencedPaths: Set<string>): Promise<number> {
    let removed = 0;

    let entries: string[];
    try {
      entries = await readdir(STORAGE_ROOT);
    } catch {
      return 0;
    }

    const cutoff = Date.now() - ORPHAN_AGE_MS;

    for (const entry of entries) {
      const fullPath = path.join(STORAGE_ROOT, entry);
      try {
        const stats = await stat(fullPath);
        if (!stats.isFile()) continue;
        if (stats.mtimeMs > cutoff) continue;
        if (referencedPaths.has(fullPath)) continue;

        await rm(fullPath, { force: true });
        removed++;
      } catch {
        // A file vanishing mid-sweep is fine — that's the desired end state.
      }
    }

    return removed;
  }
}

function assertWithinStorageRoot(candidate: string): void {
  const relative = path.relative(STORAGE_ROOT, candidate);
  const escapes = relative.startsWith('..') || path.isAbsolute(relative);
  if (escapes) {
    throw new Error('Refusing to operate on a path outside the storage root.');
  }
}

function sanitizeExtension(extension: string): string {
  const match = /^\.[a-z0-9]{1,10}$/i.exec(extension);
  return match ? match[0].toLowerCase() : '.dat';
}
