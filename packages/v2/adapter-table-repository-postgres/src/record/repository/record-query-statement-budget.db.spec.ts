/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  OffsetPagination,
  PageLimit,
  PageOffset,
  v2CoreTokens,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  type ILogger,
  type Table,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { CompiledQuery, sql, type Kysely } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getV2NodeTestContainer,
  setV2NodeTestContainer,
} from '../../integration/testkit/v2NodeTestContainer';
import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { TableRecordQueryBuilderManager } from '../query-builder';
import { PostgresTableRecordQueryRepository } from './PostgresTableRecordQueryRepository';

const BUDGET_MS = 750;

const fullTableName = (table: Table, defaultSchema: string): string => {
  const location = table.dbTableName()._unsafeUnwrap().split({ defaultSchema })._unsafeUnwrap();
  return `${location.schema ?? defaultSchema}.${location.tableName}`;
};

/**
 * Fails with a readable message instead of hanging for the suite timeout when the
 * budget is missing: without it a blocked read simply waits for the lock holder.
 */
const withDeadline = async <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${message} within ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * PGlite cannot enforce `statement_timeout` (an in-process WASM engine cannot
 * interrupt a running statement), so the budget is only observable there. These
 * cases run against a real server: a page read blocked by a concurrent
 * `ACCESS EXCLUSIVE` holder is cancelled inside the budget, reports the SQLSTATE
 * the repository classifies, and leaves the connection untouched for the next
 * reader.
 */
describe('record query statement budget (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it('cancels a blocked page read within the budget and leaves the session clean', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };

    const createdTable = (
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        context,
        CreateTableCommand.create({
          baseId: baseId.toString(),
          name: 'Statement Budget',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().table;
    const titleField = createdTable
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    for (const title of ['Alpha', 'Bravo']) {
      (
        await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          CreateRecordCommand.create({
            tableId: createdTable.id().toString(),
            fields: { [titleField.id().toString()]: title },
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap();
    }

    const repository = new PostgresTableRecordQueryRepository(
      container.resolve<TableRecordQueryBuilderManager>(
        v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager
      ),
      db,
      container.resolve<ILogger>(v2CoreTokens.logger),
      { statementBudgetMs: BUDGET_MS }
    );
    const readPage = () =>
      repository.find(context, createdTable, undefined, {
        mode: 'stored',
        pagination: OffsetPagination.create(
          PageLimit.create(10)._unsafeUnwrap(),
          PageOffset.create(0)._unsafeUnwrap()
        ),
      });

    const unblocked = await readPage();
    expect(unblocked.isOk()).toBe(true);
    if (unblocked.isErr()) return;
    expect(unblocked.value.records).toHaveLength(2);

    const lockTable = sql`
      LOCK TABLE ${sql.table(fullTableName(createdTable, baseId.toString()))} IN ACCESS EXCLUSIVE MODE
    `.compile(db);
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    let releaseLock!: () => void;
    const released = new Promise<void>((resolve) => (releaseLock = resolve));
    const blocker = db.connection().execute(async (connection) => {
      await connection.executeQuery(CompiledQuery.raw('BEGIN'));
      await connection.executeQuery(lockTable);
      signalLocked();
      await released;
      await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
    });

    await locked;
    const startedAt = Date.now();
    let blocked: Awaited<ReturnType<typeof readPage>>;
    try {
      const blockedRead = readPage();
      // A rejection here must not surface as an unhandled one when the deadline wins.
      blockedRead.catch(() => undefined);
      blocked = await withDeadline(
        blockedRead,
        30_000,
        'the blocked page read was never cancelled'
      );
    } finally {
      releaseLock();
      await blocker;
    }
    const elapsedMs = Date.now() - startedAt;

    expect(blocked.isErr()).toBe(true);
    if (blocked.isOk()) return;
    // The server cancelled the statement; an application-side deadline would have
    // waited for the lock holder to leave.
    expect(blocked.error.code).toBe('db.statement_timeout');
    expect((blocked.error.details as { pgCode?: string } | undefined)?.pgCode).toBe('57014');
    expect(elapsedMs).toBeLessThan(5_000);

    const recovered = await readPage();
    expect(recovered.isOk()).toBe(true);
    if (recovered.isErr()) return;
    expect(recovered.value.records).toHaveLength(2);

    // `set_config(..., true)` is transaction-local, so a pooled connection keeps
    // whatever budget the server was configured with - nothing leaks to the next
    // reader. Sampled across connections (the pool hands out whichever is free); the
    // per-statement arming is pinned by the pglite probe.
    const readStatementTimeout = async (): Promise<string | undefined> => {
      const result = await db
        .connection()
        .execute((connection) =>
          sql<{ value: string }>`SELECT current_setting('statement_timeout') AS value`.execute(
            connection
          )
        );
      return result.rows[0]?.value;
    };
    const sampled = await Promise.all([
      readStatementTimeout(),
      readStatementTimeout(),
      readStatementTimeout(),
    ]);
    expect(sampled).toEqual(['0', '0', '0']);
  });
});
