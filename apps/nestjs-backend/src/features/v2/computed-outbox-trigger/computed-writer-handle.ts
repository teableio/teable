import { createHash } from 'node:crypto';
import { resolveComputedOutboxWriterConcurrency } from '../../../configs/computed-outbox-trigger.config';

export type ComputedWriterHandle = {
  key: string;
  hasWaiters: () => boolean;
  maxConcurrency?: number;
};

type PoolRuntimeShape = {
  waitingCount: number;
  totalCount?: number;
  idleCount?: number;
  options?: {
    host?: string;
    port?: number | string;
    max?: number;
    database?: string;
  };
};

const extractLibpqDatabase = (dsn: string): string => {
  const match = /(?:^|\s)(?:dbname|database)=('[^']*'|\S+)/i.exec(dsn);
  if (!match?.[1]) return '';
  return match[1].replace(/^'|'$/g, '').trim();
};

const resolveComputedWriterEndpoint = (
  pool: PoolRuntimeShape,
  dataConnectionString: string
): { host: string; port: string; database: string; poolMax?: number } => {
  const rawPoolMax = pool.options?.max;
  const poolMax =
    typeof rawPoolMax === 'number' && Number.isFinite(rawPoolMax) && rawPoolMax > 0
      ? Math.trunc(rawPoolMax)
      : undefined;
  const optionDb = pool.options?.database?.trim() ?? '';
  try {
    const endpoint = new URL(dataConnectionString);
    const host = (
      endpoint.searchParams.get('host') ||
      endpoint.hostname ||
      pool.options?.host ||
      ''
    ).toLowerCase();
    const port = String(
      endpoint.searchParams.get('port') || endpoint.port || pool.options?.port || '5432'
    );
    const urlDb = decodeURIComponent(endpoint.pathname.replace(/^\/+/, '')).trim();
    const database = urlDb || optionDb;
    if (host) return { host, port, database, poolMax };
  } catch {
    // Multi-host URLs and libpq key=value DSNs are valid pg strings that fail URL().
  }
  const poolHost = pool.options?.host?.trim().toLowerCase();
  const poolPort = pool.options?.port != null ? String(pool.options.port) : '5432';
  const libpqDb = extractLibpqDatabase(dataConnectionString) || optionDb;
  if (poolHost) return { host: poolHost, port: poolPort, database: libpqDb, poolMax };
  return {
    host: `dsn:${createHash('sha256').update(dataConnectionString).digest('hex').slice(0, 16)}`,
    port: poolPort,
    database: libpqDb,
    poolMax,
  };
};

export const createComputedWriterHandle = (
  pool: PoolRuntimeShape,
  dataConnectionString: string
): ComputedWriterHandle => {
  const { host, port, database, poolMax } = resolveComputedWriterEndpoint(
    pool,
    dataConnectionString
  );
  return {
    key: createHash('sha256')
      .update(JSON.stringify([host, port, database]))
      .digest('hex'),
    maxConcurrency: resolveComputedOutboxWriterConcurrency(process.env, poolMax),
    hasWaiters: () =>
      pool.waitingCount > 0 ||
      (poolMax !== undefined &&
        poolMax >= 1 &&
        (pool.totalCount ?? 0) - (pool.idleCount ?? 0) >= Math.max(1, poolMax - 1)),
  };
};
