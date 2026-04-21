/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/?(*.)+(test|spec).ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/test/integration/'],
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
  clearMocks: true,
  collectCoverageFrom: [
    'src/modules/movement/**/*.ts',
    'src/modules/entities/entities.service.ts',
    '!**/*.d.ts',
  ],
};
