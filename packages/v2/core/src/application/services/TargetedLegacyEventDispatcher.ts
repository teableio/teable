import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { LegacyProjectionTarget } from '../../ports/DurableSubscriptionCatalog';
import {
  createEventDispatchScope,
  type IEventDispatchScope,
  type IEventHandler,
} from '../../ports/EventHandler';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { IClassToken, IHandlerResolver } from '../../ports/HandlerResolver';
import type {
  ILegacyEventDispatcher,
  LegacyEventDispatch,
  LegacyEventDispatchReport,
} from '../../ports/LegacyEventDispatcher';
import type { ILogger } from '../../ports/Logger';

export class TargetedLegacyEventDispatcher implements ILegacyEventDispatcher {
  constructor(
    private readonly handlerResolver: IHandlerResolver,
    private readonly logger: ILogger
  ) {}

  async dispatch(
    context: IExecutionContext,
    deliveries: ReadonlyArray<LegacyEventDispatch>
  ): Promise<LegacyEventDispatchReport> {
    const dispatchScope = createEventDispatchScope();
    const failureCodes: string[] = [];
    let attemptedTargets = 0;
    for (const delivery of deliveries) {
      attemptedTargets += delivery.targets.length;
      for (const target of delivery.targets) {
        const failure = await this.dispatchTarget(context, delivery.event, target, dispatchScope);
        if (failure) {
          failureCodes.push(failure);
        }
      }
    }
    return {
      attemptedTargets,
      failedTargets: failureCodes.length,
      failureCodes,
    };
  }

  private async dispatchTarget(
    context: IExecutionContext,
    event: IDomainEvent,
    target: LegacyProjectionTarget,
    dispatchScope: IEventDispatchScope
  ): Promise<string | null> {
    try {
      const handler = this.handlerResolver.resolve(
        target.handler as unknown as IClassToken<IEventHandler<IDomainEvent>>
      );
      const result = await handler.handle(context, event, dispatchScope);
      if (result.isErr()) {
        this.logger.error('domain_event:legacy_handler_failed', {
          consumerId: target.consumerId,
          eventName: event.name.toString(),
          errorCode: result.error.code,
        });
        return result.error.code;
      }
      return null;
    } catch (error) {
      this.logger.error('domain_event:legacy_handler_threw', {
        consumerId: target.consumerId,
        eventName: event.name.toString(),
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return 'legacy_dispatch.unexpected';
    }
  }
}
