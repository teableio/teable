import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type {
  DomainWriteCommit,
  DomainWriteDecision,
  IDomainWriteTransaction,
} from '../DomainWriteTransaction';
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
