#!/usr/bin/env zx
import { parseDsn as parse } from '@httpx/dsn-parser';

const env = $.env;
let isCi = ['true', '1'].includes(env?.CI ?? '');

const buildVersion = env.BUILD_VERSION;
const databaseUrl = env.PRISMA_DATABASE_URL;

const parseDsn = (dsn) => {
  const parsedDsn = parse(dsn);

  if (!parsedDsn.success) {
    throw new Error(`DATABASE_URL ${parsedDsn.reason}`);
  }
  if (!parsedDsn.value.port) {
    throw new Error(`DATABASE_URL must provide a port`);
  }

  return parsedDsn.value;
};

const pgMigrate = async () => {
  cd('postgres_migrate');
  return await $`prisma migrate deploy`;
};

const killMe = async () => {
  await $`exit 0`;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const retryOperation = async (operation, maxRetries = 5, delay = 3000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      console.log(`Attempt ${attempt} failed. Retrying in ${delay/1000} seconds...`);
      await sleep(delay);
    }
  }
};

console.log(`DB Migrate Version: ${buildVersion}`);
await $`prisma -v`;

const { driver, host, port } = parseDsn(databaseUrl);

const adapters = {
  postgresql: pgMigrate,
  postgres: pgMigrate,
};

if (!driver || !adapters[driver]) {
  throw new Error(`Adapter ${driver} is not allowed`);
}

console.log(`wait-for  ${host}:${port} 【${driver}】deploying.`);

try {
  await retryOperation(async () => {
    const result =
    await $`scripts/wait-for ${host}:${port} --timeout=15 -- echo 'database driver:【${driver}】started successfully.'`;
    if (result.exitCode !== 0) {
      console.error(`database driver:【${driver}】, startup exception is about to exit.`);
      throw new Error(result.stderr);
    }

    console.log(`database driver:【${driver}】, ready to start migration.`);

    await adapters[driver]();
    console.log(`database driver:【${driver}】, migration success.`);
  });
} catch (p) {
  console.error(`Exit code: ${p.exitCode}`);
  console.error(`Migrate Deploy Error: ${p.stderr}`);
  await killMe();
}
