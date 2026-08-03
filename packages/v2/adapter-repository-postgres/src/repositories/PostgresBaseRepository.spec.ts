import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  Base,
  BaseId,
  BaseName,
  OffsetPagination,
  PageLimit,
  PageOffset,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { PostgresBaseRepository } from './PostgresBaseRepository';

const createBase = (id = `bse${'a'.repeat(16)}`, name = 'Workspace') =>
  Base.rehydrate({
    id: BaseId.create(id)._unsafeUnwrap(),
    name: BaseName.create(name)._unsafeUnwrap(),
  })._unsafeUnwrap();

const createTestDb = () =>
  new Kysely<V1TeableDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

describe('PostgresBaseRepository', () => {
  it('inserts a base inside a transaction and returns the same aggregate', async () => {
    const db = createTestDb();
    const repo = new PostgresBaseRepository(db);
    const base = createBase();

    const result = await repo.insert(
      { actorId: ActorId.create('system')._unsafeUnwrap() } as never,
      base
    );

    expect(result._unsafeUnwrap()).toBe(base);
  });

  it('reuses an existing postgres transaction when present', async () => {
    const db = createTestDb();
    const transactionSpy = vi.spyOn(db, 'transaction');
    const repo = new PostgresBaseRepository(db);
    const base = createBase(`bse${'b'.repeat(16)}`, 'Tx Base');

    await db.transaction().execute(async (trx) => {
      const result = await repo.insert(
        {
          actorId: ActorId.create('system')._unsafeUnwrap(),
          transaction: new PostgresUnitOfWorkTransaction(trx, 'meta'),
        } as never,
        base
      );

      expect(result.isOk()).toBe(true);
    });

    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a data-scoped transaction for base metadata inserts', async () => {
    const db = createTestDb();
    const transactionSpy = vi.spyOn(db, 'transaction');
    const repo = new PostgresBaseRepository(db);
    const base = createBase(`bse${'i'.repeat(16)}`, 'Meta Tx Base');

    await db.transaction().execute(async (trx) => {
      const dataTransaction = new PostgresUnitOfWorkTransaction(trx, 'data');
      const result = await repo.insert(
        {
          actorId: ActorId.create('system')._unsafeUnwrap(),
          transaction: dataTransaction,
          transactions: { data: dataTransaction },
        } as never,
        base
      );

      expect(result.isOk()).toBe(true);
    });

    expect(transactionSpy).toHaveBeenCalledTimes(2);
  });

  it('wraps insert failures as infrastructure errors', async () => {
    const db = {
      transaction: () => ({
        execute: () => {
          throw new Error('insert failed');
        },
      }),
    } as unknown as Kysely<V1TeableDatabase>;
    const repo = new PostgresBaseRepository(db);

    const result = await repo.insert(
      { actorId: ActorId.create('system')._unsafeUnwrap() } as never,
      createBase(`bse${'c'.repeat(16)}`, 'Broken')
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'infrastructure',
      message: 'Failed to insert base: Error: insert failed',
    });
  });

  it('findOne returns null, a mapped base, or an unexpected error', async () => {
    const nullDb = {
      selectFrom: vi.fn(() => ({
        select: () => ({
          where: () => ({
            where: () => ({
              executeTakeFirst: async () => undefined,
            }),
          }),
        }),
      })),
    } as unknown as Kysely<V1TeableDatabase>;
    const nullRepo = new PostgresBaseRepository(nullDb);
    const nullResult = await nullRepo.findOne(
      { actorId: ActorId.create('system')._unsafeUnwrap() } as never,
      BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap()
    );
    expect(nullResult._unsafeUnwrap()).toBeNull();

    const rowDb = {
      selectFrom: vi.fn(() => ({
        select: () => ({
          where: () => ({
            where: () => ({
              executeTakeFirst: async () => ({ id: `bse${'e'.repeat(16)}`, name: 'Main Base' }),
            }),
          }),
        }),
      })),
    } as unknown as Kysely<V1TeableDatabase>;
    const rowRepo = new PostgresBaseRepository(rowDb);
    const rowResult = await rowRepo.findOne(
      { actorId: ActorId.create('system')._unsafeUnwrap() } as never,
      BaseId.create(`bse${'e'.repeat(16)}`)._unsafeUnwrap()
    );
    expect(rowResult._unsafeUnwrap()?.name().toString()).toBe('Main Base');

    const invalidDb = {
      selectFrom: vi.fn(() => ({
        select: () => ({
          where: () => ({
            where: () => ({
              executeTakeFirst: async () => ({ id: `bse${'f'.repeat(16)}`, name: '' }),
            }),
          }),
        }),
      })),
    } as unknown as Kysely<V1TeableDatabase>;
    const invalidRepo = new PostgresBaseRepository(invalidDb);
    const invalidResult = await invalidRepo.findOne(
      { actorId: ActorId.create('system')._unsafeUnwrap() } as never,
      BaseId.create(`bse${'f'.repeat(16)}`)._unsafeUnwrap()
    );
    expect(invalidResult.isErr()).toBe(true);
    expect(invalidResult._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.invalid',
      message: 'Invalid BaseName',
    });
  });

  it('find returns paginated bases and surfaces query errors', async () => {
    const countQuery = {
      select: () => ({
        where: () => ({
          executeTakeFirst: async () => ({ count: '2' }),
        }),
      }),
    };
    const rowsQuery = {
      select: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              offset: () => ({
                execute: async () => [
                  { id: `bse${'g'.repeat(16)}`, name: 'Alpha' },
                  { id: `bse${'h'.repeat(16)}`, name: 'Beta' },
                ],
              }),
            }),
          }),
        }),
      }),
    };
    const db = {
      fn: { count: vi.fn(() => ({ as: () => 'count' })) },
      selectFrom: vi.fn().mockReturnValueOnce(countQuery).mockReturnValueOnce(rowsQuery),
    } as unknown as Kysely<V1TeableDatabase>;
    const repo = new PostgresBaseRepository(db);

    const result = await repo.find(
      { actorId: ActorId.create('system')._unsafeUnwrap() } as never,
      OffsetPagination.create(
        PageLimit.create(10)._unsafeUnwrap(),
        PageOffset.create(5)._unsafeUnwrap()
      )
    );

    expect(result._unsafeUnwrap()).toMatchObject({
      total: 2,
      bases: [expect.objectContaining({}), expect.objectContaining({})],
    });
    expect(result._unsafeUnwrap().bases.map((base) => base.name().toString())).toEqual([
      'Alpha',
      'Beta',
    ]);

    const errorDb = {
      fn: { count: vi.fn(() => ({ as: () => 'count' })) },
      selectFrom: vi.fn(() => {
        throw new Error('load failed');
      }),
    } as unknown as Kysely<V1TeableDatabase>;
    const errorRepo = new PostgresBaseRepository(errorDb);
    const errorResult = await errorRepo.find(
      { actorId: ActorId.create('system')._unsafeUnwrap() } as never,
      OffsetPagination.create(PageLimit.create(1)._unsafeUnwrap(), PageOffset.zero())
    );
    expect(errorResult.isErr()).toBe(true);
    expect(errorResult._unsafeUnwrapErr()).toMatchObject({
      code: 'unexpected',
      message: 'Failed to load bases: Error: load failed',
    });
  });
});
