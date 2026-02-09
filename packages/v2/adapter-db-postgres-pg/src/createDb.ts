/* eslint-disable @typescript-eslint/naming-convention */
import { Kysely, PostgresDialect } from 'kysely';
import type { IV2PostgresDbConfig } from './config';

// Use webpack's special require that bypasses bundling, falling back to dynamic import
// This is needed because webpack transforms dynamic imports in ways that bypass
// OpenTelemetry's module instrumentation (require-in-the-middle).
// By using native require, we ensure pg is properly instrumented for tracing.
declare const __non_webpack_require__: NodeRequire | undefined;
const useNativeRequire = typeof __non_webpack_require__ !== 'undefined';

const loadPg = async (): Promise<typeof import('pg')> => {
  if (useNativeRequire) {
    // In webpack environment, use native require to ensure OTel instrumentation works
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Promise.resolve(__non_webpack_require__!('pg') as any);
  }
  // In non-webpack environment (playground, tests), use standard import
  return import('pg');
};

const createPgDb = async <DB>(config: IV2PostgresDbConfig): Promise<Kysely<DB>> => {
  const connectionString = config.pg.connectionString;
  if (!connectionString) {
    throw new Error('Missing pg.connectionString');
  }

  // Use loadPg to ensure OTel instrumentation works in webpack environment
  const pg = await loadPg();
  const Pool = pg.Pool ?? (hasPgDefault(pg) ? pg.default.Pool : undefined);
  if (!Pool) {
    throw new Error('Missing pg.Pool');
  }

  const poolOptions = resolvePoolOptions(config);

  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool(poolOptions),
    }),
  });
};

export const createV2PostgresDb = async <DB = unknown>(
  config: IV2PostgresDbConfig
): Promise<Kysely<DB>> => {
  return createPgDb<DB>(config);
};

type PgDefaultExport = { Pool: typeof import('pg').Pool };

const hasPgDefault = (
  value: typeof import('pg')
): value is typeof import('pg') & {
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
