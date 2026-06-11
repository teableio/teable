import path from 'path';
import type { INestApplication } from '@nestjs/common';
import { DriverClient, parseDsn } from '@teable/core';
import dotenv from 'dotenv-flow';
import { buildSync } from 'esbuild';

// Handle ConditionalModule timeout errors that occur sporadically in CI
// These errors are thrown from setTimeout callbacks and cannot be caught normally
// See: @nestjs/config ConditionalModule.registerWhen
const originalUncaughtExceptionListeners = process.listeners('uncaughtException');
process.removeAllListeners('uncaughtException');
process.on('uncaughtException', (error: Error) => {
  // Ignore ConditionalModule timeout errors - they are sporadic in CI and don't affect test results
  if (
    error.message?.includes('Nest was not able to resolve the config variables') &&
    error.message?.includes('ConditionalModule')
  ) {
    console.warn('[vitest-e2e.setup] Ignoring ConditionalModule timeout error:', error.message);
    return;
  }
  // Re-throw other uncaught exceptions
  for (const listener of originalUncaughtExceptionListeners) {
    listener.call(process, error, 'uncaughtException');
  }
  // If no original listeners, throw the error
  if (originalUncaughtExceptionListeners.length === 0) {
    throw error;
  }
});

interface ITestConfig {
  driver: string;
  email: string;
  userName: string;
  userId: string;
  password: string;
  spaceId: string;
  baseId: string;
}

interface IInitAppReturnType {
  app: INestApplication<unknown>;
  appUrl: string;
  cookie: string;
  sessionID: string;
}

declare global {
  // eslint-disable-next-line no-var
  var testConfig: ITestConfig;
  // eslint-disable-next-line no-var
  var initApp: undefined | (() => Promise<IInitAppReturnType>);
}

// Set global variables (if needed)
globalThis.testConfig = {
  userName: 'test',
  email: 'test@e2e.com',
  password: '12345678',
  userId: 'usrTestUserId',
  spaceId: 'spcTestSpaceId',
  baseId: 'bseTestBaseId',
  driver: DriverClient.Pg,
};

function compileWorkerFile() {
  const entryFile = path.join(__dirname, 'src/worker/**.ts');
  const outFile = path.join(__dirname, 'dist/worker');

  buildSync({
    entryPoints: [entryFile],
    outdir: outFile,
    bundle: true,
    platform: 'node',
    target: 'node20',
  });
}

async function setup() {
  dotenv.config({ path: '../nextjs-app' });

  // Use sync mode for v2 computed updates in tests
  process.env.V2_COMPUTED_UPDATE_MODE = 'sync';

  if (!process.env.CONDITIONAL_QUERY_MAX_LIMIT) {
    process.env.CONDITIONAL_QUERY_MAX_LIMIT = '7';
  }
  if (!process.env.CONDITIONAL_QUERY_DEFAULT_LIMIT) {
    process.env.CONDITIONAL_QUERY_DEFAULT_LIMIT = process.env.CONDITIONAL_QUERY_MAX_LIMIT;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const databaseUrl = process.env.PRISMA_DATABASE_URL!;

  console.log('database-url: ', databaseUrl);
  const { driver } = parseDsn(databaseUrl);
  console.log('driver: ', driver);
  globalThis.testConfig.driver = driver;

  compileWorkerFile();
}

export default setup();
