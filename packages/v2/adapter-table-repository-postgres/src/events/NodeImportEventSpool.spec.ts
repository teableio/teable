import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresUnitOfWork } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  BaseId,
  DomainWriteTransaction,
  FieldId,
  FieldOptionsAdded,
  FieldUpdated,
  NoopLogger,
  RecordsBatchCreated,
  TableCreated,
  TableId,
  TableName,
  bindUnitOfWorkTransaction,
  domainError,
  type DomainError,
  type IDomainEvent,
  type IExecutionContext,
  type IImportEventSpoolFactory,
  type IUnitOfWork,
  type LegacyEventDispatch,
  type ProjectionMessageDraft,
  type ProjectionEventRoutingDecision,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeImportEventSpoolFactory } from './NodeImportEventSpool';

const context: IExecutionContext = { actorId: ActorId.create('usr-import')._unsafeUnwrap() };
const baseId = BaseId.generate()._unsafeUnwrap();
const tableId = TableId.generate()._unsafeUnwrap();
const longValue = '完整导入快照'.repeat(400);
const createEvent = (index: number) =>
  RecordsBatchCreated.create({
    baseId,
    tableId,
    source: { type: 'import' },
    records: [
      { recordId: `rec${index}`, fields: [{ fieldId: 'fldText', value: `${index}:${longValue}` }] },
    ],
    orchestration: {
      operationId: 'import:test',
      totalRecordCount: 12,
      totalChunkCount: 12,
      chunkIndex: index,
      scope: 'chunk',
    },
  });

const routing: ProjectionEventRoutingDecision = {
  messageName: 'table.records-created.v1',
  durableMode: 'active',
  sameTxTargets: [],
  durableTargets: [],
  directTargets: [
    { consumerId: 'import-consumer', handler: class {} as never, dispatchMode: 'background' },
  ],
};

class TestUnitOfWork implements IUnitOfWork {
  committed = false;
  calls = 0;
  async withTransaction<T>(
    input: IExecutionContext,
    work: (context: IExecutionContext) => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    this.calls++;
    const result = await work(
      bindUnitOfWorkTransaction(input, { kind: 'unitOfWorkTransaction', scope: 'data' })
    );
    this.committed = result.isOk();
    return result;
  }
}

const createTransaction = (
  spool: IImportEventSpoolFactory,
  work: IUnitOfWork,
  dispatch: (
    context: IExecutionContext,
    deliveries: ReadonlyArray<LegacyEventDispatch>
  ) => Promise<void>,
  journal: (
    messages: ReadonlyArray<ProjectionMessageDraft>
  ) => Promise<Result<void, DomainError>> = async () => ok(undefined),
  eventRouting = routing,
  sameTx: (
    context: IExecutionContext,
    event: IDomainEvent
  ) => Promise<Result<void, DomainError>> = async () => ok(undefined)
) =>
  new DomainWriteTransaction(
    work,
    {
      registeredDecoderIdentities: () => [],
      encode: (event) =>
        ok({
          producerEventName: event.name.toString(),
          messageName: eventRouting.messageName,
          schemaVersion: 1,
          payload:
            event instanceof RecordsBatchCreated ? { orchestration: event.orchestration } : {},
          route: {
            transactionScope: 'data',
            baseId: baseId.toString(),
            tableId: tableId.toString(),
            streamKey: tableId.toString(),
          },
        }),
      decode: (_name, _version, value) => ok(value),
    },
    { snapshot: () => ok({ generation: 1, resolve: () => ok(eventRouting) }) },
    {
      append: async (_context, messages) =>
        (await journal(messages)).map(() => messages.map(({ eventId }) => ({ eventId }))),
    },
    {
      dispatch: async (dispatchContext, deliveries) => {
        await dispatch(dispatchContext, deliveries);
        return {
          attemptedTargets: deliveries.reduce((n, item) => n + item.targets.length, 0),
          failedTargets: 0,
          failureCodes: [],
        };
      },
    },
    { dispatch: sameTx },
    new NoopLogger(),
    undefined,
    undefined,
    spool
  );

