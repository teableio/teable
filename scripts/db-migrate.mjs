#!/usr/bin/env zx
import { $ } from 'zx';
import { parseDsn as parse } from '@soluble/dsn-parser';

const databaseUrl = process.env.PRISMA_DATABASE_URL;

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

await $`prisma -v`;

const { driver, host, port } = parseDsn(databaseUrl);

const adapters = {
  postgresql: pgMigrate,
  postgres: pgMigrate,
};

if (!driver || !adapters[driver]) {
  throw new Error(`Adapter ${driver} is not allowed`);
}

const result =
  await $`scripts/wait-for ${host}:${port} --timeout=15 -- echo 'database driver:【${driver}】started successfully.'`;
if (result.exitCode !== 0) {
  console.error(`database driver:【${driver}】, startup exception is about to exit.`);
  await killMe();
}

console.log(`database driver:【${driver}】, ready to start migration.`);

try {
  await adapters[driver]();
  console.log(`database driver:【${driver}】, migration success.`);
} catch (p) {
  console.error(`Exit code: ${p.exitCode}`);
  console.error(`Migrate Deploy Error: ${p.stderr}`);
}
