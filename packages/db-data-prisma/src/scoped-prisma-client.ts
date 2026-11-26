import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createPrismaPgAdapter,
  type IPgPoolLease,
  type MetaPrismaService,
} from '@teable/db-main-prisma';

import { Prisma, PrismaClient } from './generated/client';
import { getDataTransactionMaxWait, getDataTransactionTimeout } from './utils';

const setLocalSearchPath = `
  pg_catalog.set_config(
    'search_path',
    pg_catalog.format('%I, public', $1::text) || COALESCE((
      SELECT ', ' || pg_catalog.quote_ident(n.nspname)
      FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pg_trgm'
    ), ''),
    true
  )
`;
const applyLocalSearchPath = `SELECT ${setLocalSearchPath}`;

type SearchPathTransaction = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};

/** Apply scoped raw-query name resolution to an already-open transaction. */
export const withDataSchemaSearchPath = async <T>(
  transaction: SearchPathTransaction,
  schema: string,
  run: () => Promise<T>
): Promise<T> => {
  await transaction.$executeRawUnsafe('SAVEPOINT teable_data_search_path');
  try {
    const [previous] = await transaction.$queryRawUnsafe<[{ search_path: string }]>(
      `WITH previous AS MATERIALIZED (
        SELECT pg_catalog.current_setting('search_path') AS search_path
      )
      SELECT previous.search_path, ${setLocalSearchPath} FROM previous`,
      schema
    );
    const result = await run();
    await transaction.$executeRawUnsafe(
      `SELECT pg_catalog.set_config('search_path', $1::text, true)`,
      previous.search_path
    );
    await transaction.$executeRawUnsafe('RELEASE SAVEPOINT teable_data_search_path');
    return result;
  } catch (error) {
    // Rollback restores the prior path even after a SQL error aborts the savepoint.
    try {
      await transaction.$executeRawUnsafe('ROLLBACK TO SAVEPOINT teable_data_search_path');
      await transaction.$executeRawUnsafe('RELEASE SAVEPOINT teable_data_search_path');
    } catch {
      // The transaction may already be closed. Preserve the original error.
    }
    throw error;
  }
};

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
  getSharedPoolSchema(metadata: Pick<MetaPrismaService, 'usesPgPool'>): string | undefined;
  afterCommit(callback: () => Promise<void>): boolean;
  afterRollback(callback: () => Promise<void>): boolean;
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
  const getSharedPoolSchema: ScopedDataPrismaClient['getSharedPoolSchema'] = (metadata) =>
    metadata.usesPgPool(poolLease.pool) ? schema : undefined;

  const activeTransaction = new AsyncLocalStorage<{
    client: Prisma.TransactionClient;
    afterCommitCallbacks: Array<() => Promise<void>>;
    afterRollbackCallbacks?: Array<() => Promise<void>>;
  }>();
  let disconnected = false;
  let activeRootTransactions = 0;
  let physicalClose: Promise<void> | undefined;
  let retirementWait: Promise<void> | undefined;
  let resolveRetirement: (() => void) | undefined;
  let rejectRetirement: ((error: unknown) => void) | undefined;
  const closePhysicalClient = (): Promise<void> => {
    physicalClose ??= (async () => {
      try {
        await client.$disconnect();
      } finally {
        await poolLease.release();
      }
    })();
    return physicalClose;
  };
  const assertAvailable = () => {
    if (disconnected) throw new Error('Scoped data database client has been retired');
  };
  const scopedTransaction: ScopedTransaction = async (fn, options) => {
    const owner = activeTransaction.getStore();
    if (owner) return fn(owner.client);
    assertAvailable();

    const ownerState: {
      afterCommitCallbacks: Array<() => Promise<void>>;
      afterRollbackCallbacks?: Array<() => Promise<void>>;
    } = { afterCommitCallbacks: [] };
    let committed = false;
    activeRootTransactions += 1;
    try {
      const result = await client.$transaction(
        async (transaction) => {
          await transaction.$executeRawUnsafe(applyLocalSearchPath, schema);
          return activeTransaction.run(Object.assign(ownerState, { client: transaction }), () =>
            fn(transaction)
          );
        },
        {
          ...options,
          timeout: options?.timeout ?? getDataTransactionTimeout(),
          maxWait: options?.maxWait ?? getDataTransactionMaxWait(),
        }
      );
      committed = true;
      for (const callback of ownerState.afterCommitCallbacks) await callback();
      return result;
    } finally {
      try {
        if (!committed) {
          for (const callback of ownerState.afterRollbackCallbacks ?? []) await callback();
        }
      } finally {
        activeRootTransactions -= 1;
        if (disconnected && activeRootTransactions === 0) {
          try {
            await closePhysicalClient();
            resolveRetirement?.();
          } catch (error) {
            rejectRetirement?.(error);
            throw error;
          }
        }
      }
    }
  };
  let proxy: ScopedDataPrismaClient;

  proxy = new Proxy(client, {
    has(target, property) {
      return property === 'getSharedPoolSchema' || Reflect.has(target, property);
    },
    get(target, property, receiver) {
      if (property === 'getSharedPoolSchema') return getSharedPoolSchema;
      if (property === 'txClient')
        return () => {
          const owner = activeTransaction.getStore();
          if (owner) return owner.client;
          assertAvailable();
          return proxy;
        };
      if (property === '$tx') return scopedTransaction;
      if (property === 'afterCommit') {
        return (callback: () => Promise<void>): boolean => {
          const owner = activeTransaction.getStore();
          if (!owner) return false;
          owner.afterCommitCallbacks.push(callback);
          return true;
        };
      }
      if (property === 'afterRollback') {
        return (callback: () => Promise<void>): boolean => {
          const owner = activeTransaction.getStore();
          if (!owner) return false;
          (owner.afterRollbackCallbacks ??= []).push(callback);
          return true;
        };
      }
      if (property === '$transaction') {
        return (input: unknown, options?: Parameters<ScopedTransaction>[1]) => {
          if (typeof input === 'function') {
            return scopedTransaction(input as Parameters<ScopedTransaction>[0], options);
          }
          assertAvailable();
          return target.$transaction(input as never, options as never);
        };
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
          disconnected = true;
          if (activeTransaction.getStore()) {
            // Awaiting the owner itself here would deadlock. Its outer finally closes us.
            return;
          }
          if (activeRootTransactions === 0) return closePhysicalClient();
          if (!retirementWait) {
            // The backend target/lib (ES2022) has no Promise.withResolvers; keep an explicit deferred.
            retirementWait = new Promise<void>((resolve, reject) => {
              resolveRetirement = resolve;
              rejectRetirement = reject;
            });
          }
          return retirementWait;
        };
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      if (value && typeof value === 'object' && 'findMany' in value) {
        return new Proxy(value, {
          get(delegate, method) {
            const operation = Reflect.get(delegate, method);
            if (typeof operation !== 'function') return operation;
            return (...args: unknown[]) => {
              const owner = activeTransaction.getStore();
              if (owner) {
                const transactionDelegate = Reflect.get(owner.client, property);
                return Reflect.get(transactionDelegate, method).apply(transactionDelegate, args);
              }
              assertAvailable();
              return operation.apply(delegate, args);
            };
          },
        });
      }
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          assertAvailable();
          return value.apply(target, args);
        };
      }
      return value;
    },
  }) as ScopedDataPrismaClient;

  return proxy;
};
