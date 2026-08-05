module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testMatch: ['<rootDir>/test/integration/**/*.integration.spec.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  injectGlobals: true,
  testEnvironmentOptions: {
    customExportConditions: ['node', 'require', 'default'],
  },
};
