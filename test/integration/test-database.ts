import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

let container: StartedPostgreSqlContainer | null = null;
let prisma: PrismaClient | null = null;

export async function startTestDatabase(): Promise<PrismaClient> {
  if (prisma) return prisma;

  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('import_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  const adapter = new PrismaPg({ connectionString: url });
  prisma = new PrismaClient({ adapter });
  await prisma.$connect();

  return prisma;
}

export async function stopTestDatabase(): Promise<void> {
  await prisma?.$disconnect();
  await container?.stop();
  prisma = null;
  container = null;
}

export async function truncateAll(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(`
    TRUNCATE TABLE
      transactions,
      rejected_records,
      processing_jobs,
      import_files,
      idempotency_keys,
      imports
    RESTART IDENTITY CASCADE;
  `);
}

export async function seedImport(
  client: PrismaClient,
  overrides: {
    id?: string;
    status?: string;
    provider?: string | null;
    storagePath?: string;
    jobStatus?: string;
    attemptCount?: number;
    leasedBy?: string | null;
    leasedUntil?: Date | null;
  } = {},
) {
  const id = overrides.id ?? crypto.randomUUID();

  const created = await client.import.create({
    data: {
      id,
      status: (overrides.status ?? 'PENDING') as never,
      provider: overrides.provider ?? 'test-provider',
    },
  });

  await client.importFile.create({
    data: {
      importId: id,
      storagePath: overrides.storagePath ?? `/tmp/${id}.ndjson`,
      size: BigInt(1024),
      checksum: 'test-checksum',
    },
  });

  await client.processingJob.create({
    data: {
      importId: id,
      status: (overrides.jobStatus ?? 'PENDING') as never,
      attemptCount: overrides.attemptCount ?? 0,
      leasedBy: overrides.leasedBy ?? null,
      leasedUntil: overrides.leasedUntil ?? null,
    },
  });

  return created;
}
