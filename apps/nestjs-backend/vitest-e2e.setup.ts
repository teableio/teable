import { DriverClient, parseDsn } from '@teable-group/core';
import dotenv from 'dotenv-flow';

interface ITestConfig {
  driver: string;
  email: string;
  userId: string;
  password: string;
  spaceId: string;
  baseId: string;
}

declare global {
  // eslint-disable-next-line no-var
  var testConfig: ITestConfig;
}

// Set global variables (if needed)
globalThis.testConfig = {
  email: 'test@e2e.com',
  password: '12345678',
  userId: 'usrTestUserId',
  spaceId: 'spcTestSpaceId',
  baseId: 'bseTestBaseId',
  driver: DriverClient.Sqlite,
};

async function setup() {
  console.log('node-env', process.env.NODE_ENV);
  dotenv.config({ path: '../nextjs-app' });

  // const { email, password, spaceId, baseId, userId } = globalThis.testConfig;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const databaseUrl = process.env.PRISMA_DATABASE_URL!;

  console.log('database-url: ', databaseUrl);
  const { driver } = parseDsn(databaseUrl);
  console.log('driver: ', driver);
  globalThis.testConfig.driver = driver;
}

export default setup();
