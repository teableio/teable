// @ts-check

const tsConfigFile = './e2e/tsconfig.e2e.json';
const { getJestCachePath } = require('../../../cache.config');

const packageJson = require('../package.json');

/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  displayName: `${packageJson.name}:e2e`,
  cacheDirectory: getJestCachePath(`${packageJson.name}:e2e`),
  testEnvironment: 'node',
  rootDir: '../',
  setupFilesAfterEnv: ['<rootDir>/e2e/jest.setup.ts'],
  verbose: true,
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        tsconfig: tsConfigFile,
      },
    ],
  },
  testMatch: ['<rootDir>/e2e/suites/**/*.test.ts'],
};
module.exports = config;
