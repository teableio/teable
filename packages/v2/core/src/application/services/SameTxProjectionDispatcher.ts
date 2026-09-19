import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { SameTxProjectionTarget } from '../../ports/DurableSubscriptionCatalog';
import type { IEventHandler } from '../../ports/EventHandler';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { IClassToken, IHandlerResolver } from '../../ports/HandlerResolver';
import type { ISameTxProjectionDispatcher } from '../../ports/SameTxProjectionDispatcher';

export class SameTxProjectionDispatcher implements ISameTxProjectionDispatcher {
  constructor(private readonly handlerResolver: IHandlerResolver) {}

  async dispatch(
    context: IExecutionContext,
    event: IDomainEvent,
    targets: ReadonlyArray<SameTxProjectionTarget>
  ): Promise<Result<void, DomainError>> {
    for (const target of targets) {
      const handler = this.handlerResolver.resolve(
        target.handler as unknown as IClassToken<IEventHandler<IDomainEvent>>
      );
      const result = await handler.handle(context, event);
      if (result.isErr()) {
        return err(result.error);
      }
    }
    return ok(undefined);
  }
}

export class NoopSameTxProjectionDispatcher implements ISameTxProjectionDispatcher {
  async dispatch(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}
