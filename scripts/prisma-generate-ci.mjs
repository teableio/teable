#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

/**
 * Shared `prisma generate` for package `prisma-generate-ci` scripts.
 * Docker/CI set TEABLE_SKIP_PRISMA_GENERATE=1 after a serial generate so
 * parallel `pnpm -r run build` does not race on the shared
 * `node_modules/.prisma/client` output (truncated index.d.ts).
 */
if (process.env.TEABLE_SKIP_PRISMA_GENERATE === '1') {
  process.exit(0);
}

const schema = process.argv[2];
if (!schema) {
  console.error('usage: prisma-generate-ci.mjs <schema-path>');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'prisma', 'generate', '--schema', schema], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PRISMA_DATABASE_URL:
      process.env.PRISMA_DATABASE_URL ??
      'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public',
  },
  shell: process.platform === 'win32',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
