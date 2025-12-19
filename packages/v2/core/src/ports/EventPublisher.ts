import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { IExecutionContext } from './ExecutionContext';

export interface IEventPublisher {
  publish(context: IExecutionContext, event: IDomainEvent): Result<void, string>;
  publishMany(
    context: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Result<void, string>;
}
