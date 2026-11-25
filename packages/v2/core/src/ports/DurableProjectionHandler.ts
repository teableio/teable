import type { Result } from 'neverthrow';

import type { RecordInitiator } from '../domain/shared/RecordInitiator';
import type { IEventDispatchScope } from './EventHandler';
import type { IExecutionContext, IUnitOfWorkTransaction } from './ExecutionContext';

export type ProjectionEffectReceipt = Readonly<{
  kind: 'destination-inbox' | 'natural-upsert' | 'external-idempotency' | 'convergent';
  identity: string;
  /** Omitted means the inbox is in the source database. */
  destination?: 'source' | 'external';
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
  readonly messageName?: string;
  readonly deliveryId: string;
  readonly consumerId: string;
  readonly catalogGeneration: number;
  readonly consumerGeneration: number;
  readonly replayGeneration: number;
  readonly invocationAttempt: number;
  readonly actorId: string;
  /** Null for pre-envelope messages: delivery time is not the mutation time. */
  readonly occurredAt: Date | null;
  readonly recordedAt?: Date;
  readonly initiator?: RecordInitiator;
  readonly operationId?: string;
  readonly operationAttribution?: IExecutionContext['operationAttribution'];
  readonly requestId?: string;
  readonly dispatchScope: IEventDispatchScope;
  readonly transaction?: IUnitOfWorkTransaction;
  readonly leaseSignal: AbortSignal;
}

export interface IDurableProjectionHandler<TMessage> {
  readonly receiptDestination?: 'source' | 'external';
  handle(
    context: IDurableProjectionContext,
    message: TMessage
  ): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>>;
  /** Verify committed external receipts against the actual destination, never the source. */
  verifyReceipt?(
    context: IDurableProjectionContext,
    receipt: ProjectionEffectReceipt
  ): Promise<Result<boolean, ProjectionDeliveryError>>;
}
