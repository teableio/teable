import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import { v2PostgresDdlAdapterConfigSchema } from './config';

const createTestDb = () =>
  new Kysely<V1TeableDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

describe('v2PostgresDdlAdapterConfigSchema', () => {
  it('accepts both Kysely instances and duck-typed db objects', () => {
    const kyselyResult = v2PostgresDdlAdapterConfigSchema.safeParse({ db: createTestDb() });
    const duckTypedResult = v2PostgresDdlAdapterConfigSchema.safeParse({
      db: {
        selectFrom() {},
        insertInto() {},
        updateTable() {},
        deleteFrom() {},
      },
    });

    expect(kyselyResult.success).toBe(true);
    expect(duckTypedResult.success).toBe(true);
  });

  it('rejects invalid db values', () => {
    const nullResult = v2PostgresDdlAdapterConfigSchema.safeParse({ db: null });
    const partialResult = v2PostgresDdlAdapterConfigSchema.safeParse({
      db: {
        selectFrom() {},
      },
    });

    expect(nullResult.success).toBe(false);
    expect(partialResult.success).toBe(false);
  });
});
