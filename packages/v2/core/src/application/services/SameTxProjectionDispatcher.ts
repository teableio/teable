import { err, ok, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { SameTxProjectionTarget } from '../../ports/DurableSubscriptionCatalog';
import type { IEventHandler } from '../../ports/EventHandler';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { IClassToken, IHandlerResolver } from '../../ports/HandlerResolver';
import type { ILogger } from '../../ports/Logger';
import type { ISameTxProjectionDispatcher } from '../../ports/SameTxProjectionDispatcher';

export class SameTxProjectionDispatcher implements ISameTxProjectionDispatcher {
  constructor(
    private readonly handlerResolver: IHandlerResolver,
    private readonly logger?: ILogger
  ) {}

  async dispatch(
    context: IExecutionContext,
    event: IDomainEvent,
    targets: ReadonlyArray<SameTxProjectionTarget>
  ): Promise<Result<void, DomainError>> {
    for (const target of targets) {
      const token = target.handler as unknown as IClassToken<IEventHandler<IDomainEvent>>;
      try {
        const handler = this.handlerResolver.resolve(token);
        const result = await handler.handle(context, event);
        if (result.isErr()) {
          return err(result.error);
        }
      } catch (error) {
        this.logger?.error('projection:same_tx_failed', {
          consumerId: target.consumerId,
          eventName: event.name.toString(),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return err(
          domainError.fromUnknown(error, {
            code: 'projection.same_tx_failed',
          })
        );
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
