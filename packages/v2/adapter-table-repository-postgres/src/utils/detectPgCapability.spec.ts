import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type QueryResult,
} from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { assertTypeValidationPolyfill, hasPgInputIsValid } from './detectPgCapability';

const createTestDb = (executeQuery: (query: CompiledQuery) => Promise<QueryResult<unknown>>) =>
  new Kysely<V1TeableDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () =>
        ({
          async init() {},
          async acquireConnection() {
            return {
              executeQuery,
              async *streamQuery() {
                throw new Error('streamQuery should not be used in detectPgCapability tests');
              },
            };
          },
          async beginTransaction() {},
          async commitTransaction() {},
          async rollbackTransaction() {},
          async releaseConnection() {},
          async destroy() {},
        }) as never,
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const createdDbs: Kysely<V1TeableDatabase>[] = [];

const registerDb = (db: Kysely<V1TeableDatabase>) => {
  createdDbs.push(db);
  return db;
};

afterEach(async () => {
  await Promise.all(createdDbs.splice(0).map((db) => db.destroy()));
});

describe('detectPgCapability', () => {
  it('returns true when pg_input_is_valid executes successfully', async () => {
    const db = registerDb(createTestDb(async () => ({ rows: [] })));

    await expect(hasPgInputIsValid(db)).resolves.toBe(true);
  });

  it('returns false only for undefined function errors', async () => {
    const dbWithCode = registerDb(
      createTestDb(async () => {
        throw Object.assign(new Error('function pg_input_is_valid does not exist'), {
          code: '42883',
        });
      })
    );
    const dbWithMessage = registerDb(
      createTestDb(async () => {
        throw new Error('no such function: pg_input_is_valid');
      })
    );

    await expect(hasPgInputIsValid(dbWithCode)).resolves.toBe(false);
    await expect(hasPgInputIsValid(dbWithMessage)).resolves.toBe(false);
  });

  it('rethrows unrelated errors', async () => {
    const db = registerDb(
      createTestDb(async () => {
        throw new Error('permission denied');
      })
    );

    await expect(hasPgInputIsValid(db)).rejects.toThrow('permission denied');
  });

  it('wraps missing type validation polyfill errors with migration guidance', async () => {
    const successDb = registerDb(createTestDb(async () => ({ rows: [] })));
    const missingPolyfillDb = registerDb(
      createTestDb(async () => {
        throw new Error('function public.teable_try_cast_valid does not exist');
      })
    );

    await expect(assertTypeValidationPolyfill(successDb)).resolves.toBeUndefined();
    await expect(assertTypeValidationPolyfill(missingPolyfillDb)).rejects.toThrow(
      'Missing PostgreSQL type validation polyfill'
    );
  });
});
