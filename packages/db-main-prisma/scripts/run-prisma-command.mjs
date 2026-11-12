#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const metaDatabaseUrl =
  process.env.PRISMA_META_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;

// Run this package's own Prisma CLI with the current Node binary, not `pnpm prisma`:
// containers run `migrate deploy` through here on every start, and a Corepack-installed
// pnpm >= 11 downloads its native binary from the npm registry on first use, which
// fails on self-hosted installs without internet access.
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

const result = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: metaDatabaseUrl
    ? {
        ...process.env,
        PRISMA_DATABASE_URL: metaDatabaseUrl,
      }
    : process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
