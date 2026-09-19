import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { generateUuid } from '../../domain/shared/IdGenerator';
import type {
  DomainWriteCommit,
  DomainWriteDecision,
  IDomainWriteTransaction,
} from '../../ports/DomainWriteTransaction';
import type {
  IDurableSubscriptionCatalog,
  IDurableSubscriptionCatalogSnapshot,
  ProjectionEventRoutingDecision,
} from '../../ports/DurableSubscriptionCatalog';
import {
  getUnitOfWorkTransaction,
  scheduleExecutionContextBackgroundTask,
  type IExecutionContext,
  withoutTransaction,
} from '../../ports/ExecutionContext';
import type {
  ILegacyEventDispatcher,
  LegacyEventDispatch,
  LegacyEventDispatchReport,
} from '../../ports/LegacyEventDispatcher';
import type { ILogger } from '../../ports/Logger';
import type {
  EncodedProjectionMessage,
  IProjectionMessageCodecRegistry,
} from '../../ports/ProjectionMessage';
import type { ISameTxProjectionDispatcher } from '../../ports/SameTxProjectionDispatcher';
import type {
  ITransactionalProjectionMessageJournal,
  ProjectionMessageDraft,
  StoredProjectionMessageContext,
} from '../../ports/TransactionalProjectionMessageJournal';
import type { IUnitOfWork, IUnitOfWorkOptions } from '../../ports/UnitOfWork';
import { uncataloguedLegacyDirectTargets } from './compileDurableSubscriptionCatalog';

export type ProjectionMessageIdGenerator = (kind: 'batch' | 'event') => string;

type PlannedWrite = Readonly<{
  messages: ReadonlyArray<ProjectionMessageDraft>;
  awaitDirectDeliveries: ReadonlyArray<LegacyEventDispatch>;
  backgroundDirectDeliveries: ReadonlyArray<LegacyEventDispatch>;
  sameTxEvents: ReadonlyArray<{
    event: IDomainEvent;
    eventId: string;
    targets: ProjectionEventRoutingDecision['sameTxTargets'];
  }>;
}>;

type TransactionCommit<T> = Readonly<{
  value: T;
  events: ReadonlyArray<IDomainEvent>;
  plan: PlannedWrite;
}>;

const emptyPlan = (): PlannedWrite => ({
  messages: [],
  awaitDirectDeliveries: [],
  backgroundDirectDeliveries: [],
  sameTxEvents: [],
});

const emptyLegacyDispatchReport = (): LegacyEventDispatchReport => ({
  attemptedTargets: 0,
  failedTargets: 0,
  failureCodes: [],
});

const countTargets = (deliveries: ReadonlyArray<LegacyEventDispatch>): number =>
  deliveries.reduce((total, delivery) => total + delivery.targets.length, 0);

