#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const dataDatabaseUrl =
  process.env.PRISMA_DATA_DATABASE_URL ??
  process.env.PRISMA_META_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;

if (!dataDatabaseUrl) {
  console.error(
    'Missing data database url (PRISMA_DATA_DATABASE_URL, PRISMA_META_DATABASE_URL, PRISMA_DATABASE_URL, DATABASE_URL)'
  );
  process.exit(1);
}

const result = spawnSync('pnpm', ['prisma', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PRISMA_DATA_DATABASE_URL: dataDatabaseUrl,
  },
  shell: process.platform === 'win32',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
