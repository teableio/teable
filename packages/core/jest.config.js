// @ts-check
const { getTsconfig } = require('get-tsconfig');
const { pathsToModuleNameMapper } = require('ts-jest');

const { getJestCachePath } = require('../../cache.config');

const tsConfigFile = './tsconfig.json';

/**
 * Transform the tsconfig paths into jest compatible one (support extends)
 * @param {string} tsConfigFile
 */
const getTsConfigBasePaths = (tsConfigFile) => {
  const parsedTsConfig = getTsconfig(tsConfigFile);
  if (parsedTsConfig === null) {
    throw new Error(`Cannot find tsconfig file: ${tsConfigFile}`);
  }
  const tsPaths = parsedTsConfig.config.compilerOptions?.paths;
  return tsPaths
    ? pathsToModuleNameMapper(tsPaths, {
        prefix: '<rootDir>/',
      })
    : {};
};

/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  displayName: `core:unit`,
  cacheDirectory: getJestCachePath('@teable-group/core'),
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  verbose: true,
  rootDir: './src',
  setupFilesAfterEnv: ['@testing-library/jest-dom/extend-expect'],
  testMatch: ['<rootDir>/**/*.{spec,test}.{js,jsx,ts,tsx}'],
  moduleNameMapper: {
    ...getTsConfigBasePaths(tsConfigFile),
  },
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        tsconfig: tsConfigFile,
      },
    ],
  },

  // false by default, overrides in cli, ie: yarn test:unit --collect-coverage=true
  collectCoverage: false,
  coverageDirectory: '<rootDir>/../coverage',
  collectCoverageFrom: [
    '<rootDir>/**/*.{ts,tsx,js,jsx}',
    '!**/*.{spec,test}.{js,ts}',
    '!**/__mock__/*',
  ],
  setupFiles: ['<rootDir>/../jest.setup.js'],
};

module.exports = config;
