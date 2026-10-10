#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const metaDatabaseUrl =
  process.env.PRISMA_META_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;

// Sonar S4036 (reported on the command-name argument): developer/CLI script on a trusted machine; the executable is resolved through PATH by design
const result = spawnSync(
  'pnpm', // NOSONAR javascript:S4036 -- executable resolved through PATH by design (see above)
  ['prisma', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: metaDatabaseUrl
      ? {
          ...process.env,
          PRISMA_DATABASE_URL: metaDatabaseUrl,
        }
      : process.env,
    shell: process.platform === 'win32',
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
