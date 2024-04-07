import fs from 'fs';
import path from 'path';
import { DriverClient, getRandomString, parseDsn } from '@teable/core';
import dotenv from 'dotenv-flow';

interface ITestConfig {
  driver: string;
  email: string;
  userName: string;
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
  userName: 'test',
  email: 'test@e2e.com',
  password: '12345678',
  userId: 'usrTestUserId',
  spaceId: 'spcTestSpaceId',
  baseId: 'bseTestBaseId',
  driver: DriverClient.Sqlite,
};

function prepareSqliteEnv() {
  if (!process.env.PRISMA_DATABASE_URL?.startsWith('file:')) {
    return;
  }
  const prevFilePath = process.env.PRISMA_DATABASE_URL.substring(5);
  const prevDir = path.dirname(prevFilePath);
  const baseName = path.basename(prevFilePath);

  const newFileName = 'test-' + getRandomString(12) + '-' + baseName;
  const newFilePath = path.join(prevDir, 'test', newFileName);

  process.env.PRISMA_DATABASE_URL = 'file:' + newFilePath;
  console.log('TEST PRISMA_DATABASE_URL:', process.env.PRISMA_DATABASE_URL);

  const dbPath = '../../packages/db-main-prisma/db/';
  const testDbPath = path.join(dbPath, 'test');
  if (!fs.existsSync(testDbPath)) {
    fs.mkdirSync(testDbPath, { recursive: true });
  }
  fs.copyFileSync(path.join(dbPath, baseName), path.join(testDbPath, newFileName));
}

async function setup() {
  console.log('node-env', process.env.NODE_ENV);
  dotenv.config({ path: '../nextjs-app' });

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const databaseUrl = process.env.PRISMA_DATABASE_URL!;

  console.log('database-url: ', databaseUrl);
  const { driver } = parseDsn(databaseUrl);
  console.log('driver: ', driver);
  globalThis.testConfig.driver = driver;

  prepareSqliteEnv();
}

export default setup();
