import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { EventType } from '../../ports/EventHandler';

/**
 * Index of catalog/codec registrations keyed by runtime event identity.
 *
 * Registrations are matched by the event class object, never by
 * `constructor.name`: production bundlers rename classes, so two unrelated
 * events can share a name (`class t`). A name index is kept as a secondary
 * fallback for callers that hand a different class object for the same event,
 * and any name claimed by more than one class is dropped from it so a minified
 * name can never route one event to another event's registrations.
 */
export class EventTypeIndex<TValue> {
  private readonly byType = new Map<EventType<IDomainEvent>, TValue>();
  private readonly byName = new Map<string, TValue>();
  private readonly ambiguousNames = new Set<string>();

  set(eventType: EventType<IDomainEvent>, value: TValue): void {
    this.byType.set(eventType, value);
    const name = eventType.name;
    if (this.ambiguousNames.has(name)) {
      return;
    }
    if (this.byName.has(name)) {
      this.byName.delete(name);
      this.ambiguousNames.add(name);
      return;
    }
    this.byName.set(name, value);
  }

  has(eventType: EventType<IDomainEvent>): boolean {
    return this.byType.has(eventType);
  }

  get(eventType: EventType<IDomainEvent>): TValue | undefined {
    return this.byType.get(eventType);
  }

  /** Resolve an event instance: class identity first, then the unambiguous class name. */
  resolve(event: IDomainEvent): TValue | undefined {
    const byConstructor = this.byType.get(event.constructor as EventType<IDomainEvent>);
    if (byConstructor !== undefined) {
      return byConstructor;
    }
    return this.byName.get(event.constructor.name) ?? this.byName.get(event.name.toString());
  }
}
