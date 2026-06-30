#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const command = process.argv[2];

// `generate` only reads the schema to emit the client — it never connects to the
// database, so it must work without a url. Every other command (migrate, db push,
// studio, …) talks to a live database and requires one.
const requiresDatabaseUrl = command !== 'generate';

const dataDatabaseUrl =
  process.env.PRISMA_META_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;

if (requiresDatabaseUrl && !dataDatabaseUrl) {
  console.error(
    'Missing data database url (PRISMA_META_DATABASE_URL, PRISMA_DATABASE_URL, DATABASE_URL)'
  );
  process.exit(1);
}

const result = spawnSync('pnpm', ['prisma', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PRISMA_DATABASE_URL: dataDatabaseUrl,
  },
  shell: process.platform === 'win32',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
