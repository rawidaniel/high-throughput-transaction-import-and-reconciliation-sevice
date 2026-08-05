/**
 * Integration tests. Requires Docker (Testcontainers starts a real Postgres).
 *
 * maxWorkers: 1 is deliberate — the suites share one container, and running
 * them in parallel would let one suite's truncateAll() wipe another's data
 * mid-test.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testMatch: ['<rootDir>/test/integration/**/*.integration.spec.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
};