export class DomainWriteTransaction implements IDomainWriteTransaction {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly codecRegistry: IProjectionMessageCodecRegistry,
    private readonly subscriptionCatalog: IDurableSubscriptionCatalog,
    private readonly journal: ITransactionalProjectionMessageJournal,
    private readonly legacyDispatcher: ILegacyEventDispatcher,
    private readonly sameTxDispatcher: ISameTxProjectionDispatcher,
    private readonly logger: ILogger,
    private readonly generateId: ProjectionMessageIdGenerator = () => generateUuid(),
    private readonly publishedEventLog?: {
      recordPublished?(events: ReadonlyArray<IDomainEvent>): void;
    }
  ) {}

  async execute<T>(
    context: IExecutionContext,
    work: (
      transactionContext: IExecutionContext
    ) => Promise<Result<DomainWriteDecision<T>, DomainError>>,
    options: IUnitOfWorkOptions = { scope: 'data' }
  ): Promise<Result<DomainWriteCommit<T>, DomainError>> {
    const scope = options.scope ?? 'data';
    if (getUnitOfWorkTransaction(context, scope)) {
      return err(
        domainError.infrastructure({
          code: 'domain_event.transaction_owner_required',
          message: `DomainWriteTransaction must own the top-level ${scope} transaction`,
        })
      );
    }

    const catalogResult = this.subscriptionCatalog.snapshot(context);
    if (catalogResult.isErr()) {
      return err(catalogResult.error);
    }
    const catalog = catalogResult.value;

    const transactionResult = await this.unitOfWork.withTransaction<TransactionCommit<T>>(
      context,
      async (transactionContext) => {
        const transaction = getUnitOfWorkTransaction(transactionContext, scope);
        if (!transaction) {
          return err(
            domainError.infrastructure({
              code: 'domain_event.transaction_required',
              message: `Domain write requires an active ${scope} transaction`,
            })
          );
        }

        const decisionResult = await work(transactionContext);
        if (decisionResult.isErr()) {
          return err(decisionResult.error);
        }
        const decision = decisionResult.value;
        if (decision.kind === 'unchanged') {
          return ok({
            value: decision.value,
            events: [] as ReadonlyArray<IDomainEvent>,
            plan: emptyPlan(),
          });
        }

        const planResult = this.planWrite(transactionContext, decision.events, catalog, scope);
        if (planResult.isErr()) {
          return err(planResult.error);
        }
        const plan = planResult.value;
        const tables = new Map(
          (decision.tables ?? []).map((table) => [table.id().toString(), table])
        );
        const historyRowBudget = { remaining: 200 };

        for (const sameTx of plan.sameTxEvents) {
          const sameTxResult = await this.sameTxDispatcher.dispatch(
            {
              ...transactionContext,
              sameTxProjection: { eventId: sameTx.eventId, tables, historyRowBudget },
            },
            sameTx.event,
            sameTx.targets
          );
          if (sameTxResult.isErr()) {
            return err(sameTxResult.error);
          }
        }

        if (plan.messages.length > 0) {
          const appendResult = await this.journal.append(transactionContext, plan.messages);
          if (appendResult.isErr()) {
            return err(appendResult.error);
          }
        }

        return ok({ value: decision.value, events: [...decision.events], plan });
      },
      { ...options, scope }
    );
    if (transactionResult.isErr()) {
      return err(transactionResult.error);
    }

    const committed = transactionResult.value;
    this.publishedEventLog?.recordPublished?.(committed.events);
    const dispatchContext = withoutTransaction(context);
    const awaited =
      committed.plan.awaitDirectDeliveries.length > 0
        ? await this.dispatchLegacySafely(dispatchContext, committed.plan.awaitDirectDeliveries)
        : emptyLegacyDispatchReport();
    const backgroundTargetCount = countTargets(committed.plan.backgroundDirectDeliveries);
    let scheduledTargets = 0;
    let failedToScheduleTargets = 0;
    if (backgroundTargetCount > 0) {
      try {
        scheduleExecutionContextBackgroundTask(dispatchContext, async () => {
          await this.dispatchLegacySafely(
            dispatchContext,
            committed.plan.backgroundDirectDeliveries
          );
        });
        scheduledTargets = backgroundTargetCount;
      } catch (error) {
        failedToScheduleTargets = backgroundTargetCount;
        this.logger.error('domain_event:legacy_background_schedule_failed', {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          targetCount: backgroundTargetCount,
          committed: true,
        });
      }
    }

    return ok({
      value: committed.value,
      events: committed.events,
      committed: true,
      directDelivery: {
        awaited,
        background: { scheduledTargets, failedToScheduleTargets },
      },
    });
  }

  private planWrite(
    context: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>,
    catalog: IDurableSubscriptionCatalogSnapshot,
    transactionScope: 'data' | 'meta'
  ): Result<PlannedWrite, DomainError> {
    const messages: ProjectionMessageDraft[] = [];
    const awaitDirectDeliveries: LegacyEventDispatch[] = [];
    const backgroundDirectDeliveries: LegacyEventDispatch[] = [];
    const sameTxEvents: Array<{
      event: IDomainEvent;
      eventId: string;
      targets: ProjectionEventRoutingDecision['sameTxTargets'];
    }> = [];
    const batchId = this.generateId('batch');

    for (let batchOrdinal = 0; batchOrdinal < events.length; batchOrdinal += 1) {
      const event = events[batchOrdinal]!;
      const eventId = this.generateId('event');
      const routingResult = catalog.resolve(event);
      if (routingResult.isErr()) {
        return err(routingResult.error);
      }
      const routing = routingResult.value;
      const routingValidation = validateRouting(routing);
      if (routingValidation.isErr()) {
        return err(routingValidation.error);
      }

      if (routing.sameTxTargets.length > 0) {
        sameTxEvents.push({ event, eventId, targets: routing.sameTxTargets });
      }
      const cataloguedDirectTargets = routing.directTargets;
      const directTargets =
        cataloguedDirectTargets.length > 0 ||
        routing.sameTxTargets.length > 0 ||
        routing.durableTargets.length > 0
          ? cataloguedDirectTargets
          : uncataloguedLegacyDirectTargets(event);
      if (directTargets.length > 0) {
        const awaitTargets = directTargets.filter((target) => target.dispatchMode === 'await');
        const backgroundTargets = directTargets.filter(
          (target) => target.dispatchMode === 'background'
        );
        if (awaitTargets.length > 0) {
          awaitDirectDeliveries.push({ event, targets: awaitTargets });
        }
        if (backgroundTargets.length > 0) {
          backgroundDirectDeliveries.push({ event, targets: backgroundTargets });
        }
      }

      if (routing.durableTargets.length === 0) {
        continue;
      }

      const encodedResult = this.codecRegistry.encode(event);
      if (encodedResult.isErr()) {
        return err(encodedResult.error);
      }
      const encoded = encodedResult.value;
      const encodedValidation = validateEncodedMessage(encoded, routing, transactionScope);
      if (encodedValidation.isErr()) {
        return err(encodedValidation.error);
      }

      messages.push({
        eventId,
        producerEventName: encoded.producerEventName,
        messageName: encoded.messageName,
        schemaVersion: encoded.schemaVersion,
        payload: encoded.payload,
        route: encoded.route,
        context: snapshotContext(context),
        occurredAt: event.occurredAt.toDate(),
        batchId,
        batchOrdinal,
        catalogGeneration: catalog.generation,
        requiredConsumers: routing.durableTargets,
        mode: routing.durableMode,
      });
    }

    return ok({
      messages,
      awaitDirectDeliveries,
      backgroundDirectDeliveries,
      sameTxEvents,
    });
  }

  private async dispatchLegacySafely(
    context: IExecutionContext,
    deliveries: ReadonlyArray<LegacyEventDispatch>
  ): Promise<LegacyEventDispatchReport> {
    try {
      return await this.legacyDispatcher.dispatch(context, deliveries);
    } catch (error) {
      const targetCount = countTargets(deliveries);
      this.logger.error('domain_event:legacy_dispatch_failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        eventCount: deliveries.length,
        targetCount,
        committed: true,
      });
      return {
        attemptedTargets: targetCount,
        failedTargets: targetCount,
        failureCodes: ['legacy_dispatch.unexpected'],
      };
    }
  }
}

