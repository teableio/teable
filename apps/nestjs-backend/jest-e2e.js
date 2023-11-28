const { getTsconfig } = require('get-tsconfig');
const { pathsToModuleNameMapper } = require('ts-jest');
const tsConfigFile = './tsconfig.json';
const { getJestCachePath } = require('../../cache.config');
const packageJson = require('./package.json');

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
  return tsPaths ? pathsToModuleNameMapper(tsPaths, { prefix: '<rootDir>' }) : {};
};

module.exports = {
  bail: true,
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  maxWorkers: 1,
  testEnvironment: 'node',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  preset: 'ts-jest',
  globalSetup: '<rootDir>/jest-e2e.setup.ts',
  coverageReporters: ['text'],
  moduleNameMapper: {
    ...getTsConfigBasePaths(tsConfigFile),
  },
  cacheDirectory: getJestCachePath(packageJson.name, 'e2e'),
  globals: {
    testConfig: {
      email: 'test@e2e.com',
      password: '12345678',
      userId: 'usrTestUserId',
      spaceId: 'spcTestSpaceId',
      baseId: 'bseTestBaseId',
    },
  },
};
