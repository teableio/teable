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
import type { EventHandlerClass, IEventHandler } from '../../ports/EventHandler';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import { bindUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import type {
  ILegacyEventDispatcher,
  LegacyEventDispatch,
  LegacyEventDispatchReport,
} from '../../ports/LegacyEventDispatcher';
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
    expect(result._unsafeUnwrap().directDelivery.awaited.attemptedTargets).toBe(1);
    expect(result._unsafeUnwrap().directDelivery.background.scheduledTargets).toBe(1);
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
    expect(first._unsafeUnwrap().directDelivery.background.scheduledTargets).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seenActorIds).toEqual(['usr-first', 'usr-second']);
    releaseHold?.();
  });
});
