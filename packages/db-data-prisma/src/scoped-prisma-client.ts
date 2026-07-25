import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { Prisma, PrismaClient } from './generated/client';

const resolvePoolMax = (connectionString: string): number => {
  try {
    const value = new URL(connectionString).searchParams.get('connection_limit');
    const parsed = value ? Number.parseInt(value, 10) : NaN;
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  } catch {
    // Let pg report malformed connection strings with its normal error.
  }

  const configured = Number.parseInt(process.env.BYODB_DATA_DB_POOL_MAX ?? '', 10);
  return Number.isInteger(configured) && configured > 0 ? configured : 5;
};

const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

type ScopedTransaction = <T>(
  fn: (prisma: Prisma.TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }
) => Promise<T>;

export type ScopedDataPrismaClient = PrismaClient & {
  txClient(): Prisma.TransactionClient;
  $tx: ScopedTransaction;
};

/**
 * Creates a Prisma data client that never depends on PostgreSQL startup or
 * session-level `search_path` state. Generated queries use the adapter schema;
 * raw queries run with `SET LOCAL` inside the same transaction, which also
 * works through transaction poolers.
 */
export const createScopedDataPrismaClient = (
  connectionString: string,
  schema: string
): ScopedDataPrismaClient => {
  const pool = new Pool({
    connectionString,
    max: resolvePoolMax(connectionString),
  });
  const client = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  const setLocalSearchPath = `
    SELECT set_config(
      'search_path',
      format('%I, public', ${quoteLiteral(schema)}) || COALESCE((
        SELECT ', ' || quote_ident(n.nspname)
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_trgm'
      ), ''),
      true
    )
  `;

  const scopedTransaction: ScopedTransaction = (fn, options) =>
    client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(setLocalSearchPath);
      return await fn(transaction);
    }, options);

  let proxy: ScopedDataPrismaClient;
  let disconnected = false;

  proxy = new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'txClient') return () => proxy;
      if (property === '$tx') return scopedTransaction;
      if (property === '$transaction') {
        return (input: unknown, options?: Parameters<ScopedTransaction>[1]) =>
          typeof input === 'function'
            ? scopedTransaction(input as Parameters<ScopedTransaction>[0], options)
            : target.$transaction(input as never, options as never);
      }
      if (property === '$queryRawUnsafe') {
        return <T = unknown>(query: string, ...values: unknown[]) =>
          scopedTransaction((transaction) => transaction.$queryRawUnsafe<T>(query, ...values));
      }
      if (property === '$executeRawUnsafe') {
        return (query: string, ...values: unknown[]) =>
          scopedTransaction((transaction) => transaction.$executeRawUnsafe(query, ...values));
      }
      if (property === '$queryRaw') {
        return (...args: unknown[]) =>
          scopedTransaction((transaction) => transaction.$queryRaw(...(args as [never])));
      }
      if (property === '$executeRaw') {
        return (...args: unknown[]) =>
          scopedTransaction((transaction) => transaction.$executeRaw(...(args as [never])));
      }
      if (property === '$disconnect') {
        return async () => {
          if (disconnected) return;
          disconnected = true;
          try {
            await target.$disconnect();
          } finally {
            await pool.end();
          }
        };
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ScopedDataPrismaClient;

  return proxy;
};
