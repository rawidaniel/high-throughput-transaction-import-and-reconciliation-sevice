import { Readable } from 'node:stream';

export interface SavedFile {
  storagePath: string;
  size: number;
  checksum: string;
}

export interface FileStoragePort {
  save(
    source: Readable,
    extension: string,
    maxBytes: number,
  ): Promise<SavedFile>;

  delete(storagePath: string): Promise<void>;
}
