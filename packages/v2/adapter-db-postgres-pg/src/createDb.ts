/* eslint-disable @typescript-eslint/naming-convention */
import { Kysely, PostgresDialect } from 'kysely';
import type * as Pg from 'pg';
import { createCancellablePool } from './cancellablePool';
import type { PostgresProtocolConnectionConstructor } from './cancelRequest';
import type { IV2PostgresDbConfig } from './config';

// Use webpack's special require that bypasses bundling, falling back to dynamic import
// This is needed because webpack transforms dynamic imports in ways that bypass
// OpenTelemetry's module instrumentation (require-in-the-middle).
// By using native require, we ensure pg is properly instrumented for tracing.
declare const __non_webpack_require__: NodeRequire | undefined;
const useNativeRequire = typeof __non_webpack_require__ !== 'undefined';

export const loadPg = async (): Promise<typeof Pg> => {
  if (useNativeRequire) {
    // In webpack environment, use native require to ensure OTel instrumentation works
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return __non_webpack_require__!('pg') as any;
  }
  // In non-webpack environment (playground, tests), use standard import
  return import('pg');
};

export interface IV2PostgresDbDependencies {
  pool?: Pg.Pool;
  /** For an owned maintenance-only pool. A deadline destroys the checked-out session. */
  maintenanceStatementDeadlineMs?: number;
}

// The work pool may have no free connections while DDL runs. Share one independent probe
// between concurrent slow statements on this route.
const createMaintenanceProbe = (Pool: typeof Pg.Pool, connectionString: string) => {
  let pending: Promise<void> | undefined;
  const check = async () => {
    const probe = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
    });
    probe.on('error', handlePgPoolError);
    try {
      await probe.query('SELECT 1');
    } catch (error) {
      // Admission errors alone do not establish that an existing session is unresponsive.
      if (
        error instanceof Error &&
        (/connection timeout|timeout expired|timeout exceeded when trying to connect|query read timeout/i.test(
          error.message
        ) ||
          ('code' in error &&
            ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(String(error.code))))
      ) {
        throw Object.assign(
          new Error('PostgreSQL maintenance connection probe failed', { cause: error }),
          { code: 'ETIMEDOUT' }
        );
      }
    } finally {
      await probe.end();
    }
  };
  return () =>
    (pending ??= check().finally(() => {
      pending = undefined;
    }));
};

const createPgDb = async <DB>(
  config: IV2PostgresDbConfig,
  dependencies: IV2PostgresDbDependencies
): Promise<Kysely<DB>> => {
  const connectionString = config.pg.connectionString;
  if (!connectionString) {
    throw new Error('Missing pg.connectionString');
  }
  const deadlineMs = dependencies.maintenanceStatementDeadlineMs;
  if (
    deadlineMs !== undefined &&
    (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 2_147_483_647)
  ) {
    throw new Error('Maintenance statement deadline must be between 1 and 2147483647 ms');
  }
  if (deadlineMs !== undefined && dependencies.pool) {
    throw new Error('Maintenance statement deadlines require a dedicated owned pool');
  }

  // Use loadPg to ensure OTel instrumentation works in webpack environment
  const pg = await loadPg();
  const Pool = pg.Pool ?? (hasPgDefault(pg) ? pg.default.Pool : undefined);
  if (!Pool) {
    throw new Error('Missing pg.Pool');
  }

  const poolOptions = resolvePoolOptions(config);
  if (deadlineMs !== undefined && config.pg.pool?.max === undefined) poolOptions.max = 2;
  if (deadlineMs !== undefined && !poolOptions.connectionTimeoutMillis) {
    poolOptions.connectionTimeoutMillis = 10_000;
  }
  const pool = dependencies.pool ?? new Pool(poolOptions);
  if (!dependencies.pool) {
    pool.on('error', handlePgPoolError);
  }
  const Connection = pg.Connection ?? (hasPgDefault(pg) ? pg.default.Connection : undefined);
  if (!Connection) throw new Error('Missing pg.Connection');
  const dialectPool = createCancellablePool(
    pool,
    Connection as unknown as PostgresProtocolConnectionConstructor,
    !dependencies.pool,
    deadlineMs,
    deadlineMs === undefined ? undefined : createMaintenanceProbe(Pool, connectionString)
  );

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: dialectPool,
    }),
  });
  return config.pg.schema ? db.withSchema(config.pg.schema) : db;
};

export const createV2PostgresDb = async <DB = unknown>(
  config: IV2PostgresDbConfig,
  dependencies: IV2PostgresDbDependencies = {}
): Promise<Kysely<DB>> => {
  return createPgDb<DB>(config, dependencies);
};

type PgDefaultExport = {
  Pool: typeof Pg.Pool;
  Connection: typeof Pg.Connection;
};

export const hasPgDefault = (
  value: typeof Pg
): value is typeof Pg & {
  default: PgDefaultExport;
} => {
  return 'default' in value && !!value.default && 'Pool' in value.default;
};

type PgPoolOptions = {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  maxUses?: number;
  allowExitOnIdle?: boolean;
};

type PgPoolError = Error & { code?: string };

const ignoredPgPoolErrorCodes = new Set(['57P01', '57P02']);

export const shouldIgnorePgPoolError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const code = (error as PgPoolError).code;
  return typeof code === 'string' && ignoredPgPoolErrorCodes.has(code);
};

export const handlePgPoolError = (error: unknown): void => {
  if (shouldIgnorePgPoolError(error)) {
    return;
  }
  console.error('[v2-adapter-db-postgres-pg] Unexpected idle pg pool error', error);
};

const resolvePoolOptions = (config: IV2PostgresDbConfig): PgPoolOptions => {
  const { connectionString, pool } = config.pg;
  const poolOptions: PgPoolOptions = { connectionString, ...pool };

  // Align with v1: if connection_limit is present in the DSN, use it as pool max.
  if (poolOptions.max == null) {
    const maxFromDsn = readConnectionLimit(connectionString);
    poolOptions.max = maxFromDsn ?? 20;
  }

  return poolOptions;
};

const readConnectionLimit = (connectionString: string): number | undefined => {
  try {
    const url = new URL(connectionString);
    const value = url.searchParams.get('connection_limit');
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
};
