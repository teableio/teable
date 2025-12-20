import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { IEventBus } from '../EventBus';
import type { IExecutionContext } from '../ExecutionContext';

export class NoopEventBus implements IEventBus {
  async publish(_: IExecutionContext, __: IDomainEvent): Promise<Result<void, string>> {
    return ok(undefined);
  }

  async publishMany(
    _: IExecutionContext,
    __: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, string>> {
    return ok(undefined);
  }
}
