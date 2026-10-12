import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { LegacyProjectionTarget } from './DurableSubscriptionCatalog';
import type { IExecutionContext } from './ExecutionContext';

export type LegacyEventDispatch = Readonly<{
  event: IDomainEvent;
  targets: ReadonlyArray<LegacyProjectionTarget>;
}>;

export type LegacyEventDispatchReport = Readonly<{
  attemptedTargets: number;
  failedTargets: number;
  failureCodes: ReadonlyArray<string>;
}>;

export interface ILegacyEventDispatcher {
  dispatch(
    context: IExecutionContext,
    deliveries: ReadonlyArray<LegacyEventDispatch>
  ): Promise<LegacyEventDispatchReport>;
}
