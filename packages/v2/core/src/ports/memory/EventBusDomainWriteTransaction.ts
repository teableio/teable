import { err, ok, type Result } from 'neverthrow';

import { sameTxTargetsForEvent } from '../../application/projections/SameTxProjection';
import {
  resolveBatchExecutionScope,
  runWithBatchSavepoint,
  runWithBatchTransaction,
} from '../../application/services/batchTransactionOrchestration';
import {
  recordDispatchedSameTxEvent,
  wasSameTxEventDispatched,
} from '../../application/services/dispatchSameTxEvents';
import { ImportRecordBatchTotals } from '../../application/services/ImportRecordBatchTotals';
import { NoopSameTxProjectionDispatcher } from '../../application/services/SameTxProjectionDispatcher';
import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { generateUuid } from '../../domain/shared/IdGenerator';
import type {
  DomainBatchOptions,
  DomainWriteStreamCommit,
  DomainWriteStreamOptions,
  IDomainWriteEventWriter,
  DomainWriteCommit,
  DomainWriteDecision,
  IDomainWriteTransaction,
} from '../DomainWriteTransaction';
import { domainWrite } from '../DomainWriteTransaction';
import type { IEventBus } from '../EventBus';
import {
  getUnitOfWorkTransaction,
  type IExecutionContext,
  withoutTransaction,
} from '../ExecutionContext';
import type { ILogger } from '../Logger';
import type { ISameTxProjectionDispatcher } from '../SameTxProjectionDispatcher';
import type { IUnitOfWork, IUnitOfWorkOptions } from '../UnitOfWork';

const emptyDirectDelivery = {
  awaited: { attemptedTargets: 0, failedTargets: 0, failureCodes: [] as string[] },
  background: { scheduledTargets: 0, failedToScheduleTargets: 0 },
};

