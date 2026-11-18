import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { DomainEventName } from '../../domain/shared/DomainEventName';
import { OccurredAt } from '../../domain/shared/OccurredAt';
import { NoopLogger } from '../../ports/defaults/NoopLogger';
import { domainWrite } from '../../ports/DomainWriteTransaction';
import type {
  IDurableSubscriptionCatalog,
  IDurableSubscriptionCatalogSnapshot,
  ProjectionEventRoutingDecision,
  SameTxProjectionTarget,
} from '../../ports/DurableSubscriptionCatalog';
import type { IEventBus } from '../../ports/EventBus';
import type { EventHandlerClass, IEventHandler } from '../../ports/EventHandler';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import { bindUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import type {
  ILegacyEventDispatcher,
  LegacyEventDispatch,
  LegacyEventDispatchReport,
} from '../../ports/LegacyEventDispatcher';
import { EventBusDomainWriteTransaction } from '../../ports/memory/EventBusDomainWriteTransaction';
import type {
  EncodedProjectionMessage,
  IProjectionMessageCodecRegistry,
} from '../../ports/ProjectionMessage';
import type { ISameTxProjectionDispatcher } from '../../ports/SameTxProjectionDispatcher';
import type {
  ITransactionalProjectionMessageJournal,
  ProjectionMessageDraft,
  ProjectionMessageRef,
} from '../../ports/TransactionalProjectionMessageJournal';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../../ports/UnitOfWork';
import { DomainWriteTransaction } from './DomainWriteTransaction';

class TestRecordChanged implements IDomainEvent {
  readonly name = DomainEventName.create('TestRecordChanged')._unsafeUnwrap();
  readonly occurredAt = OccurredAt.create(new Date('2026-08-29T00:00:00.000Z'))._unsafeUnwrap();
}

class TestLegacyProjection implements IEventHandler<TestRecordChanged> {
  async handle(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class TestSameTxProjection implements IEventHandler<TestRecordChanged> {
  async handle(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

const context: IExecutionContext = {
  actorId: ActorId.create('usr-test')._unsafeUnwrap(),
  requestId: 'req-test',
};

const successfulDispatchReport = (attemptedTargets: number): LegacyEventDispatchReport => ({
  attemptedTargets,
  failedTargets: 0,
  failureCodes: [],
});

class TestUnitOfWork implements IUnitOfWork {
  entered = false;
  committed = false;

  constructor(
    private readonly transformTransactionContext: (
      value: IExecutionContext
    ) => IExecutionContext = (value) => value
  ) {}

  async withTransaction<T>(
    inputContext: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    this.entered = true;
    const afterCommitHandlers: Array<() => Promise<void> | void> = [];
    const transaction: IUnitOfWorkTransaction = {
      kind: 'unitOfWorkTransaction',
      scope: options?.scope ?? 'data',
      afterCommit: (handler) => afterCommitHandlers.push(handler),
    };
    const result = await work(
      this.transformTransactionContext(bindUnitOfWorkTransaction(inputContext, transaction))
    );
    if (result.isErr()) {
      return err(result.error);
    }
    this.committed = true;
    for (const handler of afterCommitHandlers) {
      await handler();
    }
    return result;
  }
}

const emptyCodecRegistry: IProjectionMessageCodecRegistry = {
  registeredDecoderIdentities: () => [],
  encode: () => err(domainError.unexpected({ message: 'must not encode' })),
  decode: (_messageName, _schemaVersion, payload) => ok(payload),
};

const noopSameTxDispatcher: ISameTxProjectionDispatcher = {
  dispatch: async () => ok(undefined),
};

describe('DomainWriteTransaction', () => {
  it('fails before work when called inside an existing transaction', async () => {
    const unitOfWork = new TestUnitOfWork();
    let workCalls = 0;
    const transaction = new DomainWriteTransaction(
      unitOfWork,
      emptyCodecRegistry,
      {
        snapshot: () =>
          err(domainError.unexpected({ message: 'must not resolve catalog for nested write' })),
      },
      { append: async () => err(domainError.unexpected({ message: 'must not append' })) },
      { dispatch: async () => successfulDispatchReport(0) },
      noopSameTxDispatcher,
      new NoopLogger()
    );
    const existingTransaction: IUnitOfWorkTransaction = {
      kind: 'unitOfWorkTransaction',
      scope: 'data',
      afterCommit: () => undefined,
    };

    const result = await transaction.execute(
      bindUnitOfWorkTransaction(context, existingTransaction),
      async () => {
        workCalls += 1;
        return ok(domainWrite.unchanged(undefined));
      }
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('domain_event.transaction_owner_required');
    expect(workCalls).toBe(0);
    expect(unitOfWork.entered).toBe(false);
  });

  it('appends the encoded durable message in the same transaction as the business work', async () => {
    const event = new TestRecordChanged();
    const order: string[] = [];
    const unitOfWork = new TestUnitOfWork((transactionContext) => ({
      ...transactionContext,
      requestId: 'req-final-transaction-attempt',
    }));
    const routing: ProjectionEventRoutingDecision = {
      messageName: 'table.record.changed.v1',
      durableMode: 'active',
      sameTxTargets: [],
      durableTargets: [
        {
          consumerId: 'teable.test.projection',
          consumerGeneration: 1,
          retry: { maxAttempts: 3, policy: 'exponential-jitter' },
          ordering: 'none',
          idempotency: 'destination-inbox',
          replay: 'safe',
        },
      ],
      directTargets: [],
    };
    const snapshot: IDurableSubscriptionCatalogSnapshot = {
      generation: 7,
      resolve: () => ok(routing),
    };
    const catalog: IDurableSubscriptionCatalog = {
      snapshot: () => {
        order.push('catalog');
        expect(unitOfWork.entered).toBe(false);
        return ok(snapshot);
      },
    };
    const encoded: EncodedProjectionMessage = {
      producerEventName: 'TestRecordChanged',
      messageName: 'table.record.changed.v1',
      schemaVersion: 1,
      payload: { recordId: 'rec-test', oldVersion: 1, newVersion: 2 },
      route: {
        transactionScope: 'data',
        baseId: 'bse-test',
        tableId: 'tbl-test',
        streamKey: 'rec-test',
      },
    };
    const codecRegistry: IProjectionMessageCodecRegistry = {
      registeredDecoderIdentities: () => [],
      encode: () => {
        order.push('encode');
        return ok(encoded);
      },
      decode: (_messageName, _schemaVersion, payload) => ok(payload),
    };
    const appended: ProjectionMessageDraft[] = [];
    const journal: ITransactionalProjectionMessageJournal = {
      append: async (transactionContext, messages) => {
        order.push('append');
        expect(transactionContext.transaction?.kind).toBe('unitOfWorkTransaction');
        expect(transactionContext.requestId).toBe('req-final-transaction-attempt');
        appended.push(...messages);
        return ok<ReadonlyArray<ProjectionMessageRef>>(
          messages.map((message) => ({ eventId: message.eventId }))
        );
      },
    };
    const transaction = new DomainWriteTransaction(
      unitOfWork,
      codecRegistry,
      catalog,
      journal,
      { dispatch: async () => successfulDispatchReport(0) },
      noopSameTxDispatcher,
      new NoopLogger(),
      (kind) => `${kind}-id`
    );

    const result = await transaction.execute(context, async (transactionContext) => {
      order.push('work');
      expect(transactionContext.transaction?.kind).toBe('unitOfWorkTransaction');
      return ok(domainWrite.changed({ ok: true }, [event]));
    });

    expect(result.isOk()).toBe(true);
    expect(order).toEqual(['catalog', 'work', 'encode', 'append']);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.requiredConsumers.map((target) => target.consumerId)).toEqual([
      'teable.test.projection',
    ]);
    expect(appended[0]?.catalogGeneration).toBe(7);
    expect(result._unsafeUnwrap().committed).toBe(true);
    expect(result._unsafeUnwrap().value).toEqual({ ok: true });
  });

  it('runs same-tx projections inside the transaction and rolls back when they fail', async () => {
    const event = new TestRecordChanged();
    const sameTxTarget: SameTxProjectionTarget = {
      consumerId: 'teable.host.record-history.record-updated',
      handler: TestSameTxProjection as EventHandlerClass<IDomainEvent>,
    };
    const routing: ProjectionEventRoutingDecision = {
      messageName: 'table.record.changed.v1',
      durableMode: 'active',
      sameTxTargets: [sameTxTarget],
      durableTargets: [],
      directTargets: [],
    };
    let journalAppends = 0;
    let dispatched = false;
    const sameTxDispatcher: ISameTxProjectionDispatcher = {
      dispatch: async (transactionContext, dispatchedEvent, targets) => {
        expect(transactionContext.transaction?.kind).toBe('unitOfWorkTransaction');
        expect(dispatchedEvent).toBe(event);
        expect(targets).toEqual([sameTxTarget]);
        dispatched = true;
        return err(
          domainError.infrastructure({
            code: 'record_history.write_failed',
            message: 'history insert failed',
          })
        );
      },
    };
    const unitOfWork = new TestUnitOfWork();
    const transaction = new DomainWriteTransaction(
      unitOfWork,
      emptyCodecRegistry,
      { snapshot: () => ok({ generation: 1, resolve: () => ok(routing) }) },
      {
        append: async () => {
          journalAppends += 1;
          return ok([]);
        },
      },
      { dispatch: async () => successfulDispatchReport(0) },
      sameTxDispatcher,
      new NoopLogger()
    );

    const result = await transaction.execute(context, async () =>
      ok(domainWrite.changed({ ok: true }, [event]))
    );

    expect(dispatched).toBe(true);
    expect(journalAppends).toBe(0);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record_history.write_failed');
    expect(unitOfWork.committed).toBe(false);
  });

  it('groups await and background direct targets instead of collapsing them', async () => {
    const event = new TestRecordChanged();
    const routing: ProjectionEventRoutingDecision = {
      messageName: 'table.record.changed.v1',
      durableMode: 'active',
      sameTxTargets: [],
      durableTargets: [],
      directTargets: [
        {
          consumerId: 'teable.host.schema.sync',
          handler: TestLegacyProjection as EventHandlerClass<IDomainEvent>,
          dispatchMode: 'await',
        },
        {
          consumerId: 'teable.host.realtime',
          handler: TestLegacyProjection as EventHandlerClass<IDomainEvent>,
          dispatchMode: 'background',
        },
      ],
    };
    const dispatched: LegacyEventDispatch[][] = [];
    const legacyDispatcher: ILegacyEventDispatcher = {
      dispatch: async (_context, deliveries) => {
        dispatched.push([...deliveries]);
        return successfulDispatchReport(
          deliveries.reduce((sum, item) => sum + item.targets.length, 0)
        );
      },
    };
    const transaction = new DomainWriteTransaction(
      new TestUnitOfWork(),
      emptyCodecRegistry,
      { snapshot: () => ok({ generation: 1, resolve: () => ok(routing) }) },
      { append: async () => ok([]) },
      legacyDispatcher,
      noopSameTxDispatcher,
      new NoopLogger()
    );

    const result = await transaction.execute(context, async () =>
      ok(domainWrite.changed({ ok: true }, [event]))
    );

    expect(result.isOk()).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.[0]?.targets.map((target) => target.dispatchMode)).toEqual(['await']);
    const committed = result._unsafeUnwrap();
    expect(committed.status).toBe('committed');
    if (committed.status === 'committed') {
      expect(committed.directDelivery.awaited.attemptedTargets).toBe(1);
      expect(committed.directDelivery.background.scheduledTargets).toBe(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]?.[0]?.targets.map((target) => target.dispatchMode)).toEqual([
      'background',
    ]);
  });

  it('does not await background direct dispatch on the request', async () => {
    const event = new TestRecordChanged();
    const routing: ProjectionEventRoutingDecision = {
      messageName: 'table.record.changed.v1',
      durableMode: 'active',
      sameTxTargets: [],
      durableTargets: [],
      directTargets: [
        {
          consumerId: 'teable.host.realtime',
          handler: TestLegacyProjection as EventHandlerClass<IDomainEvent>,
          dispatchMode: 'background',
        },
      ],
    };
    let releaseHold: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const seenActorIds: string[] = [];
    const legacyDispatcher: ILegacyEventDispatcher = {
      dispatch: async (dispatchContext) => {
        seenActorIds.push(dispatchContext.actorId.toString());
        await hold;
        return successfulDispatchReport(1);
      },
    };
    const transaction = new DomainWriteTransaction(
      new TestUnitOfWork(),
      emptyCodecRegistry,
      { snapshot: () => ok({ generation: 1, resolve: () => ok(routing) }) },
      { append: async () => ok([]) },
      legacyDispatcher,
      noopSameTxDispatcher,
      new NoopLogger()
    );
    const firstContext: IExecutionContext = {
      actorId: ActorId.create('usr-first')._unsafeUnwrap(),
    };
    const secondContext: IExecutionContext = {
      actorId: ActorId.create('usr-second')._unsafeUnwrap(),
    };

    const first = await transaction.execute(firstContext, async () =>
      ok(domainWrite.changed({ ok: true }, [event]))
    );
    const second = await transaction.execute(secondContext, async () =>
      ok(domainWrite.changed({ ok: true }, [event]))
    );

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    const firstCommitted = first._unsafeUnwrap();
    expect(firstCommitted.status).toBe('committed');
    if (firstCommitted.status === 'committed') {
      expect(firstCommitted.directDelivery.background.scheduledTargets).toBe(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seenActorIds).toEqual(['usr-first', 'usr-second']);
    releaseHold?.();
  });
});

describe('withBatchTransaction', () => {
  const noopLogger = {
    child() {
      return this;
    },
    scope() {
      return this;
    },
    debug() {},
    info() {},
    warn() {},
    error() {},
  };

  const createBatchUnitOfWork = () => {
    let beginCount = 0;
    let commitCount = 0;
    let rollbackCount = 0;
    let activeDepth = 0;

    return {
      get beginCount() {
        return beginCount;
      },
      get commitCount() {
        return commitCount;
      },
      get rollbackCount() {
        return rollbackCount;
      },
      async withTransaction<T>(
        context: IExecutionContext,
        work: (ctx: IExecutionContext) => Promise<Result<T, DomainError>>,
        options?: { scope?: 'meta' | 'data' }
      ) {
        const scope = options?.scope ?? 'data';
        if (context.transaction) {
          return work(context);
        }
        beginCount += 1;
        activeDepth += 1;
        const afterCommitHandlers: Array<() => Promise<void> | void> = [];
        const afterRollbackHandlers: Array<() => Promise<void> | void> = [];
        const tx = {
          kind: 'unitOfWorkTransaction' as const,
          scope,
          afterCommit(fn: () => Promise<void> | void) {
            afterCommitHandlers.push(fn);
          },
          afterRollback(fn: () => Promise<void> | void) {
            afterRollbackHandlers.push(fn);
          },
        };
        try {
          const result = await work({
            ...context,
            transaction: tx,
            transactions: {
              ...(context.transactions ?? {}),
              meta: tx,
              data: tx,
            },
          });
          if (result.isOk()) {
            commitCount += 1;
            for (const fn of afterCommitHandlers) {
              await fn();
            }
          } else {
            rollbackCount += 1;
            for (const fn of afterRollbackHandlers) {
              await fn();
            }
          }
          return result;
        } finally {
          activeDepth -= 1;
        }
      },
      async savepoint<T>(
        inputContext: IExecutionContext,
        work: (ctx: IExecutionContext) => Promise<Result<T, DomainError>>
      ): Promise<Result<T, DomainError>> {
        return work(inputContext);
      },
      isActive: () => activeDepth > 0,
    };
  };

  it('shares one outer tx across execute calls, runs sameTx inside tx, and defers await/background delivery until outer commit', async () => {
    const { DomainEventName } = await import('../../domain/shared/DomainEventName');
    const { OccurredAt } = await import('../../domain/shared/OccurredAt');
    const { BaseId } = await import('../../domain/base/BaseId');
    const { TableId } = await import('../../domain/table/TableId');

    const unitOfWork = createBatchUnitOfWork();
    const calls: string[] = [];
    const seenBgActors: string[] = [];

    class BatchTestEvent {
      readonly name = DomainEventName.tableRenamed();
      readonly occurredAt = OccurredAt.now();
      readonly baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
      readonly tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
      constructor(readonly label: string) {}
    }

    const SameTxDummy = class {};
    const DirectAwaitDummy = class {};
    const DirectBgDummy = class {};

    const routing = {
      messageName: 'test.batch.v1',
      durableMode: 'active' as const,
      sameTxTargets: [{ consumerId: 'same-tx', handler: SameTxDummy as never }],
      durableTargets: [
        {
          consumerId: 'durable-one',
          consumerGeneration: 1,
          retry: { maxAttempts: 3, policy: 'exponential-jitter' as const },
          ordering: 'none' as const,
          idempotency: 'destination-inbox' as const,
          replay: 'safe' as const,
        },
      ],
      directTargets: [
        {
          consumerId: 'direct-await',
          handler: DirectAwaitDummy as never,
          dispatchMode: 'await' as const,
        },
        {
          consumerId: 'direct-bg',
          handler: DirectBgDummy as never,
          dispatchMode: 'background' as const,
        },
      ],
    };

    const appendedBatches: string[][] = [];
    const tx = new (await import('./DomainWriteTransaction')).DomainWriteTransaction(
      unitOfWork as never,
      {
        registeredDecoderIdentities: () => [],
        encode: (event) =>
          ok({
            producerEventName: event.name.toString(),
            messageName: routing.messageName,
            schemaVersion: 1,
            payload: { label: (event as BatchTestEvent).label },
            route: {
              transactionScope: 'data',
              baseId: `bse${'a'.repeat(16)}`,
              tableId: `tbl${'a'.repeat(16)}`,
              streamKey: `tbl${'a'.repeat(16)}`,
            },
          }),
        decode: (_n, _v, val) => ok(val),
      },
      { snapshot: () => ok({ generation: 1, resolve: () => ok(routing) }) },
      {
        append: async (_ctx, messages) => {
          appendedBatches.push(messages.map((m) => m.eventId));
          return ok(messages.map(({ eventId }) => ({ eventId })));
        },
      },
      {
        dispatch: async (ctx, deliveries) => {
          for (const d of deliveries) {
            for (const t of d.targets) {
              if (t.consumerId === 'direct-bg') {
                seenBgActors.push(ctx.actorId.toString());
              }
              calls.push(`direct:${t.dispatchMode}:${(d.event as BatchTestEvent).label}`);
            }
          }
          return {
            attemptedTargets: deliveries.reduce((n, item) => n + item.targets.length, 0),
            failedTargets: 0,
            failureCodes: [],
          };
        },
      },
      {
        dispatch: async (ctx, event) => {
          expect(ctx.transaction).toBeDefined();
          calls.push(`sameTx:${(event as BatchTestEvent).label}`);
          return ok(undefined);
        },
      },
      noopLogger as never
    );

    const rootContext: IExecutionContext = {
      actorId: ActorId.create('usr-batch')._unsafeUnwrap(),
    };

    const result = await tx.withBatchTransaction(rootContext, async (batchContext) => {
      const r1 = await tx.execute(batchContext, async (innerTxCtx) => {
        expect(innerTxCtx.transaction).toBe(batchContext.transaction);
        return ok(domainWrite.changed('step1', [new BatchTestEvent('one')]));
      });
      if (r1.isErr()) return err(r1.error);
      expect(calls).toEqual(['sameTx:one']);

      const r2 = await tx.execute(batchContext, async (innerTxCtx) => {
        expect(innerTxCtx.transaction).toBe(batchContext.transaction);
        return ok(domainWrite.changed('step2', [new BatchTestEvent('two')]));
      });
      if (r2.isErr()) return err(r2.error);

      expect(unitOfWork.beginCount).toBe(1);
      expect(unitOfWork.commitCount).toBe(0);
      expect(calls).toEqual(['sameTx:one', 'sameTx:two']);
      return ok({ one: r1.value.value, two: r2.value.value });
    });

    expect(result.isOk()).toBe(true);
    expect(unitOfWork.beginCount).toBe(1);
    expect(unitOfWork.commitCount).toBe(1);
    expect(appendedBatches).toHaveLength(2);
    expect(calls).toContain('direct:await:one');
    expect(calls).toContain('direct:await:two');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toContain('direct:background:one');
    expect(calls).toContain('direct:background:two');
    expect(seenBgActors).toEqual(['usr-batch', 'usr-batch']);
  });

  it('rolls back outer tx and dispatches 0 direct or background events when command k fails', async () => {
    const { err } = await import('neverthrow');
    const { domainError } = await import('../../domain/shared/DomainError');
    const { DomainEventName } = await import('../../domain/shared/DomainEventName');
    const { OccurredAt } = await import('../../domain/shared/OccurredAt');

    const unitOfWork = createBatchUnitOfWork();
    const dispatchedDirect: string[] = [];
    const publishedBus: unknown[] = [];

    class BatchFailEvent {
      readonly name = DomainEventName.tableRenamed();
      readonly occurredAt = OccurredAt.now();
    }

    const DirectAwaitDummy = class {};
    const DirectBgDummy = class {};
    const routing = {
      messageName: 'test.batch.v1',
      durableMode: 'active' as const,
      sameTxTargets: [{ consumerId: 'same-tx', handler: class {} as never }],
      durableTargets: [],
      directTargets: [
        {
          consumerId: 'direct-await',
          handler: DirectAwaitDummy as never,
          dispatchMode: 'await' as const,
        },
        {
          consumerId: 'direct-bg',
          handler: DirectBgDummy as never,
          dispatchMode: 'background' as const,
        },
      ],
    };

    const eventBus: IEventBus = {
      async publish(_ctx, event) {
        publishedBus.push(event);
        return ok(undefined);
      },
      async publishMany(_ctx, events) {
        publishedBus.push(...events);
        return ok(undefined);
      },
    };

    const tx = new (await import('./DomainWriteTransaction')).DomainWriteTransaction(
      unitOfWork as never,
      {
        registeredDecoderIdentities: () => [],
        encode: (event) =>
          ok({
            producerEventName: event.name.toString(),
            messageName: routing.messageName,
            schemaVersion: 1,
            payload: {},
            route: {
              transactionScope: 'data',
              baseId: `bse${'a'.repeat(16)}`,
              tableId: `tbl${'a'.repeat(16)}`,
              streamKey: `tbl${'a'.repeat(16)}`,
            },
          }),
        decode: (_n, _v, val) => ok(val),
      },
      { snapshot: () => ok({ generation: 1, resolve: () => ok(routing) }) },
      { append: async (_ctx, messages) => ok(messages.map(({ eventId }) => ({ eventId }))) },
      {
        dispatch: async (_ctx, deliveries) => {
          dispatchedDirect.push(...deliveries.map((d) => d.event.name.toString()));
          return { attemptedTargets: deliveries.length, failedTargets: 0, failureCodes: [] };
        },
      },
      { dispatch: async () => ok(undefined) },
      noopLogger as never,
      undefined,
      eventBus
    );

    const rootContext: IExecutionContext = {
      actorId: ActorId.create('usr-rollback')._unsafeUnwrap(),
    };

    const result = await tx.withBatchTransaction(rootContext, async (batchContext) => {
      const r1 = await tx.execute(batchContext, async () =>
        ok(domainWrite.changed('step1', [new BatchFailEvent()]))
      );
      if (r1.isErr()) return r1;

      const r2 = await tx.execute(batchContext, async () =>
        err(domainError.conflict({ message: 'step 2 failed' }))
      );
      return r2;
    });

    expect(result.isErr()).toBe(true);
    expect(unitOfWork.commitCount).toBe(0);
    expect(unitOfWork.rollbackCount).toBe(1);
    expect(dispatchedDirect).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispatchedDirect).toEqual([]);
    expect(publishedBus).toEqual([]);
  });

  it('allows re-entrant nested withBatchTransaction while still rejecting unowned raw context.transaction', async () => {
    const { DomainEventName } = await import('../../domain/shared/DomainEventName');
    const { OccurredAt } = await import('../../domain/shared/OccurredAt');

    const unitOfWork = createBatchUnitOfWork();
    const directCalls: string[] = [];

    class ReentrantEvent {
      readonly name = DomainEventName.tableRenamed();
      readonly occurredAt = OccurredAt.now();
    }

    const routing = {
      messageName: 'test.reentrant.v1',
      durableMode: 'active' as const,
      sameTxTargets: [],
      durableTargets: [],
      directTargets: [
        { consumerId: 'direct-await', handler: class {} as never, dispatchMode: 'await' as const },
      ],
    };

    const tx = new (await import('./DomainWriteTransaction')).DomainWriteTransaction(
      unitOfWork as never,
      {
        registeredDecoderIdentities: () => [],
        encode: (event) =>
          ok({
            producerEventName: event.name.toString(),
            messageName: routing.messageName,
            schemaVersion: 1,
            payload: {},
            route: {
              transactionScope: 'data',
              baseId: `bse${'a'.repeat(16)}`,
              tableId: `tbl${'a'.repeat(16)}`,
              streamKey: `tbl${'a'.repeat(16)}`,
            },
          }),
        decode: (_n, _v, val) => ok(val),
      },
      { snapshot: () => ok({ generation: 1, resolve: () => ok(routing) }) },
      { append: async (_ctx, messages) => ok(messages.map(({ eventId }) => ({ eventId }))) },
      {
        dispatch: async (_ctx, deliveries) => {
          directCalls.push(...deliveries.map((d) => d.event.name.toString()));
          return { attemptedTargets: deliveries.length, failedTargets: 0, failureCodes: [] };
        },
      },
      { dispatch: async () => ok(undefined) },
      noopLogger as never
    );

    const rootContext: IExecutionContext = {
      actorId: ActorId.create('usr-reentrant')._unsafeUnwrap(),
    };

    const nestedResult = await tx.withBatchTransaction(rootContext, async (outerCtx) => {
      const innerResult = await tx.withBatchTransaction(outerCtx, async (innerCtx) => {
        expect(innerCtx.transaction).toBe(outerCtx.transaction);
        return tx.execute(innerCtx, async () =>
          ok(domainWrite.changed('inner', [new ReentrantEvent()]))
        );
      });
      expect(directCalls).toEqual([]);
      expect(unitOfWork.commitCount).toBe(0);
      return innerResult;
    });

    expect(nestedResult.isOk()).toBe(true);
    expect(unitOfWork.beginCount).toBe(1);
    expect(unitOfWork.commitCount).toBe(1);
    expect(directCalls).toHaveLength(1);

    const unownedResult = await tx.execute(
      {
        ...rootContext,
        transaction: { kind: 'unitOfWorkTransaction', scope: 'data' },
      },
      async () => ok(domainWrite.unchanged('should-fail'))
    );
    expect(unownedResult.isErr()).toBe(true);
    expect(unownedResult._unsafeUnwrapErr().code).toBe('domain_event.transaction_owner_required');
  });

  it('EventBusDomainWriteTransaction.withBatchTransaction shares 1 tx, runs SameTxProjection inside tx, and publishes 0 events on failure', async () => {
    const { err } = await import('neverthrow');
    const { domainError } = await import('../../domain/shared/DomainError');
    const { DomainEventName } = await import('../../domain/shared/DomainEventName');
    const { OccurredAt } = await import('../../domain/shared/OccurredAt');
    const { registerSameTxProjection } = await import('../projections/SameTxProjection');
    const { SameTxProjectionDispatcher } = await import('./SameTxProjectionDispatcher');

    class BusBatchEvent {
      readonly name = DomainEventName.tableRenamed();
      readonly occurredAt = OccurredAt.now();
      constructor(readonly step: string) {}
    }

    const sameTxLog: Array<{ step: string; hasTx: boolean }> = [];
    let failProjection = false;

    class RecordingProjection {
      async handle(ctx: IExecutionContext, event: BusBatchEvent) {
        sameTxLog.push({ step: event.step, hasTx: Boolean(ctx.transaction) });
        if (failProjection) {
          return err(domainError.unexpected({ message: 'projection failed' }));
        }
        return ok(undefined);
      }
    }

    const unregister = registerSameTxProjection(
      BusBatchEvent as never,
      RecordingProjection as never,
      {
        id: 'batch-spec-test-proj',
      }
    );

    try {
      const dispatcher = new SameTxProjectionDispatcher({
        resolve: () => new RecordingProjection(),
        isRegistered: () => true,
      } as never);

      const createBusTx = () => {
        const unitOfWork = createBatchUnitOfWork();
        const published: unknown[] = [];
        const eventBus: IEventBus = {
          async publish(_ctx, event) {
            published.push(event);
            return ok(undefined);
          },
          async publishMany(_ctx, events) {
            published.push(...events);
            return ok(undefined);
          },
        };
        const tx = new EventBusDomainWriteTransaction(unitOfWork as never, eventBus, dispatcher);
        return { unitOfWork, published, tx };
      };

      const rootContext: IExecutionContext = {
        actorId: ActorId.create('usr-bus-batch')._unsafeUnwrap(),
      };

      // Case 1: success defers publishMany until outer commit
      const s1 = createBusTx();
      const okRes = await s1.tx.withBatchTransaction(rootContext, async (batchCtx) => {
        const a = await s1.tx.execute(batchCtx, async () =>
          ok(domainWrite.changed('a', [new BusBatchEvent('one')]))
        );
        if (a.isErr()) return err(a.error);
        expect(sameTxLog).toEqual([{ step: 'one', hasTx: true }]);
        expect(s1.published).toHaveLength(0);

        const b = await s1.tx.execute(batchCtx, async () =>
          ok(domainWrite.changed('b', [new BusBatchEvent('two')]))
        );
        if (b.isErr()) return err(b.error);
        expect(s1.published).toHaveLength(0);
        return ok('done');
      });
      expect(okRes.isOk()).toBe(true);
      expect(s1.unitOfWork.beginCount).toBe(1);
      expect(s1.unitOfWork.commitCount).toBe(1);
      expect(sameTxLog).toEqual([
        { step: 'one', hasTx: true },
        { step: 'two', hasTx: true },
      ]);
      expect(s1.published).toHaveLength(2);

      // Case 2: failure at command k rolls back and publishes 0 events
      sameTxLog.length = 0;
      const s2 = createBusTx();
      const failCmdRes = await s2.tx.withBatchTransaction(rootContext, async (batchCtx) => {
        const a = await s2.tx.execute(batchCtx, async () =>
          ok(domainWrite.changed('a', [new BusBatchEvent('one')]))
        );
        if (a.isErr()) return a;
        return s2.tx.execute(batchCtx, async () =>
          err(domainError.conflict({ message: 'cmd 2 boom' }))
        );
      });
      expect(failCmdRes.isErr()).toBe(true);
      expect(s2.unitOfWork.rollbackCount).toBe(1);
      expect(s2.published).toHaveLength(0);

      // Case 3: SameTxProjection returns err -> aborts batch tx and publishes 0 events
      sameTxLog.length = 0;
      failProjection = true;
      const s3 = createBusTx();
      const failProjRes = await s3.tx.withBatchTransaction(rootContext, async (batchCtx) => {
        return s3.tx.execute(batchCtx, async () =>
          ok(domainWrite.changed('a', [new BusBatchEvent('boom')]))
        );
      });
      expect(failProjRes.isErr()).toBe(true);
      expect(s3.unitOfWork.rollbackCount).toBe(1);
      expect(s3.published).toHaveLength(0);
    } finally {
      unregister();
    }
  });

  it('Item 1: clears deferred afterCommit queue before unitOfWork retry so rolled-back attempts emit 0 ghost events', async () => {
    const { DomainEventName } = await import('../../domain/shared/DomainEventName');
    const { OccurredAt } = await import('../../domain/shared/OccurredAt');

    class RetryEvent implements IDomainEvent {
      readonly name = DomainEventName.tableRenamed();
      readonly occurredAt = OccurredAt.now();
      constructor(readonly attempt: number) {}
    }

    const createRetryableUnitOfWork = () => {
      let attempts = 0;
      return {
        get attempts() {
          return attempts;
        },
        async withTransaction<T>(
          inputContext: IExecutionContext,
          work: (ctx: IExecutionContext) => Promise<Result<T, DomainError>>,
          options?: { scope?: 'meta' | 'data' }
        ): Promise<Result<T, DomainError>> {
          const scope = options?.scope ?? 'data';
          if (inputContext.transaction) {
            return work(inputContext);
          }
          for (;;) {
            attempts += 1;
            const tx: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction', scope };
            const res = await work({
              ...inputContext,
              transaction: tx,
              transactions: { ...(inputContext.transactions ?? {}), meta: tx, data: tx },
            });
            if (res.isErr() && res.error.message.includes('deadlock detected') && attempts < 3) {
              continue;
            }
            return res;
          }
        },
      };
    };

    const routing = {
      messageName: 'test.retry.v1',
      durableMode: 'active' as const,
      sameTxTargets: [],
      durableTargets: [],
      directTargets: [
        { consumerId: 'direct-await', handler: class {} as never, dispatchMode: 'await' as const },
      ],
    };

    const uow = createRetryableUnitOfWork();
    const publishedAttempts: number[] = [];
    const directAttempts: number[] = [];
    const journalBatches: number[] = [];

    const tx = new DomainWriteTransaction(
      uow as never,
      {
        registeredDecoderIdentities: () => [],
        encode: (event) =>
          ok({
            producerEventName: event.name.toString(),
            messageName: routing.messageName,
            schemaVersion: 1,
            payload: { attempt: (event as RetryEvent).attempt },
            route: {
              transactionScope: 'data',
              baseId: `bse${'a'.repeat(16)}`,
              tableId: `tbl${'a'.repeat(16)}`,
              streamKey: `tbl${'a'.repeat(16)}`,
            },
          }),
        decode: (_n, _v, val) => ok(val),
      },
      { snapshot: () => ok({ generation: 1, resolve: () => ok(routing) }) },
      {
        append: async (_ctx, messages) => {
          journalBatches.push(messages.length);
          return ok(messages.map(({ eventId }) => ({ eventId })));
        },
      },
      {
        dispatch: async (_ctx, deliveries) => {
          for (const d of deliveries) {
            directAttempts.push((d.event as RetryEvent).attempt);
          }
          return { attemptedTargets: deliveries.length, failedTargets: 0, failureCodes: [] };
        },
      },
      noopSameTxDispatcher,
      noopLogger as never,
      undefined,
      {
        recordPublished(events) {
          for (const e of events) publishedAttempts.push((e as RetryEvent).attempt);
        },
      }
    );

    let callNum = 0;
    const result = await tx.withBatchTransaction(context, async (batchCtx) => {
      callNum += 1;
      const attemptNo = callNum;
      await tx.execute(batchCtx, async () =>
        ok(domainWrite.changed('step', [new RetryEvent(attemptNo)]))
      );
      if (attemptNo === 1) {
        return err(domainError.infrastructure({ message: 'deadlock detected on attempt 1' }));
      }
      return ok('committed-attempt-2');
    });

    expect(result.isOk()).toBe(true);
    expect(uow.attempts).toBe(2);
    expect(publishedAttempts).toEqual([2]);
    expect(directAttempts).toEqual([2]);

    const busUow = createRetryableUnitOfWork();
    const busPublished: number[] = [];
    const busTx = new EventBusDomainWriteTransaction(busUow as never, {
      publish: async (_c, ev) => {
        busPublished.push((ev as RetryEvent).attempt);
        return ok(undefined);
      },
      publishMany: async (_c, evs) => {
        busPublished.push(...evs.map((e) => (e as RetryEvent).attempt));
        return ok(undefined);
      },
    });
    let busAttempt = 0;
    const busRes = await busTx.withBatchTransaction(context, async (batchCtx) => {
      busAttempt += 1;
      const currentAttempt = busAttempt;
      await busTx.execute(batchCtx, async () =>
        ok(domainWrite.changed('step', [new RetryEvent(currentAttempt)]))
      );
      if (currentAttempt === 1) {
        return err(domainError.infrastructure({ message: 'deadlock detected on attempt 1' }));
      }
      return ok('bus-attempt-2');
    });
    expect(busRes.isOk()).toBe(true);
    expect(busPublished).toEqual([2]);
  });

  it('Item 2: isolates throwing afterCommit tasks, logs committed error, runs remaining tasks, and still returns ok', async () => {
    const unitOfWork = createBatchUnitOfWork();
    const errorLogs: Array<{ message: string; context?: Record<string, unknown> }> = [];
    const spyLogger = {
      child() {
        return this;
      },
      scope() {
        return this;
      },
      debug() {},
      info() {},
      warn() {},
      error(message: string, ctx?: Record<string, unknown>) {
        errorLogs.push({ message, context: ctx });
      },
    };
    const tx = new DomainWriteTransaction(
      unitOfWork as never,
      emptyCodecRegistry,
      {
        snapshot: () =>
          ok({
            generation: 1,
            resolve: () =>
              ok({
                messageName: 'test.after_commit.v1',
                durableMode: 'active',
                sameTxTargets: [],
                durableTargets: [],
                directTargets: [],
              }),
          }),
      },
      { append: async () => ok([]) },
      { dispatch: async () => successfulDispatchReport(0) },
      noopSameTxDispatcher,
      spyLogger as never
    );

    const completed: string[] = [];
    const res = await tx.withBatchTransaction(context, async (batchCtx) => {
      batchCtx.batchTransaction!.enqueueAfterCommit(async () => {
        completed.push('task1-before-throw');
        throw new Error('afterCommit task 1 failed');
      });
      batchCtx.batchTransaction!.enqueueAfterCommit(async () => {
        completed.push('task2');
      });
      batchCtx.batchTransaction!.enqueueAfterCommit(async () => {
        completed.push('task3');
      });
      return ok('db-committed');
    });

    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toBe('db-committed');
    expect(completed).toEqual(['task1-before-throw', 'task2', 'task3']);
    expect(errorLogs.some((e) => e.context?.committed === true)).toBe(true);
  });

  it('Item 3: marks batch rollback-only when an inner command returns err even if the caller ignores it', async () => {
    const { DomainEventName } = await import('../../domain/shared/DomainEventName');
    const { OccurredAt } = await import('../../domain/shared/OccurredAt');
    class SwallowedBatchEvent implements IDomainEvent {
      readonly name = DomainEventName.tableRenamed();
      readonly occurredAt = OccurredAt.now();
    }

    const unitOfWork = createBatchUnitOfWork();
    const published: unknown[] = [];
    const routing = {
      messageName: 'test.rollback_only.v1',
      durableMode: 'active' as const,
      sameTxTargets: [],
      durableTargets: [],
      directTargets: [
        { consumerId: 'direct-await', handler: class {} as never, dispatchMode: 'await' as const },
      ],
    };
    const tx = new DomainWriteTransaction(
      unitOfWork as never,
      {
        registeredDecoderIdentities: () => [],
        encode: () =>
          ok({
            producerEventName: 'TableRenamed',
            messageName: routing.messageName,
            schemaVersion: 1,
            payload: {},
            route: {
              transactionScope: 'data',
              baseId: `bse${'a'.repeat(16)}`,
              tableId: `tbl${'a'.repeat(16)}`,
              streamKey: `tbl${'a'.repeat(16)}`,
            },
          }),
        decode: (_n, _v, val) => ok(val),
      },
      { snapshot: () => ok({ generation: 1, resolve: () => ok(routing) }) },
      { append: async (_ctx, msgs) => ok(msgs.map(({ eventId }) => ({ eventId }))) },
      {
        dispatch: async (_ctx, deliveries) => {
          published.push(...deliveries);
          return successfulDispatchReport(deliveries.length);
        },
      },
      noopSameTxDispatcher,
      noopLogger as never
    );

    const res = await tx.withBatchTransaction(context, async (batchCtx) => {
      const okStep = await tx.execute(batchCtx, async () =>
        ok(domainWrite.changed('step1', [new SwallowedBatchEvent()]))
      );
      expect(okStep.isOk()).toBe(true);
      // Caller ignores the inner err and returns ok!
      await tx.execute(batchCtx, async () =>
        err(domainError.conflict({ code: 'inner.failed', message: 'inner step failed' }))
      );
      return ok('caller-swallowed-error');
    });

    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().code).toBe('inner.failed');
    expect(unitOfWork.commitCount).toBe(0);
    expect(unitOfWork.rollbackCount).toBe(1);
    expect(published).toHaveLength(0);
  });

  it('Item 4: rejects cross-database meta/data operations inside a split-DB batch with batch.cross_database_not_atomic', async () => {
    const splitUnitOfWork = {
      rollbackCount: 0,
      commitCount: 0,
      async withTransaction<T>(
        inputContext: IExecutionContext,
        work: (ctx: IExecutionContext) => Promise<Result<T, DomainError>>,
        options?: { scope?: 'meta' | 'data' }
      ): Promise<Result<T, DomainError>> {
        const scope = options?.scope ?? 'data';
        const tx: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction', scope };
        // Bind ONLY the requested scope (never sibling scope -> simulates split BYODB DBs)
        const res = await work({
          ...inputContext,
          transaction: tx,
          transactions: { [scope]: tx },
        });
        if (res.isErr()) {
          this.rollbackCount += 1;
        } else {
          this.commitCount += 1;
        }
        return res;
      },
    };

    const tx = new DomainWriteTransaction(
      splitUnitOfWork as never,
      emptyCodecRegistry,
      {
        snapshot: () =>
          ok({
            generation: 1,
            resolve: () =>
              ok({
                messageName: 'test.split.v1',
                durableMode: 'active',
                sameTxTargets: [],
                durableTargets: [],
                directTargets: [],
              }),
          }),
      },
      { append: async () => ok([]) },
      { dispatch: async () => successfulDispatchReport(0) },
      noopSameTxDispatcher,
      noopLogger as never
    );

    const res = await tx.withBatchTransaction(
      context,
      async (batchCtx) => {
        return tx.execute(batchCtx, async () => ok(domainWrite.unchanged('meta-op')), {
          scope: 'meta',
        });
      },
      { scope: 'data' }
    );

    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().code).toBe('batch.cross_database_not_atomic');
    expect(splitUnitOfWork.commitCount).toBe(0);
    expect(splitUnitOfWork.rollbackCount).toBe(1);
  });

  it('Item 8: DomainWriteCommit returns status="deferred" inside batch and status="committed" outside batch', async () => {
    const unitOfWork = createBatchUnitOfWork();
    const tx = new DomainWriteTransaction(
      unitOfWork as never,
      emptyCodecRegistry,
      {
        snapshot: () =>
          ok({
            generation: 1,
            resolve: () =>
              ok({
                messageName: 'test.union.v1',
                durableMode: 'active',
                sameTxTargets: [],
                durableTargets: [],
                directTargets: [],
              }),
          }),
      },
      { append: async () => ok([]) },
      { dispatch: async () => successfulDispatchReport(0) },
      noopSameTxDispatcher,
      noopLogger as never
    );

    const standalone = (
      await tx.execute(context, async () => ok(domainWrite.unchanged('solo')))
    )._unsafeUnwrap() as unknown as Record<string, unknown>;
    expect(standalone.status).toBe('committed');
    expect(standalone.committed).toBe(true);

    await tx.withBatchTransaction(context, async (batchCtx) => {
      const deferred = (
        await tx.execute(batchCtx, async () => ok(domainWrite.unchanged('batch')))
      )._unsafeUnwrap() as unknown as Record<string, unknown>;
      expect(deferred.status).toBe('deferred');
      expect('committed' in deferred).toBe(false);
      return ok(undefined);
    });
  });

  it('isolates savepoint rollback-only and deferred afterCommit tasks from the outer batch when recovery succeeds', async () => {
    const { DomainEventName } = await import('../../domain/shared/DomainEventName');
    const { OccurredAt } = await import('../../domain/shared/OccurredAt');

    class SavepointEvent implements IDomainEvent {
      readonly name = DomainEventName.tableRenamed();
      readonly occurredAt = OccurredAt.now();
      constructor(readonly tag: string) {}
    }

    const unitOfWork = createBatchUnitOfWork();
    const publishedTags: string[] = [];
    const journalTags: string[] = [];
    const routing = {
      messageName: 'test.savepoint.v1',
      durableMode: 'active' as const,
      sameTxTargets: [],
      durableTargets: [],
      directTargets: [
        { consumerId: 'direct-await', handler: class {} as never, dispatchMode: 'await' as const },
      ],
    };

    const tx = new DomainWriteTransaction(
      unitOfWork as never,
      {
        registeredDecoderIdentities: () => [],
        encode: (event) =>
          ok({
            producerEventName: event.name.toString(),
            messageName: routing.messageName,
            schemaVersion: 1,
            payload: { tag: (event as SavepointEvent).tag },
            route: {
              transactionScope: 'data',
              baseId: `bse${'a'.repeat(16)}`,
              tableId: `tbl${'a'.repeat(16)}`,
              streamKey: `tbl${'a'.repeat(16)}`,
            },
          }),
        decode: (_n, _v, val) => ok(val),
      },
      { snapshot: () => ok({ generation: 1, resolve: () => ok(routing) }) },
      {
        append: async (_ctx, messages) => {
          journalTags.push(
            ...messages.map((m) => String((m.payload as { tag?: string })?.tag ?? ''))
          );
          return ok(messages.map(({ eventId }) => ({ eventId })));
        },
      },
      {
        dispatch: async (_ctx, deliveries) => {
          for (const d of deliveries) {
            publishedTags.push((d.event as SavepointEvent).tag);
          }
          return successfulDispatchReport(deliveries.length);
        },
      },
      noopSameTxDispatcher,
      noopLogger as never
    );

    const res = await tx.withBatchTransaction(context, async (batchCtx) => {
      // 1. Committed step before savepoint
      const first = await tx.execute(batchCtx, async () =>
        ok(domainWrite.changed('step1', [new SavepointEvent('step1-committed')]))
      );
      expect(first.isOk()).toBe(true);

      // 2a. Savepoint with an inner execute that enqueues afterCommit + inner execute that fails (returned err)
      const sp1 = await tx.savepoint(batchCtx, async () => {
        const innerOk = await tx.execute(batchCtx, async () =>
          ok(domainWrite.changed('sp1-discarded', [new SavepointEvent('sp1-must-not-publish')]))
        );
        expect(innerOk.isOk()).toBe(true);
        return tx.execute(batchCtx, async () =>
          err(domainError.validation({ code: 'validation.field.unique', message: 'dup key' }))
        );
      });
      expect(sp1.isErr()).toBe(true);
      expect(sp1._unsafeUnwrapErr().code).toBe('validation.field.unique');

      // 2b. Savepoint where an inner failure is swallowed by the callback -> savepoint itself must still fail,
      // yet restore outer batch state so recovery outside the savepoint succeeds.
      const sp2 = await tx.savepoint(batchCtx, async () => {
        await tx.execute(batchCtx, async () =>
          err(domainError.conflict({ code: 'sp2.inner_failed', message: 'inner failed' }))
        );
        return ok('swallowed-inside-savepoint');
      });
      expect(sp2.isErr()).toBe(true);
      expect(sp2._unsafeUnwrapErr().code).toBe('sp2.inner_failed');

      // 3. Recovery step outside savepoint succeeds cleanly
      const recovered = await tx.execute(batchCtx, async () =>
        ok(domainWrite.changed('step3', [new SavepointEvent('step3-recovered')]))
      );
      expect(recovered.isOk()).toBe(true);
      return ok('batch-recovered');
    });

    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toBe('batch-recovered');
    expect(unitOfWork.commitCount).toBe(1);
    expect(unitOfWork.rollbackCount).toBe(0);
    // Only outer committed writes publish afterCommit; rolled-back sp1 enqueues are truncated
    expect(publishedTags).toEqual(['step1-committed', 'step3-recovered']);
  });
});
