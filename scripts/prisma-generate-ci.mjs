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

// Sonar S4036 (reported on the command-name argument): developer/CLI script on a trusted machine; the executable is resolved through PATH by design
const result = spawnSync(
  'pnpm', // NOSONAR javascript:S4036 -- executable resolved through PATH by design (see above)
  ['exec', 'prisma', 'generate', '--schema', schema],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      // `prisma generate` never opens a connection; the schema only needs the env var to resolve.
      // Use a credential-free placeholder instead of a real-looking password.
      PRISMA_DATABASE_URL:
        process.env.PRISMA_DATABASE_URL ??
        'postgresql://prisma-generate@127.0.0.1:5432/prisma-generate?schema=public',
    },
    shell: process.platform === 'win32',
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