export class EventBusDomainWriteTransaction implements IDomainWriteTransaction {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly eventBus: IEventBus,
    private readonly sameTxDispatcher: ISameTxProjectionDispatcher = new NoopSameTxProjectionDispatcher(),
    private readonly logger?: ILogger
  ) {}

  async withBatchTransaction<T>(
    context: IExecutionContext,
    work: (batchContext: IExecutionContext) => Promise<Result<T, DomainError>>,
    options: DomainBatchOptions = {}
  ): Promise<Result<T, DomainError>> {
    return runWithBatchTransaction({
      unitOfWork: this.unitOfWork,
      context,
      scope: options.scope ?? 'data',
      work,
      logger: this.logger,
    });
  }

  /** The in-memory adapter intentionally retains events, like its in-memory event bus. */
  async executeStream<T>(
    context: IExecutionContext,
    work: (
      context: IExecutionContext,
      events: IDomainWriteEventWriter
    ) => Promise<Result<T, DomainError>>,
    options?: DomainWriteStreamOptions
  ): Promise<Result<DomainWriteStreamCommit<T>, DomainError>> {
    const events: IDomainEvent[] = [];
    const recordTotals = new ImportRecordBatchTotals();
    const result = await this.execute(
      context,
      async (transactionContext) => {
        const value = await work(transactionContext, {
          append: async (batch) => {
            events.push(...batch);
            recordTotals.observe(batch);
            return ok(undefined);
          },
        });
        return value.map((value) => domainWrite.unchanged(value));
      },
      { scope: options?.scope, retry: false }
    );
    if (result.isErr()) return err(result.error);
    if (result.value.status !== 'committed') {
      return err(
        domainError.infrastructure({
          code: 'domain_event.transaction_owner_required',
          message: 'Streaming domain writes must own their top-level transaction',
        })
      );
    }
    const commit: DomainWriteStreamCommit<T> = {
      status: 'committed',
      value: result.value.value,
      committed: true,
      directDelivery: result.value.directDelivery,
      events: events.map((event) => ({
        name: event.name.toString(),
        occurredAt: event.occurredAt.toDate().toISOString(),
      })),
    };
    const dispatchContext = withoutTransaction(context);
    let finalizationError: DomainError | undefined;
    if (options?.finalizeAfterCommit) {
      try {
        const finalized = await options.finalizeAfterCommit(dispatchContext);
        if (finalized.isErr()) finalizationError = finalized.error;
      } catch (error) {
        finalizationError = domainError.fromUnknown(error, { code: 'import.finalization_failed' });
      }
    }
    if (finalizationError) {
      return ok({
        ...commit,
        finalizationError: domainError.infrastructure({
          code: finalizationError.code,
          message: finalizationError.message,
          tags: finalizationError.tags,
          details: { ...finalizationError.details, committed: true },
          cause: finalizationError,
        }),
      });
    }
    if (events.length === 0) return ok(commit);
    const published = await this.eventBus.publishMany(
      dispatchContext,
      events.map((event) => recordTotals.finalize(event))
    );
    if (published.isErr()) {
      return ok({
        ...commit,
        directDelivery: {
          awaited: {
            attemptedTargets: events.length,
            failedTargets: events.length,
            failureCodes: [published.error.code],
          },
          background: { scheduledTargets: 0, failedToScheduleTargets: 0 },
        },
      });
    }
    return ok(commit);
  }

  async execute<T>(
    context: IExecutionContext,
    work: (
      transactionContext: IExecutionContext
    ) => Promise<Result<DomainWriteDecision<T>, DomainError>>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<DomainWriteCommit<T>, DomainError>> {
    const scope = options?.scope ?? 'data';
    const scopeResolution = resolveBatchExecutionScope(context, scope);
    if (scopeResolution.kind === 'error') {
      return err(scopeResolution.error);
    }

    const runInTx = async (
      transactionContext: IExecutionContext
    ): Promise<Result<DomainWriteDecision<T>, DomainError>> => {
      const decisionResult = await work(transactionContext);
      if (decisionResult.isErr()) {
        return err(decisionResult.error);
      }
      const decision = decisionResult.value;
      if (decision.kind === 'changed') {
        const tables = new Map(
          (decision.tables ?? []).map((table) => [table.id().toString(), table])
        );
        const historyRowBudget = { remaining: 200 };
        for (const event of decision.events) {
          if (wasSameTxEventDispatched(transactionContext, event)) {
            continue;
          }
          const targets = sameTxTargetsForEvent(event);
          if (targets.length === 0) {
            continue;
          }
          const projResult = await this.sameTxDispatcher.dispatch(
            {
              ...transactionContext,
              sameTxProjection: {
                eventId: generateUuid(),
                tables,
                historyRowBudget,
              },
            },
            event,
            targets
          );
          if (projResult.isErr()) {
            return err(projResult.error);
          }
          recordDispatchedSameTxEvent(transactionContext, event);
        }
      }
      return ok(decision);
    };

    let transactionResult: Result<DomainWriteDecision<T>, DomainError>;
    if (scopeResolution.kind === 'inBatch') {
      try {
        transactionResult = await runInTx(context);
      } catch (error) {
        scopeResolution.batchTransaction.markRollbackOnly(domainError.fromUnknown(error));
        throw error;
      }
    } else {
      transactionResult = await this.unitOfWork.withTransaction(context, runInTx, {
        ...options,
        scope,
      });
    }
    if (transactionResult.isErr()) {
      if (scopeResolution.kind === 'inBatch') {
        scopeResolution.batchTransaction.markRollbackOnly(transactionResult.error);
      }
      return err(transactionResult.error);
    }

    const decision = transactionResult.value;
    if (decision.kind === 'unchanged') {
      if (scopeResolution.kind === 'inBatch') {
        return ok({
          status: 'deferred',
          value: decision.value,
          events: [],
        });
      }
      return ok({
        status: 'committed',
        value: decision.value,
        events: [],
        committed: true,
        directDelivery: emptyDirectDelivery,
      });
    }

    const dispatchContext = withoutTransaction(context);
    if (scopeResolution.kind === 'inBatch') {
      scopeResolution.batchTransaction.enqueueAfterCommit(async () => {
        const publishResult = await this.eventBus.publishMany(dispatchContext, decision.events);
        if (publishResult.isErr()) {
          throw new Error(publishResult.error.message);
        }
      });
      return ok({
        status: 'deferred',
        value: decision.value,
        events: decision.events,
      });
    }

    const publishResult = await this.eventBus.publishMany(dispatchContext, decision.events);
    if (publishResult.isErr()) {
      return ok({
        status: 'committed',
        value: decision.value,
        events: decision.events,
        committed: true,
        directDelivery: {
          awaited: {
            attemptedTargets: decision.events.length,
            failedTargets: decision.events.length,
            failureCodes: [publishResult.error.code],
          },
          background: { scheduledTargets: 0, failedToScheduleTargets: 0 },
        },
      });
    }

    return ok({
      status: 'committed',
      value: decision.value,
      events: decision.events,
      committed: true,
      directDelivery: emptyDirectDelivery,
    });
  }

  /** In-memory transactions have no SQL state to poison, so a savepoint is a pass-through. */
  async savepoint<T>(
    context: IExecutionContext,
    work: () => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    if (!getUnitOfWorkTransaction(context, 'data')) {
      return err(
        domainError.infrastructure({
          code: 'domain_event.transaction_required',
          message: 'Domain write savepoint requires an active data transaction',
        })
      );
    }

    return runWithBatchSavepoint(context, () =>
      this.unitOfWork.savepoint ? this.unitOfWork.savepoint(context, async () => work()) : work()
    );
  }
}
