import { Readable } from 'node:stream';
import { CreateImportUseCase } from '../../../src/application/use-cases/create-import.use-case';
import { FakeImportRepository } from './fakes/fake-import-repository';
import { FakeFileStorage } from './fakes/fake-file-storage';
import { FixedClock, NoopLogger, SequentialIdGenerator } from './fakes/fakes';
import { FakeMetricsRecorder } from './fakes/fake-resilience';
import { InvalidFileTypeError } from '../../../src/domain/domain-errors';

function makeStream(contents: string): Readable {
  return Readable.from([Buffer.from(contents)]);
}

describe('CreateImportUseCase (unit, fakes only)', () => {
  function setup() {
    const importRepository = new FakeImportRepository();
    const fileStorage = new FakeFileStorage();
    const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
    const idGenerator = new SequentialIdGenerator();
    const logger = new NoopLogger();

    const metrics = new FakeMetricsRecorder();

    const useCase = new CreateImportUseCase(
      fileStorage,
      importRepository,
      clock,
      idGenerator,
      logger,
    );

    return {
      useCase,
      importRepository,
      fileStorage,
      clock,
      idGenerator,
      metrics,
    };
  }

  it('creates a new import on first call and uses the injected clock/id generator', async () => {
    const { useCase } = setup();

    const result = await useCase.execute({
      idempotencyKey: 'key-1',
      fileStream: makeStream('{"transactionId":"t1"}\n'),
      originalFilename: 'data.ndjson',
      mimeType: 'application/x-ndjson',
    });

    expect(result.isNew).toBe(true);
    expect(result.importRecord.id).toBe('fake-id-1');
    expect(result.importRecord.createdAt.toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(result.importRecord.status).toBe('PENDING');
  });

  it('returns the SAME import on a repeated idempotency key and cleans up the duplicate upload', async () => {
    const { useCase, fileStorage } = setup();

    const first = await useCase.execute({
      idempotencyKey: 'key-2',
      fileStream: makeStream('{"transactionId":"t1"}\n'),
      originalFilename: 'data.ndjson',
      mimeType: 'application/x-ndjson',
    });

    const second = await useCase.execute({
      idempotencyKey: 'key-2',
      fileStream: makeStream('{"transactionId":"t1"}\n'),
      originalFilename: 'data.ndjson',
      mimeType: 'application/x-ndjson',
    });

    expect(second.isNew).toBe(false);
    expect(second.importRecord.id).toBe(first.importRecord.id);
    expect(fileStorage.deletedPaths).toHaveLength(1);
    expect(fileStorage.deletedPaths[0]).toBe(
      fileStorage.savedFiles[1].storagePath,
    );
  });

  it('rejects a disallowed file type before ever touching the repository', async () => {
    const { useCase, importRepository } = setup();

    await expect(
      useCase.execute({
        idempotencyKey: 'key-3',
        fileStream: makeStream('not json'),
        originalFilename: 'data.exe',
        mimeType: 'application/octet-stream',
      }),
    ).rejects.toBeInstanceOf(InvalidFileTypeError);

    expect(await importRepository.findById('fake-id-1')).toBeNull();
  });
});
