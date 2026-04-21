/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/integration'],
  testMatch: ['**/?(*.)+(test|spec).ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@parkwalk/shared$': '<rootDir>/../shared/src/index.ts',
    '^@parkwalk/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.json', useESM: false, diagnostics: { warnOnly: true } },
    ],
  },
  setupFilesAfterEach: ['<rootDir>/test/integration/setup.ts'],
  testTimeout: 30000,
  maxWorkers: 1,
};
