import { setImmediate } from 'node:timers/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  BaseId,
  FieldName,
  NoopHasher,
  Table,
  TableId,
  TableName,
  RecordsBatchUpdated,
  type IEventBus,
  type IExecutionContext,
  type ILogger,
  type RecordId,
  type TableRecord,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { ComputedUpdatePlanner, IComputedUpdateOutbox, IUpdateStrategy } from '../computed';
import { PostgresTableRecordRepository } from './PostgresTableRecordRepository';

setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;
const actorId = ActorId.create('stream-memory-test')._unsafeUnwrap();
const logger: ILogger = {
  child: () => logger,
  scope: () => logger,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const createTable = (suffix: string) => {
  const builder = Table.builder()
    .withId(TableId.create(`tbl${suffix.repeat(16)}`)._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Streaming retention')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const createRepository = (
  outbox: Pick<IComputedUpdateOutbox, 'enqueueSeedTask'>,
  hasWork = true,
  computed?: { planner: ComputedUpdatePlanner; strategy: IUpdateStrategy; eventBus: IEventBus }
) => {
  const repository = new PostgresTableRecordRepository(
    {} as never,
    logger,
    { calculateOrders: async () => ok([]) },
    computed?.planner ??
      ({ hasWritableComputedWork: () => hasWork } as unknown as ComputedUpdatePlanner),
    {} as never,
    computed?.strategy ?? {
      mode: 'async',
      name: 'test',
      execute: async () => ok(undefined),
      scheduleDispatch: () => undefined,
    },
    outbox as IComputedUpdateOutbox,
    {} as never,
    computed?.eventBus ??
      ({ publish: async () => ok(undefined), publishMany: async () => ok(undefined) } as never),
    new NoopHasher()
  );
  // Isolate stream ownership from SQL/driver memory. No mock call-history retains records.
  repository.insertMany = async () => ok({});
  return repository;
};

const afterCommitContext = (): IExecutionContext => ({
  actorId,
  requestId: 'stream-memory-test',
  transaction: {
    kind: 'unitOfWorkTransaction',
    afterCommit: () => undefined,
  },
});

describe('PostgresTableRecordRepository streaming retention', () => {
  it.each([true, false])(
    'releases consumed records and fields with enqueueDeferred=%s',
    async (enqueueDeferredComputedUpdates) => {
      const table = createTable('b');
      const repository = createRepository({
        enqueueSeedTask: async () => ok({ taskId: 'seed', merged: true }),
      });
      let firstRecord: WeakRef<TableRecord> | undefined;
      let firstFields: WeakRef<object> | undefined;
      function* batches() {
        for (let index = 0; index < 4; index++) {
          const record = table
            .createRecord(
              new Map([
                [table.getFields()[0]!.id().toString(), `${index}:${'x'.repeat(64 * 1024)}`],
              ])
            )
            ._unsafeUnwrap().record;
          if (index === 0) {
            firstRecord = new WeakRef(record);
            firstFields = new WeakRef(record.fields());
          }
          yield [record];
        }
      }
      const source = batches();
      let consumed = 0;
      const stream = {
        async *[Symbol.asyncIterator]() {
          for (const batch of source) {
            if (consumed === 3) {
              await setImmediate();
              collectGarbage();
              expect(
                firstRecord?.deref(),
                'consumed TableRecord must be collectible before import completes'
              ).toBeUndefined();
              expect(
                firstFields?.deref(),
                'consumed field values must be collectible before import completes'
              ).toBeUndefined();
            }
            consumed++;
            yield batch;
          }
        },
      };
      const transaction = new PostgresUnitOfWorkTransaction({} as never, 'data');
      try {
        const result = await repository.insertManyStream(
          { ...afterCommitContext(), transaction },
          table,
          stream,
          {
            deferComputedUpdates: true,
            enqueueDeferredComputedUpdates,
          }
        );
        expect(result.isOk(), result.isErr() ? result.error.message : undefined).toBe(true);
        expect(result._unsafeUnwrap().totalInserted).toBe(4);
      } finally {
        await transaction.runAfterRollbackHandlers();
      }
    }
  );

  it('keeps deferred seed table ownership for mixed-table batches', async () => {
    const first = createTable('b');
    const second = createTable('c');
    const seeds: Array<{ tableId: string; recordIds: string[] }> = [];
    const repository = createRepository({
      enqueueSeedTask: async (task) => {
        seeds.push({ tableId: task.seedTableId, recordIds: task.seedRecordIds });
        return ok({ taskId: task.seedTableId, merged: false });
      },
    });
    const firstRecord = first.createRecord(new Map())._unsafeUnwrap().record;
    const secondRecord = second.createRecord(new Map())._unsafeUnwrap().record;
    const result = await repository.insertManyStream(
      afterCommitContext(),
      first,
      [
        { table: first, records: [firstRecord] },
        { table: second, records: [secondRecord] },
      ],
      { deferComputedUpdates: true, enqueueDeferredComputedUpdates: true }
    );
    expect(result.isOk()).toBe(true);
    expect(seeds).toEqual([
      { tableId: first.id().toString(), recordIds: [firstRecord.id().toString()] },
      { tableId: second.id().toString(), recordIds: [secondRecord.id().toString()] },
    ]);
  });
  it('does not create seeds when inserted fields have no computed dependants', async () => {
    const table = createTable('b');
    const repository = createRepository(
      {
        enqueueSeedTask: async () => {
          throw new Error('Empty computation must not enqueue a task');
        },
      },
      false
    );
    const result = await repository.insertManyStream(
      afterCommitContext(),
      table,
      [
        [table.createRecord(new Map())._unsafeUnwrap().record],
        [table.createRecord(new Map())._unsafeUnwrap().record],
      ],
      { deferComputedUpdates: true, enqueueDeferredComputedUpdates: true }
    );
    expect(result._unsafeUnwrap().totalInserted).toBe(2);
  });
  it('executes legacy sync computation and publishes its full changes only after commit', async () => {
    const table = createTable('b');
    const fieldId = table.getFields()[0]!.id();
    const published: Array<RecordsBatchUpdated['updates'][number]> = [];
    const repository = createRepository(
      {
        enqueueSeedTask: async () => {
          throw new Error('Legacy sync computation must not become an async seed task');
        },
      },
      true,
      {
        planner: {
          planStage: async (input: { seedRecordIds: RecordId[] }) =>
            ok({
              baseId: table.baseId(),
              seedTableId: table.id(),
              seedRecordIds: input.seedRecordIds,
              extraSeedRecords: [],
              steps: [{ tableId: table.id(), level: 0, fieldIds: [fieldId] }],
              edges: [],
              estimatedComplexity: 1,
              changeType: 'insert',
            }),
        } as unknown as ComputedUpdatePlanner,
        strategy: {
          mode: 'sync',
          name: 'sync-test',
          scheduleDispatch: () => undefined,
          execute: async (_updater, plan) =>
            ok({
              changesByStep: [
                {
                  tableId: table.id().toString(),
                  recordChanges: plan.seedRecordIds.map((id) => ({
                    recordId: id.toString(),
                    oldVersion: 1,
                    changes: [
                      {
                        fieldId: fieldId.toString(),
                        oldValue: null,
                        newValue: 'computed'.repeat(100),
                      },
                    ],
                  })),
                },
              ],
            }),
        },
        eventBus: {
          publish: async () => ok(undefined),
          publishMany: async (_context, events) => {
            for (const event of events)
              if (event instanceof RecordsBatchUpdated) published.push(...event.updates);
            return ok(undefined);
          },
          subscribe: () => ({ unsubscribe: () => undefined }),
        } as IEventBus,
      }
    );
    const records = Array.from(
      { length: 3 },
      () => table.createRecord(new Map())._unsafeUnwrap().record
    );
    const transaction = new PostgresUnitOfWorkTransaction({} as never, 'data');
    const result = await repository.insertManyStream(
      { actorId, transaction },
      table,
      records.map((record) => [record]),
      {
        deferComputedUpdates: true,
      }
    );
    expect(result._unsafeUnwrap().totalInserted).toBe(3);
    expect(published).toEqual([]);
    await transaction.runAfterCommitHandlers();
    await expect
      .poll(() => published)
      .toEqual(
        records.map((record) =>
          expect.objectContaining({
            recordId: record.id().toString(),
            changes: [
              { fieldId: fieldId.toString(), oldValue: null, newValue: 'computed'.repeat(100) },
            ],
          })
        )
      );
  });
});
