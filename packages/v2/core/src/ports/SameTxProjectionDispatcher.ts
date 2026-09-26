import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { SameTxProjectionTarget } from './DurableSubscriptionCatalog';
import type { IExecutionContext } from './ExecutionContext';

export interface ISameTxProjectionDispatcher {
  dispatch(
    context: IExecutionContext,
    event: IDomainEvent,
    targets: ReadonlyArray<SameTxProjectionTarget>
  ): Promise<Result<void, DomainError>>;
}
