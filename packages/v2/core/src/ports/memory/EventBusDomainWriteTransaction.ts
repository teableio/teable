import { err, ok, type Result } from 'neverthrow';

import { ImportRecordBatchTotals } from '../../application/services/ImportRecordBatchTotals';
import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type {
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
import type { IUnitOfWork, IUnitOfWorkOptions } from '../UnitOfWork';

const emptyDirectDelivery = {
  awaited: { attemptedTargets: 0, failedTargets: 0, failureCodes: [] as string[] },
  background: { scheduledTargets: 0, failedToScheduleTargets: 0 },
};

export class EventBusDomainWriteTransaction implements IDomainWriteTransaction {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly eventBus: IEventBus
  ) {}

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
    const commit = {
      ...result.value,
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
    if (getUnitOfWorkTransaction(context, scope)) {
      return err(
        domainError.infrastructure({
          code: 'domain_event.transaction_owner_required',
          message: `DomainWriteTransaction must own the top-level ${scope} transaction`,
        })
      );
    }

    const transactionResult = await this.unitOfWork.withTransaction(context, work, {
      ...options,
      scope,
    });
    if (transactionResult.isErr()) {
      return err(transactionResult.error);
    }

    const decision = transactionResult.value;
    if (decision.kind === 'unchanged') {
      return ok({
        value: decision.value,
        events: [],
        committed: true,
        directDelivery: emptyDirectDelivery,
      });
    }

    const publishResult = await this.eventBus.publishMany(
      withoutTransaction(context),
      decision.events
    );
    if (publishResult.isErr()) {
      return ok({
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
      value: decision.value,
      events: decision.events,
      committed: true,
      directDelivery: emptyDirectDelivery,
    });
  }
}
