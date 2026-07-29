import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool, PoolClient, QueryResult } from 'pg';

const prismaTextCompatibleTypeOids = new Set([
  19, // name: PostgreSQL catalog and information_schema identifiers
]);
const postgresTextTypeOid = 25;

const normalizeQueryResult = <T extends QueryResult | QueryResult[]>(result: T): T => {
  if (Array.isArray(result)) {
    return result.map((item) => normalizeQueryResult(item)) as T;
  }

  if (!result.fields.some((field) => prismaTextCompatibleTypeOids.has(field.dataTypeID))) {
    return result;
  }

  return {
    ...result,
    fields: result.fields.map((field) =>
      prismaTextCompatibleTypeOids.has(field.dataTypeID)
        ? { ...field, dataTypeID: postgresTextTypeOid }
        : field
    ),
  } as T;
};

const wrapQueryable = <T extends Pool | PoolClient>(queryable: T): T =>
  new Proxy(queryable, {
    get(target, property, receiver) {
      if (property === 'query') {
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(target.query, target, args);
          return normalizeQueryResult(result);
        };
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

/**
 * Prisma 6.2's pg adapter rejects PostgreSQL's textual `name` OID before its
 * configured type parser runs. Keep the process-owned pool untouched for
 * Knex/Kysely while normalizing result metadata only on Prisma's view.
 */
export const createPrismaPgAdapter = (pool: Pool, schema?: string): PrismaPg => {
  const prismaPool = new Proxy(pool, {
    get(target, property, receiver) {
      if (property === 'connect') {
        return async () => wrapQueryable(await target.connect());
      }
      if (property === 'query') {
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(target.query, target, args);
          return normalizeQueryResult(result);
        };
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return new PrismaPg(prismaPool, schema ? { schema } : undefined);
};

export const normalizePrismaPgQueryResult = normalizeQueryResult;
