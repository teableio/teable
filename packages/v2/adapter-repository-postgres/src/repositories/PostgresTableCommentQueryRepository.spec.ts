/* eslint-disable @typescript-eslint/naming-convention */
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  TableId,
  v2CoreTokens,
  type IExecutionContext,
  type ITableCommentQueryRepository,
} from '@teable/v2-core';
import { container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerV2PostgresStateAdapter } from '../di/register';
import { PostgresTableCommentQueryRepository } from './PostgresTableCommentQueryRepository';

type StartedPostgreSqlContainer = Awaited<ReturnType<PostgreSqlContainer['start']>>;

const createPgDb = async (connectionString: string): Promise<Kysely<V1TeableDatabase>> => {
  const pg = (await import('pg')) as typeof import('pg') & { default?: typeof import('pg') };
  const Pool = pg.Pool ?? pg.default?.Pool;
  if (!Pool) throw new Error('Missing pg.Pool');

  return new Kysely<V1TeableDatabase>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });
};

const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
const otherTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
const recordId = `rec${'a'.repeat(16)}`;
const secondRecordId = `rec${'b'.repeat(16)}`;
const deletedRecordId = `rec${'c'.repeat(16)}`;
const unauthorizedRecordId = `rec${'d'.repeat(16)}`;
const context: IExecutionContext = {
  actorId: ActorId.create(`usr${'a'.repeat(16)}`)._unsafeUnwrap(),
};

const comment = (id: string, record: string, table = tableId, deletedTime: Date | null = null) => ({
  id,
  table_id: table.toString(),
  record_id: record,
  quote_Id: null,
  content: 'Comment',
  reaction: null,
  deleted_time: deletedTime,
  created_by: context.actorId.toString(),
});

describe('PostgresTableCommentQueryRepository', () => {
  let pgContainer: StartedPostgreSqlContainer | undefined;
  let metaDb: Kysely<V1TeableDatabase>;
  let dataDb: Kysely<V1TeableDatabase>;
  let repository: ITableCommentQueryRepository;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('teable_v2_meta')
      .withUsername('teable')
      .withPassword('teable')
      .start();
    metaDb = await createPgDb(pgContainer.getConnectionUri());
    await sql`CREATE DATABASE teable_v2_data`.execute(metaDb);
    const dataUrl = new URL(pgContainer.getConnectionUri());
    dataUrl.pathname = '/teable_v2_data';
    dataDb = await createPgDb(dataUrl.toString());

    const c = container.createChildContainer();
    await registerV2PostgresStateAdapter(c, { db: metaDb, ensureSchema: true });
    repository = c.resolve<ITableCommentQueryRepository>(v2CoreTokens.tableCommentQueryRepository);

    await metaDb
      .insertInto('comment')
      .values([
        comment('comment-a1', recordId),
        comment('comment-a2', recordId),
        comment('comment-a-deleted', recordId, tableId, new Date('2026-01-01T00:00:00Z')),
        comment('comment-b', secondRecordId),
        comment('comment-deleted-only', deletedRecordId, tableId, new Date('2026-01-01T00:00:00Z')),
        comment('comment-not-authorized', unauthorizedRecordId),
        comment('comment-other-table', recordId, otherTableId),
      ])
      .execute();
  });

  afterAll(async () => {
    await metaDb?.destroy();
    await dataDb?.destroy();
    await pgContainer?.stop();
  });

  it('counts only active comments in the authorized record page and requested table', async () => {
    const result = await repository.countByRecordIds(context, tableId, [
      recordId,
      secondRecordId,
      deletedRecordId,
      `rec${'e'.repeat(16)}`,
    ]);

    expect(result._unsafeUnwrap().toSorted((a, b) => a.recordId.localeCompare(b.recordId))).toEqual(
      [
        { recordId, count: 2 },
        { recordId: secondRecordId, count: 1 },
      ]
    );
    expect(
      (await repository.countByRecordIds(context, otherTableId, [recordId]))._unsafeUnwrap()
    ).toEqual([{ recordId, count: 1 }]);
  });

  it('reads metadata while the active transaction uses a separate data database without comments', async () => {
    const result = await dataDb.transaction().execute((trx) => {
      const transaction = new PostgresUnitOfWorkTransaction(trx, 'data');
      return repository.countByRecordIds(
        { ...context, transaction, transactions: { data: transaction } },
        tableId,
        [recordId]
      );
    });

    expect(result._unsafeUnwrap()).toEqual([{ recordId, count: 2 }]);
  });

  it('includes uncommitted comments from the metadata transaction', async () => {
    const transactionRecordId = `rec${'f'.repeat(16)}`;
    await metaDb.transaction().execute(async (trx) => {
      await trx
        .insertInto('comment')
        .values(comment('comment-pending', transactionRecordId))
        .execute();
      const transaction = new PostgresUnitOfWorkTransaction(trx, 'meta');
      const result = await repository.countByRecordIds(
        { ...context, transaction, transactions: { meta: transaction } },
        tableId,
        [transactionRecordId]
      );
      expect(result._unsafeUnwrap()).toEqual([{ recordId: transactionRecordId, count: 1 }]);
    });
  });

  it('returns no counts for an empty page without requiring a comment table', async () => {
    const emptyDatabaseRepository = new PostgresTableCommentQueryRepository(dataDb);
    expect(
      (await emptyDatabaseRepository.countByRecordIds(context, tableId, []))._unsafeUnwrap()
    ).toEqual([]);
  });

  it('returns infrastructure errors when the metadata query fails', async () => {
    const emptyDatabaseRepository = new PostgresTableCommentQueryRepository(dataDb);
    const result = await emptyDatabaseRepository.countByRecordIds(context, tableId, [recordId]);
    expect(result._unsafeUnwrapErr().code).toBe('infrastructure');
  });
});
