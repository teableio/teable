import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { IDurableProjectionHandler } from '../../ports/DurableProjectionHandler';
import type {
  DurableProjectionIdempotency,
  DurableProjectionOrdering,
  DurableProjectionReplay,
} from '../../ports/DurableSubscriptionCatalog';
import type { EventHandlerClass, EventType } from '../../ports/EventHandler';

export type DurableProjectionOptions = Readonly<{
  id: string;
  consumerGeneration?: number;
  retry?: Readonly<{ maxAttempts: number; policy: 'exponential-jitter' }>;
  ordering?: DurableProjectionOrdering;
  idempotency?: DurableProjectionIdempotency;
  replay?: DurableProjectionReplay;
}>;

export type DurableProjectionRegistration<TEvent extends IDomainEvent = IDomainEvent> = Readonly<{
  messageName: string;
  event: EventType<TEvent>;
  handler: unknown;
  id: string;
  consumerGeneration: number;
  retry: Readonly<{ maxAttempts: number; policy: 'exponential-jitter' }>;
  ordering: DurableProjectionOrdering;
  idempotency: DurableProjectionIdempotency;
  replay: DurableProjectionReplay;
}>;

const durableProjectionRegistry: DurableProjectionRegistration[] = [];

export const DurableProjectionHandler =
  <TEvent extends IDomainEvent>(
    event: EventType<TEvent>,
    messageName: string,
    options: DurableProjectionOptions
  ) =>
  (target: unknown): void => {
    durableProjectionRegistry.push({
      messageName,
      event,
      handler: target,
      id: options.id,
      consumerGeneration: options.consumerGeneration ?? 1,
      retry: options.retry ?? { maxAttempts: 12, policy: 'exponential-jitter' },
      ordering: options.ordering ?? 'none',
      idempotency: options.idempotency ?? 'destination-inbox',
      replay: options.replay ?? 'safe',
    });
  };

export const getDurableProjectionRegistrations =
  (): ReadonlyArray<DurableProjectionRegistration> => [...durableProjectionRegistry];
