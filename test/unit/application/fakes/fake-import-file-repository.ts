import {
  ImportFileLocation,
  ImportFileRepositoryPort,
} from 'src/application/ports/import-file-repository.port';

export class FakeImportFileRepository implements ImportFileRepositoryPort {
  constructor(
    private readonly location: ImportFileLocation | null = {
      storagePath: '/fake/path.ndjson',
      provider: 'fake-provider',
    },
  ) {}
  async findByImportId(): Promise<ImportFileLocation | null> {
    return this.location;
  }
}
