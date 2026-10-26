import { err, type Result } from 'neverthrow';

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

/**
 * `consumerId` for handlers that only dispatch in-process. It is a log/metric
 * label, so it is derived from decorator input where possible and made unique
 * per event instead of trusting `class.name`, which production bundlers rename
 * (two handlers can collapse to the same minified name).
 */
const directConsumerId = (
  event: EventType<IDomainEvent>,
  handler: EventHandlerClass<IDomainEvent>,
  usedIds: ReadonlySet<string>
): string => {
  const eventName = event.name;
  const handlerName =
    'name' in handler && typeof handler.name === 'string' && handler.name
      ? handler.name
      : 'anonymous';
  const base = `teable.direct.${eventName}.${handlerName}`;
  if (!usedIds.has(base)) {
    return base;
  }
  let ordinal = 2;
  while (usedIds.has(`${base}#${ordinal}`)) {
    ordinal += 1;
  }
  return `${base}#${ordinal}`;
};

export const legacyDirectTargetsForEventType = (
  event: EventType<IDomainEvent>,
  sameTxHandlers: ReadonlySet<EventHandlerClass<IDomainEvent>>
): LegacyProjectionTarget[] => {
  const usedIds = new Set<string>();
  const targets: LegacyProjectionTarget[] = [];
  for (const handler of getEventHandlerTokens(event)) {
    if (sameTxHandlers.has(handler)) {
      continue;
    }
    const consumerId = directConsumerId(event, handler, usedIds);
    usedIds.add(consumerId);
    targets.push({ consumerId, handler, dispatchMode: 'background' as const });
  }
  return targets;
};

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
  // Registrations are grouped by the event class object, never by its name:
  // minified builds legitimately give several distinct events the same name.
  const sameTxByEvent = new Map<EventType<IDomainEvent>, SameTxProjectionTarget[]>();
  const sameTxHandlers = new Set<EventHandlerClass<IDomainEvent>>();
  for (const registration of getSameTxProjectionRegistrations()) {
    const eventType = registration.event as EventType<IDomainEvent>;
    const targets = sameTxByEvent.get(eventType) ?? [];
    targets.push({ consumerId: registration.id, handler: registration.handler });
    sameTxByEvent.set(eventType, targets);
    sameTxHandlers.add(registration.handler);
  }

  const durableByEvent = new Map<
    EventType<IDomainEvent>,
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
    const eventType = registration.event as EventType<IDomainEvent>;
    const current = durableByEvent.get(eventType) ?? {
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
    durableByEvent.set(eventType, current);
  }

  const entries: DurableSubscriptionCatalogEntry[] = events.map((event) => {
    const durable = durableByEvent.get(event);
    const sameTxTargets = sameTxByEvent.get(event) ?? [];
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