const snapshotContext = (context: IExecutionContext): StoredProjectionMessageContext => ({
  actorId: context.actorId.toString(),
  ...(context.requestId ? { requestId: context.requestId } : {}),
  ...(context.windowId ? { windowId: context.windowId } : {}),
  ...(context.undoRedo?.mode ? { undoRedoMode: context.undoRedo.mode } : {}),
});

const validateRouting = (routing: ProjectionEventRoutingDecision): Result<void, DomainError> => {
  const ids = new Set<string>();
  for (const target of [
    ...routing.sameTxTargets,
    ...routing.durableTargets,
    ...routing.directTargets,
  ]) {
    if (ids.has(target.consumerId)) {
      return err(
        domainError.invariant({
          code: 'projection_message.subscription_catalog_invalid',
          message: `Consumer ${target.consumerId} is classified more than once for ${routing.messageName}`,
        })
      );
    }
    ids.add(target.consumerId);
  }
  return ok(undefined);
};

const validateEncodedMessage = (
  encoded: EncodedProjectionMessage,
  routing: ProjectionEventRoutingDecision,
  transactionScope: 'data' | 'meta'
): Result<void, DomainError> => {
  if (encoded.messageName !== routing.messageName) {
    return err(
      domainError.invariant({
        code: 'projection_message.codec_not_registered',
        message: `Encoded message ${encoded.messageName} does not match catalog ${routing.messageName}`,
      })
    );
  }
  if (encoded.route.transactionScope !== transactionScope) {
    return err(
      domainError.infrastructure({
        code: 'domain_event.transaction_scope_mismatch',
        message: `Encoded route scope ${encoded.route.transactionScope} does not match ${transactionScope}`,
      })
    );
  }
  return ok(undefined);
};
