import { describe, expect, it } from 'vitest';
import { ok } from 'neverthrow';

import { DomainEventName } from '../../domain/shared/DomainEventName';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { OccurredAt } from '../../domain/shared/OccurredAt';
import type { EventType } from '../../ports/EventHandler';
import type { ProjectionMessageJson } from '../../ports/ProjectionMessage';
import {
  ImmutableDurableSubscriptionCatalog,
  type DurableSubscriptionCatalogEntry,
} from './ImmutableDurableSubscriptionCatalog';
import { ProjectionMessageCodecRegistry } from './ProjectionMessageCodecRegistry';
import { legacyDirectTargetsForEventType } from './compileDurableSubscriptionCatalog';
import { EventHandler } from '../../ports/EventHandler';

const MINIFIED_NAME = 't';

/**
 * Production bundlers rename every module binding to short names, so distinct
 * event classes routinely end up sharing `constructor.name`. These classes
 * reproduce that: identical class names, distinct stable `event.name` values.
 */
const createEventClass = (stableName: string): EventType<IDomainEvent> & (new () => IDomainEvent) => {
  const eventName = DomainEventName.create(stableName)._unsafeUnwrap();
  class MinifiedEvent implements IDomainEvent {
    readonly name = eventName;
    readonly occurredAt = OccurredAt.now();
  }
  Object.defineProperty(MinifiedEvent, 'name', { value: MINIFIED_NAME, configurable: true });
  return MinifiedEvent as unknown as EventType<IDomainEvent> & (new () => IDomainEvent);
};

const entryFor = (
  event: EventType<IDomainEvent>,
  messageName: string
): DurableSubscriptionCatalogEntry => ({
  event,
  messageName,
  durableMode: 'active',
  sameTxTargets: [],
  durableTargets: [
    {
      consumerId: 'record.validation.v1',
      consumerGeneration: 1,
      retry: { maxAttempts: 1, policy: 'exponential-jitter' },
      ordering: 'none',
      idempotency: 'destination-inbox',
      replay: 'safe',
    },
  ],
  directTargets: [],
});

describe('event type identity under minified class names', () => {
  it('keeps same-named events in distinct catalog entries', () => {
    const first = createEventClass('RecordUpdated');
    const second = createEventClass('RecordReordered');
    expect(first.name).toBe(second.name);

    const catalog = ImmutableDurableSubscriptionCatalog.create({
      generation: 1,
      entries: [
        entryFor(first, 'table.record.updated.v1'),
        entryFor(second, 'table.record.reordered.v1'),
      ],
    })._unsafeUnwrap();

    expect(catalog.resolve(new first())._unsafeUnwrap().messageName).toBe(
      'table.record.updated.v1'
    );
    expect(catalog.resolve(new second())._unsafeUnwrap().messageName).toBe(
      'table.record.reordered.v1'
    );
  });

  it('rejects a catalog that registers one class twice', () => {
    const event = createEventClass('RecordUpdated');
    const result = ImmutableDurableSubscriptionCatalog.create({
      generation: 1,
      entries: [entryFor(event, 'table.record.updated.v1'), entryFor(event, 'table.record.updated.v1')],
    });
    expect(result.isErr()).toBe(true);
  });

  it('routes codecs by event class, not by class name', () => {
    const first = createEventClass('RecordUpdated');
    const second = createEventClass('RecordReordered');
    const codecFor = (eventType: EventType<IDomainEvent>, messageName: string) => ({
      eventType,
      messageName,
      schemaVersion: 1,
      encode: (event: IDomainEvent) => ok<ProjectionMessageJson>({ name: event.name.toString() }),
      decode: (payload: ProjectionMessageJson) => ok(payload),
      route: () => ({ transactionScope: 'data' as const }),
    });

    const registry = ProjectionMessageCodecRegistry.create([
      codecFor(first, 'table.record.updated.v1'),
      codecFor(second, 'table.record.reordered.v1'),
    ])._unsafeUnwrap();

    expect(registry.encode(new first())._unsafeUnwrap().messageName).toBe(
      'table.record.updated.v1'
    );
    expect(registry.encode(new second())._unsafeUnwrap().messageName).toBe(
      'table.record.reordered.v1'
    );
  });

  it('keeps direct consumer ids unique when handler classes share a minified name', () => {
    const event = createEventClass('RecordUpdated');
    const firstHandler = class MinifiedHandler {
      async handle(): Promise<never> {
        throw new Error('not used');
      }
    };
    const secondHandler = class MinifiedHandler {
      async handle(): Promise<never> {
        throw new Error('not used');
      }
    };
    Object.defineProperty(firstHandler, 'name', { value: MINIFIED_NAME });
    Object.defineProperty(secondHandler, 'name', { value: MINIFIED_NAME });
    EventHandler(event)(firstHandler);
    EventHandler(event)(secondHandler);

    const targets = legacyDirectTargetsForEventType(event, new Set());
    expect(targets).toHaveLength(2);
    expect(new Set(targets.map((target) => target.consumerId)).size).toBe(2);
  });
});
