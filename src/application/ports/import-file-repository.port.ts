export interface ImportFileLocation {
  storagePath: string;
  provider: string | null;
}
export interface ImportFileRepositoryPort {
  findByImportId(importId: string): Promise<ImportFileLocation | null>;
}
