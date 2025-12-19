import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { IExecutionContext } from '../ExecutionContext';
import type { IEventPublisher } from '../EventPublisher';

export class NoopEventPublisher implements IEventPublisher {
  publish(_: IExecutionContext, __: IDomainEvent): Result<void, string> {
    return ok(undefined);
  }

  publishMany(_: IExecutionContext, __: ReadonlyArray<IDomainEvent>): Result<void, string> {
    return ok(undefined);
  }
}
