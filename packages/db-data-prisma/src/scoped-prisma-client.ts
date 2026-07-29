import { createPrismaPgAdapter, type IPgPoolLease } from '@teable/db-main-prisma';

import { Prisma, PrismaClient } from './generated/client';

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
  poolLease: IPgPoolLease,
  schema: string
): ScopedDataPrismaClient => {
  const client = new PrismaClient({ adapter: createPrismaPgAdapter(poolLease.pool, schema) });
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
            await poolLease.release();
          }
        };
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ScopedDataPrismaClient;

  return proxy;
};