describe('streaming import event snapshots', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'teable-event-test-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('replays every complete original batch after commit, without returning record fields', async () => {
    const unitOfWork = new TestUnitOfWork();
    const seen: string[] = [];
    const occurredAt: string[] = [];
    const deliveredValues: unknown[] = [];
    const deliveredTimes: string[] = [];
    const committedAtDelivery: boolean[] = [];
    const transactionAtDelivery: boolean[] = [];
    const transaction = createTransaction(
      new NodeImportEventSpoolFactory(directory),
      unitOfWork,
      async (dispatchContext, deliveries) => {
        committedAtDelivery.push(unitOfWork.committed);
        transactionAtDelivery.push(dispatchContext.transaction !== undefined);
        for (const { event } of deliveries) {
          seen.push(event.name.toString());
          if (event instanceof RecordsBatchCreated) {
            deliveredValues.push(event.records[0].fields[0].value);
            deliveredTimes.push(event.occurredAt.toDate().toISOString());
          }
        }
      }
    );
    const result = await transaction.executeStream(context, async (_tx, writer) => {
      const tableEvent = TableCreated.create({
        baseId,
        tableId,
        tableName: TableName.create('Import')._unsafeUnwrap(),
        fieldIds: [],
        viewIds: [],
      });
      const first = await writer.append([tableEvent]);
      if (first.isErr()) return err(first.error);
      for (let index = 0; index < 12; index++) {
        const event = createEvent(index);
        occurredAt.push(event.occurredAt.toDate().toISOString());
        const appended = await writer.append([event]);
        if (appended.isErr()) return err(appended.error);
        expect(seen).toEqual([]);
      }
      return ok(12);
    });
    const committed = result._unsafeUnwrap();
    expect(unitOfWork.calls).toBe(1);
    expect(seen).toEqual(['TableCreated', ...Array(12).fill('RecordsBatchCreated')]);
    expect(deliveredValues).toEqual(
      Array.from({ length: 12 }, (_, index) => `${index}:${longValue}`)
    );
    expect(deliveredTimes).toEqual(occurredAt);
    expect(committedAtDelivery).toEqual(Array(13).fill(true));
    expect(transactionAtDelivery).toEqual(Array(13).fill(false));
    expect(committed.value).toBe(12);
    expect(committed.events.map((event) => event.name.toString())).toEqual(seen);
    expect(committed.events.every((event) => !('records' in event))).toBe(true);
    expect(await readdir(directory)).toEqual([]);
  });

  it('finalizes unknown import totals for transactional projections, journal and post-commit delivery', async () => {
    const unitOfWork = new TestUnitOfWork();
    const projected: number[] = [];
    const journaled: unknown[] = [];
    const delivered: number[] = [];
    const transaction = createTransaction(
      new NodeImportEventSpoolFactory(directory),
      unitOfWork,
      async (_context, deliveries) => {
        expect(unitOfWork.committed).toBe(true);
        for (const { event } of deliveries) {
          if (event instanceof RecordsBatchCreated)
            delivered.push(event.orchestration!.totalRecordCount);
        }
      },
      async (messages) => {
        expect(unitOfWork.committed).toBe(false);
        journaled.push(...messages.map((message) => message.payload));
        return ok(undefined);
      },
      {
        ...routing,
        sameTxTargets: [{ consumerId: 'same-tx-import', handler: class {} as never }],
        durableTargets: [
          {
            consumerId: 'durable-import',
            consumerGeneration: 1,
            retry: { maxAttempts: 1, policy: 'exponential-jitter' },
            ordering: 'none',
            idempotency: 'destination-inbox',
            replay: 'safe',
          },
        ],
      },
      async (_context, event) => {
        expect(unitOfWork.committed).toBe(false);
        if (event instanceof RecordsBatchCreated)
          projected.push(event.orchestration!.totalRecordCount);
        return ok(undefined);
      }
    );
    const result = await transaction.executeStream(context, async (_tx, writer) => {
      for (let index = 0; index < 3; index++) {
        const event = createEvent(index);
        const appended = await writer.append([
          RecordsBatchCreated.create({
            baseId,
            tableId,
            records: event.records,
            source: { type: 'import' },
            orchestration: { ...event.orchestration!, totalRecordCount: 0, totalChunkCount: 0 },
          }),
        ]);
        if (appended.isErr()) return err(appended.error);
      }
      return ok(3);
    });
    expect(result._unsafeUnwrap().value).toBe(3);
    expect(projected).toEqual([3, 3, 3]);
    expect(delivered).toEqual([3, 3, 3]);
    expect(journaled).toEqual(
      [0, 1, 2].map((chunkIndex) => ({
        orchestration: {
          operationId: 'import:test',
          totalRecordCount: 3,
          totalChunkCount: 3,
          chunkIndex,
          scope: 'chunk',
        },
      }))
    );
  });

  it('finalizes committed table metadata before any event consumer runs', async () => {
    const unitOfWork = new TestUnitOfWork();
    let ready = false;
    const readinessAtDelivery: boolean[] = [];
    const transaction = createTransaction(
      new NodeImportEventSpoolFactory(directory),
      unitOfWork,
      async () => {
        readinessAtDelivery.push(ready);
      }
    );
    const result = await transaction.executeStream(
      context,
      async (_tx, writer) => {
        const appended = await writer.append([createEvent(0), createEvent(1)]);
        return appended.map(() => 2);
      },
      {
        finalizeAfterCommit: async (finalizationContext) => {
          expect(unitOfWork.committed).toBe(true);
          expect(finalizationContext.transaction).toBeUndefined();
          ready = true;
          return ok(undefined);
        },
      }
    );
    expect(result._unsafeUnwrap().value).toBe(2);
    expect(readinessAtDelivery).toEqual([true, true]);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(['result', 'throw'] as const)(
    'reports %s finalization failure as committed without dispatching pending-table events',
    async (mode) => {
      const unitOfWork = new TestUnitOfWork();
      let delivered = 0;
      const failure = domainError.infrastructure({
        code: 'table.finalize_failed',
        message: 'metadata connection failed',
      });
      const transaction = createTransaction(
        new NodeImportEventSpoolFactory(directory),
        unitOfWork,
        async () => {
          delivered++;
        }
      );
      const result = await transaction.executeStream(
        context,
        async (_tx, writer) => {
          const appended = await writer.append([createEvent(0)]);
          return appended.map(() => 1);
        },
        {
          finalizeAfterCommit: async () => {
            if (mode === 'throw') throw new Error(failure.message);
            return err(failure);
          },
        }
      );
      const committed = result._unsafeUnwrap();
      expect(committed.committed).toBe(true);
      expect(committed.value).toBe(1);
      expect(committed.finalizationError).toMatchObject({
        code: mode === 'throw' ? 'import.finalization_failed' : failure.code,
        message: failure.message,
        details: { committed: true },
      });
      expect(unitOfWork.committed).toBe(true);
      expect(delivered).toBe(0);
      expect(await readdir(directory)).toEqual([]);
    }
  );

  it('does not externally deliver any event when a later data batch rolls back', async () => {
    const unitOfWork = new TestUnitOfWork();
    let dispatched = 0;
    let finalized = false;
    const transaction = createTransaction(
      new NodeImportEventSpoolFactory(directory),
      unitOfWork,
      async () => {
        dispatched++;
      }
    );
    const result = await transaction.executeStream(
      context,
      async (_tx, writer) => {
        for (let index = 0; index < 3; index++) {
          const appended = await writer.append([createEvent(index)]);
          if (appended.isErr()) return err(appended.error);
        }
        return err(
          domainError.validation({ message: 'invalid late row', code: 'import.invalid_row' })
        );
      },
      {
        finalizeAfterCommit: async () => {
          finalized = true;
          return ok(undefined);
        },
      }
    );
    expect(result._unsafeUnwrapErr().code).toBe('import.invalid_row');
    expect(unitOfWork.committed).toBe(false);
    expect(dispatched).toBe(0);
    expect(finalized).toBe(false);
    expect(await readdir(directory)).toEqual([]);
  });

  it('finishes all awaited consumers before replaying background consumers in batch order', async () => {
    const order: string[] = [];
    const transaction = createTransaction(
      new NodeImportEventSpoolFactory(directory),
      new TestUnitOfWork(),
      async (_context, deliveries) => {
        for (const { event, targets } of deliveries) {
          order.push(
            `${targets[0].dispatchMode}:${(event as RecordsBatchCreated).orchestration?.chunkIndex}`
          );
        }
      },
      undefined,
      {
        ...routing,
        directTargets: [
          ...routing.directTargets,
          { consumerId: 'await-consumer', handler: class {} as never, dispatchMode: 'await' },
        ],
      }
    );
    const result = await transaction.executeStream(context, async (_tx, writer) => {
      for (let index = 0; index < 2; index++) {
        const appended = await writer.append([createEvent(index)]);
        if (appended.isErr()) return err(appended.error);
      }
      return ok(undefined);
    });
    expect(result.isOk()).toBe(true);
    expect(order).toEqual(['await:0', 'await:1', 'background:0', 'background:1']);
  });

  it('drains slow nested automation work before reading the next snapshot', async () => {
    const unitOfWork = new TestUnitOfWork();
    let pending = 0;
    let completed = 0;
    let largestPending = 0;
    let replayed = 0;
    const realFactory = new NodeImportEventSpoolFactory(directory);
    const factory: IImportEventSpoolFactory = {
      create: async () =>
        (await realFactory.create()).map((spool) => ({
          append: (events) => spool.append(events),
          dispose: () => spool.dispose(),
          read: async function* () {
            for await (const result of spool.read()) {
              if (unitOfWork.committed) {
                expect(pending).toBe(0);
                expect(completed).toBe(replayed);
                replayed++;
              }
              yield result;
            }
          },
        })),
    };
    const transaction = createTransaction(factory, unitOfWork, async (dispatchContext) => {
      dispatchContext.scheduleBackgroundTask!(() => {
        pending++;
        largestPending = Math.max(largestPending, pending);
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            pending--;
            completed++;
            resolve();
          }, 2)
        );
      });
    });
    const outerTasks: unknown[] = [];
    const result = await transaction.executeStream(
      { ...context, scheduleBackgroundTask: (task) => outerTasks.push(task) },
      async (_tx, writer) => {
        for (let index = 0; index < 12; index++) {
          const appended = await writer.append([createEvent(index)]);
          if (appended.isErr()) return err(appended.error);
        }
        return ok(12);
      }
    );
    expect(result.isOk()).toBe(true);
    expect(completed).toBe(12);
    expect(largestPending).toBe(1);
    expect(outerTasks).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  it('uses one journal batch identity and increasing ordinals without per-batch commits', async () => {
    const unitOfWork = new TestUnitOfWork();
    const identities: Array<{ eventId: string; batchId: string; batchOrdinal: number }> = [];
    const transaction = createTransaction(
      new NodeImportEventSpoolFactory(directory),
      unitOfWork,
      async () => {},
      async (messages) => {
        expect(unitOfWork.committed).toBe(false);
        identities.push(
          ...messages.map(({ eventId, batchId, batchOrdinal }) => ({
            eventId,
            batchId,
            batchOrdinal,
          }))
        );
        return ok(undefined);
      },
      {
        ...routing,
        durableTargets: [
          {
            consumerId: 'durable-import',
            consumerGeneration: 1,
            retry: { maxAttempts: 1, policy: 'exponential-jitter' },
            ordering: 'none',
            idempotency: 'destination-inbox',
            replay: 'safe',
          },
        ],
      }
    );
    const result = await transaction.executeStream(context, async (_tx, writer) => {
      for (let index = 0; index < 3; index++) {
        const appended = await writer.append([createEvent(index)]);
        if (appended.isErr()) return err(appended.error);
      }
      return ok(undefined);
    });
    expect(result.isOk()).toBe(true);
    expect(unitOfWork.calls).toBe(1);
    expect(new Set(identities.map((item) => item.batchId)).size).toBe(1);
    expect(new Set(identities.map((item) => item.eventId)).size).toBe(3);
    expect(identities.map((item) => item.batchOrdinal)).toEqual([0, 1, 2]);
  });

  it.each(['deadlock detected', 'could not serialize access'])(
    'does not replay an exhausted import source after %s',
    async (message) => {
      let inserted = 0;
      let calls = 0;
      let delivered = 0;
      const db = {
        transaction: () => ({
          execute: async <T>(work: (trx: unknown) => Promise<T>) => {
            const original = inserted;
            try {
              return await work({});
            } catch (error) {
              inserted = original;
              throw error;
            }
          },
        }),
      };
      const unitOfWork = new PostgresUnitOfWork(
        db as never,
        db as never,
        { pg: { connectionString: 'postgresql://local/teable' } },
        { pg: { connectionString: 'postgresql://local/teable' } }
      );
      const transaction = createTransaction(
        new NodeImportEventSpoolFactory(directory),
        unitOfWork,
        async () => {
          delivered++;
        }
      );
      const result = await transaction.executeStream(context, async (_tx, writer) => {
        calls++;
        inserted++;
        const appended = await writer.append([createEvent(0)]);
        if (appended.isErr()) return err(appended.error);
        return err(domainError.infrastructure({ message }));
      });
      expect(result._unsafeUnwrapErr().message).toBe(message);
      expect(calls).toBe(1);
      expect(inserted).toBe(0);
      expect(delivered).toBe(0);
      expect(await readdir(directory)).toEqual([]);
    }
  );

  it('rolls back without delivery if a later journal append fails', async () => {
    const unitOfWork = new TestUnitOfWork();
    let appends = 0;
    let delivered = 0;
    const transaction = createTransaction(
      new NodeImportEventSpoolFactory(directory),
      unitOfWork,
      async () => {
        delivered++;
      },
      async () =>
        ++appends === 2
          ? err(
              domainError.infrastructure({
                code: 'journal.failed',
                message: 'journal append failed',
              })
            )
          : ok(undefined),
      {
        ...routing,
        durableTargets: [
          {
            consumerId: 'durable-import',
            consumerGeneration: 1,
            retry: { maxAttempts: 1, policy: 'exponential-jitter' },
            ordering: 'none',
            idempotency: 'destination-inbox',
            replay: 'safe',
          },
        ],
      }
    );
    const result = await transaction.executeStream(context, async (_tx, writer) => {
      for (let index = 0; index < 3; index++) {
        const appended = await writer.append([createEvent(index)]);
        if (appended.isErr()) return err(appended.error);
      }
      return ok(undefined);
    });
    expect(result._unsafeUnwrapErr().code).toBe('journal.failed');
    expect(unitOfWork.committed).toBe(false);
    expect(delivered).toBe(0);
    expect(await readdir(directory)).toEqual([]);
  });

  it('preserves select additions and field changes as original snapshots, not current objects', async () => {
    const spool = (await new NodeImportEventSpoolFactory(directory).create())._unsafeUnwrap();
    const fieldId = FieldId.generate()._unsafeUnwrap();
    const choices = [{ id: 'choOriginal', name: longValue, color: 'blue' }];
    const added = FieldOptionsAdded.create({
      baseId,
      tableId,
      fieldId,
      options: choices,
      oldVersion: 2,
      newVersion: 3,
    });
    const changed = FieldUpdated.create({
      baseId,
      tableId,
      fieldId,
      updatedProperties: ['description'],
      changes: { description: { oldValue: undefined, newValue: longValue } },
      oldVersion: 3,
      newVersion: 4,
    });
    try {
      (await spool.append([added, changed]))._unsafeUnwrap();
      choices[0].name = 'later change';
      const events: IDomainEvent[] = [];
      for await (const result of spool.read()) events.push(...result._unsafeUnwrap());
      expect(events[0]).toBeInstanceOf(FieldOptionsAdded);
      expect((events[0] as FieldOptionsAdded).options).toEqual([
        { id: 'choOriginal', name: longValue, color: 'blue' },
      ]);
      expect((events[0] as FieldOptionsAdded).newVersion).toBe(3);
      expect(events[1]).toBeInstanceOf(FieldUpdated);
      expect((events[1] as FieldUpdated).getPropertyChange('description')).toEqual({
        oldValue: undefined,
        newValue: longValue,
      });
      expect(events[1].occurredAt.toDate()).toEqual(changed.occurredAt.toDate());
    } finally {
      await spool.dispose();
    }
  });

  it('does not report a committed import as failed when a legacy consumer throws', async () => {
    const unitOfWork = new TestUnitOfWork();
    let attempts = 0;
    const transaction = createTransaction(
      new NodeImportEventSpoolFactory(directory),
      unitOfWork,
      async () => {
        attempts++;
        throw new Error('consumer failed');
      }
    );
    const result = await transaction.executeStream(context, async (_tx, writer) => {
      for (let index = 0; index < 3; index++) {
        const appended = await writer.append([createEvent(index)]);
        if (appended.isErr()) return err(appended.error);
      }
      return ok(3);
    });
    expect(result._unsafeUnwrap().value).toBe(3);
    expect(attempts).toBe(3);
    expect(await readdir(directory)).toEqual([]);
  });

  it('stores sensitive snapshots in owner-only temporary files and removes them on disposal', async () => {
    const spool = (await new NodeImportEventSpoolFactory(directory).create())._unsafeUnwrap();
    try {
      (await spool.append([createEvent(0)]))._unsafeUnwrap();
      const [spoolDirectory] = await readdir(directory);
      expect((await stat(join(directory, spoolDirectory))).mode & 0o777).toBe(0o700);
      const [filename] = await readdir(join(directory, spoolDirectory));
      expect((await stat(join(directory, spoolDirectory, filename))).mode & 0o777).toBe(0o600);
      const events: IDomainEvent[] = [];
      for await (const result of spool.read()) {
        expect(result.isOk(), result.isErr() ? JSON.stringify(result.error) : undefined).toBe(true);
        events.push(...result._unsafeUnwrap());
      }
      expect((events[0] as RecordsBatchCreated).records[0].fields[0].value).toBe(`0:${longValue}`);
    } finally {
      await spool.dispose();
    }
    expect(await readdir(directory)).toEqual([]);
  });
});
