import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-pg';
import {
  createComputedOutboxWakeup,
  v2RecordRepositoryPostgresTokens,
  type IComputedUpdateOutbox,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  ActorId,
  CreateRecordsCommand,
  CreateTableCommand,
  getRandomString,
  UpdateRecordsCommand,
  v2CoreTokens,
  type CreateRecordsResult,
  type CreateTableResult,
  type ICommandBus,
  type IUnitOfWork,
  type UpdateRecordsResult,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { expect, it, vi } from 'vitest';

import { createV2NodeTestContainer } from '../../../../../../packages/v2/container-node-test/src';
import {
  ComputedOutboxBaseAdmissionLeaseLostError,
  ComputedOutboxBaseAdmissionService,
} from './computed-outbox-base-admission.service';
import { ComputedOutboxWakeupHandler } from './computed-outbox-wakeup.handler';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitForSleepingStatement = async (
  marker: string,
  db: Awaited<ReturnType<typeof createV2NodeTestContainer>>['db']
): Promise<void> => {
  const deadline = Date.now() + 15_000;
  do {
    const result = await sql<{ count: number }>`select count(*)::int as count
      from pg_stat_activity
      where query like ${`%${marker}%`} and wait_event = 'PgSleep'`.execute(db);
    if (result.rows[0]?.count === 1) return;
    await delay(20);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${marker}`);
};

// Requires a real PostgreSQL container or TEABLE_V2_TEST_DATABASE_URL. The Redis lease
// is deterministic: this invokes the production admission service, but its queue client
// accepts acquisition and reports ownership loss on the first renewal.
it.runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1')(
  'cancels and rolls back the real worker transaction when handler admission renewal loses ownership',
  async () => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
        outboxConfig: {
          stageMaxSteps: 10,
          stageSmallRunComplexityThreshold: 0,
          taskStatementTimeoutMs: 0,
          continuationRelayClaimEnabled: false,
          baseBackoffMs: 0,
          maxBackoffMs: 0,
        },
      },
    });
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const bus = runtime.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const ids = {
      name: `fld${getRandomString(16)}`,
      value: `fld${getRandomString(16)}`,
      formula: `fld${getRandomString(16)}`,
    };
    const unitOfWork = runtime.container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
    const originalWithTransaction = unitOfWork.withTransaction;
    const withTransaction = unitOfWork.withTransaction.bind(unitOfWork);

    try {
      const table = (
        await bus.execute<CreateTableCommand, CreateTableResult>(
          context,
          CreateTableCommand.create({
            baseId: runtime.baseId.toString(),
            name: `Handler cancellation ${getRandomString(6)}`,
            fields: [
              { id: ids.name, type: 'singleLineText', name: 'Name', isPrimary: true },
              { id: ids.value, type: 'number', name: 'Value' },
              {
                id: ids.formula,
                type: 'formula',
                name: 'Formula',
                options: { expression: `{${ids.value}} + 1` },
              },
            ],
            views: [{ type: 'grid' }],
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap().table;
      await runtime.processOutbox();

      const record = (
        await bus.execute<CreateRecordsCommand, CreateRecordsResult>(
          context,
          CreateRecordsCommand.create({
            tableId: table.id().toString(),
            records: [{ fields: { [ids.name]: 'lease loss', [ids.value]: 100 } }],
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap().records[0];
      await runtime.processOutbox();

      (
        await bus.execute<UpdateRecordsCommand, UpdateRecordsResult>(
          context,
          UpdateRecordsCommand.create({
            tableId: table.id().toString(),
            records: [{ id: record.id().toString(), fields: { [ids.value]: 200 } }],
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap();

      const outbox = runtime.container.resolve<IComputedUpdateOutbox>(
        v2RecordRepositoryPostgresTokens.computedUpdateOutbox
      );
      const pendingBefore = await runtime.db
        .selectFrom('computed_update_outbox')
        .select(['id', 'attempts'])
        .orderBy('id')
        .where('base_id', '=', runtime.baseId.toString())
        .where('status', '=', 'pending')
        .execute();
      expect(pendingBefore).not.toHaveLength(0);
      const taskId = pendingBefore[0]!.id;
      expect((await outbox.getTaskClaimEligibility(taskId))._unsafeUnwrap()).toMatchObject({
        status: 'eligible',
      });

      const marker = `computed-handler-cancel-${getRandomString(8)}`;
      let injected = false;
      unitOfWork.withTransaction = (transactionContext, work, options) =>
        withTransaction(
          transactionContext,
          async (txContext) => {
            const result = await work(txContext);
            if (!injected && result.isOk()) {
              injected = true;
              const transaction = getPostgresTransaction(txContext);
              if (!transaction)
                throw new Error('Expected the real computed PostgreSQL transaction');
              await sql.raw(`select pg_sleep(60) /* ${marker} */`).execute(transaction);
            }
            return result;
          },
          options
        );

      const evalRedis = vi.fn(async (script: string) => {
        if (script.includes("redis.call('ZSCORE', key, owner)")) return 0;
        return 1;
      });
      const metrics = {
        recordAdmissionLeaseLossStop: vi.fn(),
        recordConsume: vi.fn(),
        recordDeliveryLag: vi.fn(),
        recordExecutionDuration: vi.fn(),
        recordTaskSettlement: vi.fn(),
      };
      const admission = new ComputedOutboxBaseAdmissionService(
        { client: Promise.resolve({ eval: evalRedis }) } as never,
        undefined,
        metrics as never
      );
      const publisher = {
        publish: vi.fn().mockResolvedValue({ status: 'accepted' }),
        runAsConsumer: <T>(operation: () => Promise<T>) => operation(),
        onDeliveryRecovered: vi.fn(() => vi.fn()),
      };
      const handler = new ComputedOutboxWakeupHandler(
        { getContainerForBase: vi.fn().mockResolvedValue(runtime.container) } as never,
        metrics as never,
        publisher as never,
        admission
      );
      const wakeup = createComputedOutboxWakeup({
        wakeupId: `cuw${getRandomString(17)}`,
        taskId,
        baseId: runtime.baseId.toString(),
        availableAt: new Date(),
        cause: 'created',
      });

      const handled = handler.handle(wakeup);
      await waitForSleepingStatement(marker, runtime.db);
      await expect(handled).rejects.toBeInstanceOf(ComputedOutboxBaseAdmissionLeaseLostError);

      expect(
        evalRedis.mock.calls.some(([script]) =>
          String(script).includes("redis.call('ZSCORE', key, owner)")
        )
      ).toBe(true);
      const cancelledQuery = await sql<{ count: number }>`select count(*)::int as count
        from pg_stat_activity
        where query like ${`%${marker}%`} and wait_event = 'PgSleep'`.execute(runtime.db);
      expect(cancelledQuery.rows[0]?.count).toBe(0);
      expect(metrics.recordTaskSettlement).not.toHaveBeenCalled();
      expect(metrics.recordAdmissionLeaseLossStop).toHaveBeenCalledOnce();
      expect(publisher.publish).not.toHaveBeenCalled();

      const pendingAfter = await runtime.db
        .selectFrom('computed_update_outbox')
        .select(['id', 'status', 'attempts', 'locked_by'])
        .orderBy('id')
        .where('base_id', '=', runtime.baseId.toString())
        .execute();
      expect(pendingAfter.map(({ id }) => id).sort()).toEqual(
        pendingBefore.map(({ id }) => id).sort()
      );
      expect(
        pendingAfter.every(({ status, locked_by: lockedBy }) => status === 'pending' && !lockedBy)
      ).toBe(true);
      expect(pendingAfter.map(({ attempts }) => attempts)).toEqual(
        pendingBefore.map(({ attempts }) => attempts)
      );
      const terminalState = await sql<{ dead: number; history: number }>`select
        (select count(*)::int from computed_update_dead_letter where id = ${taskId}) as dead,
        (select count(*)::int from computed_update_run_history where task_id = ${taskId}) as history
      `.execute(runtime.db);
      expect(terminalState.rows[0]).toEqual({ dead: 0, history: 0 });

      const dbTableName = table
        .dbTableName()
        .andThen((name) => name.value())
        ._unsafeUnwrap();
      const formulaColumn = new Map(
        table.getFields().map((field) => [
          field.id().toString(),
          field
            .dbFieldName()
            .andThen((name) => name.value())
            ._unsafeUnwrap(),
        ])
      ).get(ids.formula)!;
      const afterCancellation = await sql<Record<string, unknown>>`
        select * from ${sql.table(dbTableName)}
        where __id = ${record.id().toString()}`.execute(runtime.db);
      expect(afterCancellation.rows[0]?.[formulaColumn]).toBe(101);

      await runtime.processOutbox();
      const recovered = await sql<Record<string, unknown>>`
        select * from ${sql.table(dbTableName)}
        where __id = ${record.id().toString()}`.execute(runtime.db);
      expect(recovered.rows[0]?.[formulaColumn]).toBe(201);
      expect(
        await runtime.db
          .selectFrom('computed_update_outbox')
          .select('id')
          .where('base_id', '=', runtime.baseId.toString())
          .execute()
      ).toEqual([]);
    } finally {
      unitOfWork.withTransaction = originalWithTransaction;
      await runtime.dispose();
    }
  },
  120_000
);
