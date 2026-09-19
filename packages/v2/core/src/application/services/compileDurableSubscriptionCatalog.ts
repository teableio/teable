import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type {
  DurableProjectionTarget,
  LegacyProjectionTarget,
  SameTxProjectionTarget,
} from '../../ports/DurableSubscriptionCatalog';
import {
  getEventHandlerTokens,
  type EventHandlerClass,
  type EventType,
} from '../../ports/EventHandler';
import { getDurableProjectionRegistrations } from '../projections/DurableProjection';
import { getSameTxProjectionRegistrations } from '../projections/SameTxProjection';
import {
  ImmutableDurableSubscriptionCatalog,
  type DurableSubscriptionCatalogEntry,
} from './ImmutableDurableSubscriptionCatalog';

export const legacyDirectTargetsForEventType = (
  event: EventType<IDomainEvent>,
  sameTxHandlers: ReadonlySet<EventHandlerClass<IDomainEvent>>
): LegacyProjectionTarget[] =>
  getEventHandlerTokens(event)
    .filter((handler) => !sameTxHandlers.has(handler))
    .map((handler) => ({
      consumerId: `teable.direct.${event.name}.${
        'name' in handler && typeof handler.name === 'string' ? handler.name : 'anonymous'
      }`,
      handler,
      dispatchMode: 'background' as const,
    }));

export const uncataloguedLegacyDirectTargets = (event: IDomainEvent): LegacyProjectionTarget[] => {
  const sameTxHandlers = new Set<EventHandlerClass<IDomainEvent>>(
    getSameTxProjectionRegistrations().map((registration) => registration.handler)
  );
  return legacyDirectTargetsForEventType(
    event.constructor as EventType<IDomainEvent>,
    sameTxHandlers
  );
};

export const compileDurableSubscriptionCatalog = (
  events: ReadonlyArray<EventType<IDomainEvent>>,
  generation = 1
): Result<ImmutableDurableSubscriptionCatalog, DomainError> => {
  const sameTxByEvent = new Map<string, SameTxProjectionTarget[]>();
  const sameTxHandlers = new Set<EventHandlerClass<IDomainEvent>>();
  for (const registration of getSameTxProjectionRegistrations()) {
    const eventName = registration.event.name;
    const targets = sameTxByEvent.get(eventName) ?? [];
    targets.push({ consumerId: registration.id, handler: registration.handler });
    sameTxByEvent.set(eventName, targets);
    sameTxHandlers.add(registration.handler);
  }

  const durableByEvent = new Map<
    string,
    {
      messageName: string;
      targets: DurableProjectionTarget[];
    }
  >();
  for (const registration of getDurableProjectionRegistrations()) {
    if (!registration.id.trim()) {
      return err(
        domainError.invariant({
          code: 'projection_message.subscription_catalog_invalid',
          message: `Durable projection is missing id for ${registration.messageName}`,
        })
      );
    }
    if (
      getEventHandlerTokens(registration.event).some((handler) => handler === registration.handler)
    ) {
      return err(
        domainError.invariant({
          code: 'projection_message.subscription_catalog_invalid',
          message: `Consumer ${registration.id} cannot be both @ProjectionHandler and @DurableProjectionHandler`,
        })
      );
    }
    const eventName = registration.event.name;
    const current = durableByEvent.get(eventName) ?? {
      messageName: registration.messageName,
      targets: [],
    };
    current.targets.push({
      consumerId: registration.id,
      consumerGeneration: registration.consumerGeneration,
      retry: registration.retry,
      ordering: registration.ordering,
      idempotency: registration.idempotency,
      replay: registration.replay,
    });
    durableByEvent.set(eventName, current);
  }

  const entries: DurableSubscriptionCatalogEntry[] = events.map((event) => {
    const durable = durableByEvent.get(event.name);
    const sameTxTargets = sameTxByEvent.get(event.name) ?? [];
    const excluded = new Set<EventHandlerClass<IDomainEvent>>(sameTxHandlers);
    const directTargets = legacyDirectTargetsForEventType(event, excluded);
    return {
      event,
      messageName: durable?.messageName ?? `table.${event.name}.v1`,
      durableMode: 'active' as const,
      sameTxTargets,
      durableTargets: durable?.targets ?? [],
      directTargets,
    };
  });

  return ImmutableDurableSubscriptionCatalog.create({ generation, entries });
};

export const emptyDurableSubscriptionCatalog = (): Result<
  ImmutableDurableSubscriptionCatalog,
  DomainError
> => ImmutableDurableSubscriptionCatalog.create({ generation: 1, entries: [] });
