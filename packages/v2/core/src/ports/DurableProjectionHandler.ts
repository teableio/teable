import type { Result } from 'neverthrow';

import type { IEventDispatchScope } from './EventHandler';
import type { IUnitOfWorkTransaction } from './ExecutionContext';

export type ProjectionEffectReceipt = Readonly<{
  kind: 'destination-inbox' | 'natural-upsert' | 'external-idempotency' | 'convergent';
  identity: string;
}>;

export type ProjectionDeliveryOutcome =
  | Readonly<{ kind: 'applied'; effectReceipt: ProjectionEffectReceipt }>
  | Readonly<{ kind: 'noop'; reasonCode: string }>;

export type ProjectionDeliveryError = Readonly<{
  code: string;
  retryability: 'retryable' | 'terminal';
  message: string;
}>;

export interface IDurableProjectionContext {
  readonly eventId: string;
  readonly deliveryId: string;
  readonly consumerId: string;
  readonly catalogGeneration: number;
  readonly consumerGeneration: number;
  readonly replayGeneration: number;
  readonly invocationAttempt: number;
  readonly actorId: string;
  readonly occurredAt: Date;
  readonly requestId?: string;
  readonly dispatchScope: IEventDispatchScope;
  readonly transaction?: IUnitOfWorkTransaction;
  readonly leaseSignal: AbortSignal;
}

export interface IDurableProjectionHandler<TMessage> {
  handle(
    context: IDurableProjectionContext,
    message: TMessage
  ): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>>;
}
