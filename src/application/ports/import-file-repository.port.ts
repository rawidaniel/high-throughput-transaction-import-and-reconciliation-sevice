export interface ImportFileRepositoryPort {
  findStoragePathByImportId(importId: string): Promise<string | null>;
}
