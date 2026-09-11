import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Prisma migrate deploy uses blocking pg_advisory_lock(72707369). A waiter on
// that lock is a live virtual transaction, so CREATE INDEX CONCURRENTLY in the
// lock holder deadlocks (prisma-engines#5755). Teable therefore serializes
// migrate deploy with pg_try_advisory_lock on a different key and disconnects
// between retries so waiters never sit blocked.
export const PRISMA_MIGRATE_ADVISORY_LOCK_KEY = 72707369;
export const TEABLE_MIGRATE_ADVISORY_LOCK_KEY = 71110001;

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootFromScripts = path.resolve(scriptsDir, '..');

export const loadPg = (appRoot = process.env.APP_ROOT ?? repoRootFromScripts) => {
  const candidates = [
    path.join(appRoot, 'community/packages/db-main-prisma/package.json'),
    path.join(appRoot, 'packages/db-main-prisma/package.json'),
    path.join(appRoot, 'enterprise/backend-ee/package.json'),
    path.join(appRoot, 'apps/nestjs-backend/package.json'),
    fileURLToPath(import.meta.url),
  ];

  const errors = [];
  for (const candidate of candidates) {
    try {
      return createRequire(candidate)('pg');
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  throw new Error(
    `Unable to load pg for Teable migrate locking. Tried:\n${errors.join('\n')}`
  );
};

const isLocked = (value) => value === true || value === 't';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const withPostgresMigrateLock = async ({
  connectionString,
  run,
  pg: pgModule,
  lockKey = TEABLE_MIGRATE_ADVISORY_LOCK_KEY,
  retryDelayMs = Number(process.env.TEABLE_MIGRATE_LOCK_RETRY_MS) || 2000,
  log = console.log,
}) => {
  if (!connectionString) {
    throw new Error('Missing database url for Teable migrate lock');
  }

  const { Client } = pgModule ?? loadPg();

  for (;;) {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [
        lockKey,
      ]);
      if (!isLocked(rows[0]?.locked)) {
        log(
          'Another Teable instance is running database migrations; waiting to retry...'
        );
      } else {
        try {
          return await run();
        } finally {
          try {
            await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
          } catch {
            // Session close also releases the lock.
          }
        }
      }
    } finally {
      await client.end().catch(() => {});
    }

    await sleep(retryDelayMs);
  }
};
