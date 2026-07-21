import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv-flow';
import { buildSync } from 'esbuild';
import { provisionWorkerDatabases } from './test/utils/e2e-shared';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Runs once in the vitest main process, after `pre-test-e2e` seeded the template
 * database and before any worker spawns:
 * - compile the worker bundle once so parallel workers don't race in buildSync
 * - clone the template database once per worker so spec files can run in
 *   parallel without sharing state
 */
export default async function globalSetup() {
  // Workers load this via their setup file; the main process needs it here so
  // provisionWorkerDatabases can see the redis URIs to flush.
  dotenv.config({ path: '../nextjs-app', node_env: process.env.NODE_ENV || 'test' });

  buildSync({
    entryPoints: [path.join(dirname, 'src/worker/**.ts')],
    outdir: path.join(dirname, 'dist/worker'),
    bundle: true,
    platform: 'node',
    target: 'node20',
  });
  process.env.E2E_WORKER_PREBUILT = '1';

  await provisionWorkerDatabases();
}
