import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { IExecutionContext } from './ExecutionContext';

export interface IEventBus {
  publish(context: IExecutionContext, event: IDomainEvent): Promise<Result<void, string>>;
  publishMany(
    context: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, string>>;
}
