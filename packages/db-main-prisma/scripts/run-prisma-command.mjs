#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const metaDatabaseUrl =
  process.env.PRISMA_META_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;

const result = spawnSync('pnpm', ['prisma', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: metaDatabaseUrl
    ? {
        ...process.env,
        PRISMA_DATABASE_URL: metaDatabaseUrl,
      }
    : process.env,
  shell: process.platform === 'win32',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
