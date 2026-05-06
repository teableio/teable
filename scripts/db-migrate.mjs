#!/usr/bin/env zx
import 'zx/globals'

const env = $.env;
const metaDatabaseUrl = env.PRISMA_META_DATABASE_URL ?? env.PRISMA_DATABASE_URL;
const dataDatabaseUrl = env.PRISMA_DATA_DATABASE_URL ?? metaDatabaseUrl;

const parseDsn = (dsn, label) => {
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
    throw new Error(`Invalid ${label} database url: ${error.message}`);
  }
};

const migrateWorkspace = async ({ label, packageName, schema }) => {
  console.log(`Running ${label} database migration...`);
  const result = await $({ cwd: '/app' })`pnpm -F ${packageName} prisma-migrate deploy --schema ${schema}`;
  console.log(`${label} database migration completed:`, result);
  return result;
};

const pgMigrate = async () => {
  await migrateWorkspace({
    label: 'meta',
    packageName: '@teable/db-main-prisma',
    schema: './prisma/postgres/schema.prisma',
  });
  await migrateWorkspace({
    label: 'data',
    packageName: '@teable/db-data-prisma',
    schema: './prisma/schema.prisma',
  });
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
const targets = [
  { label: 'meta', url: metaDatabaseUrl },
  { label: 'data', url: dataDatabaseUrl },
];

for (const target of targets) {
  if (!target.url) {
    throw new Error(`Missing ${target.label} database url`);
  }
}

const parsedTargets = targets.map((target) => ({
  ...target,
  ...parseDsn(target.url, target.label),
}));

const adapters = {
  postgresql: pgMigrate,
  postgres: pgMigrate,
};

for (const { label, driver, host, port } of parsedTargets) {
  if (!driver || !adapters[driver]) {
    throw new Error(`Adapter ${driver} for ${label} database is not allowed`);
  }
  console.log(`wait-for ${host}:${port} [${label}/${driver}] deploying.`);
}

try {
  await retryOperation(async () => {
    await adapters[parsedTargets[0].driver]();
    console.log('database migrations completed successfully.');
  });
} catch (p) {
  console.error(`Exit code: ${p.exitCode}`);
  console.error(`Migrate Deploy Error: ${p.stderr}`);
  await $`exit 1`;
}
