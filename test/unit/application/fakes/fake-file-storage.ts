import { Readable } from 'node:stream';
import {
  FileStoragePort,
  SavedFile,
} from '../../../../src/application/ports/file-storage.port';

export class FakeFileStorage implements FileStoragePort {
  public savedFiles: SavedFile[] = [];
  public deletedPaths: string[] = [];

  async save(source: Readable, extension: string): Promise<SavedFile> {
    for await (const _chunk of source) {
      // no-op — a real assertion-focused test could accumulate bytes here
    }
    const saved: SavedFile = {
      storagePath: `/fake/storage/file${extension}`,
      size: 123,
      checksum: 'fake-checksum',
    };
    this.savedFiles.push(saved);
    return saved;
  }

  async delete(storagePath: string): Promise<void> {
    this.deletedPaths.push(storagePath);
  }

  public orphansRemoved = 0;
  async cleanupOrphans(): Promise<number> {
    return this.orphansRemoved;
  }
}
