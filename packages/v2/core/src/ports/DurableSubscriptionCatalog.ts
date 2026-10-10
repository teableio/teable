import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { EventHandlerClass } from './EventHandler';
import type { IExecutionContext } from './ExecutionContext';

export type DurableProjectionOrdering = 'none' | 'version-aware';
export type DurableProjectionIdempotency =
  | 'destination-inbox'
  | 'natural-upsert'
  | 'external-idempotency-key'
  | 'convergent';
export type DurableProjectionReplay = 'safe' | 'rebuild-only' | 'forbidden';
export type LegacyProjectionDispatchMode = 'await' | 'background';

export type DurableProjectionTarget = Readonly<{
  consumerId: string;
  consumerGeneration: number;
  retry: Readonly<{ maxAttempts: number; policy: 'exponential-jitter' }>;
  ordering: DurableProjectionOrdering;
  idempotency: DurableProjectionIdempotency;
  replay: DurableProjectionReplay;
}>;

export type SameTxProjectionTarget = Readonly<{
  consumerId: string;
  handler: EventHandlerClass<IDomainEvent>;
}>;

export type LegacyProjectionTarget = Readonly<{
  consumerId: string;
  handler: EventHandlerClass<IDomainEvent>;
  dispatchMode: LegacyProjectionDispatchMode;
}>;

export type ProjectionEventRoutingDecision = Readonly<{
  messageName: string;
  durableMode: 'shadow' | 'active';
  sameTxTargets: ReadonlyArray<SameTxProjectionTarget>;
  durableTargets: ReadonlyArray<DurableProjectionTarget>;
  directTargets: ReadonlyArray<LegacyProjectionTarget>;
}>;

export interface IDurableSubscriptionCatalogSnapshot {
  readonly generation: number;
  resolve(event: IDomainEvent): Result<ProjectionEventRoutingDecision, DomainError>;
}

export interface IDurableSubscriptionCatalog {
  snapshot(context: IExecutionContext): Result<IDurableSubscriptionCatalogSnapshot, DomainError>;
}
