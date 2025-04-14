#!/usr/bin/env zx
import 'zx/globals'

const env = $.env;
let isCi = ['true', '1'].includes(env?.CI ?? '');

const databaseUrl = env.PRISMA_DATABASE_URL;

const parseDsn = (dsn) => {
  try {
    const url = new URL(dsn);
    const driver = url.protocol.replace(':', '');
    
    if (!['postgresql', 'postgres'].includes(driver)) {
      throw new Error(`Unsupported database driver: ${driver}`);
    }

    return {
      driver,
      host: url.hostname,
      port: parseInt(url.port, 10),
    };
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL: ${error.message}`);
  }
};

const pgMigrate = async () => {
  console.log('Current working directory:', process.cwd());
  console.log('Running migration...');
  const result = await $({cwd: '/app/packages/db-main-prisma'})`npx prisma migrate deploy --schema ./prisma/postgres/schema.prisma`;
  console.log('Migration command completed:', result);
  return result;
};

const killMe = async () => {
  await $`exit 1`;
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

console.log(`DB Migrate Starting...`);
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
    await adapters[driver]();
    console.log(`database driver:【${driver}】, migration success.`);
  });
} catch (p) {
  console.error(`Exit code: ${p.exitCode}`);
  console.error(`Migrate Deploy Error: ${p.stderr}`);
  await killMe();
}
