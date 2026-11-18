import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { DomainEventName } from '../../domain/shared/DomainEventName';
import type { EventHandlerClass, EventType, IEventHandler } from '../../ports/EventHandler';

export type SameTxProjectionOptions = Readonly<{
  id: string;
  eventName?: DomainEventName;
}>;

export type SameTxProjectionRegistration<TEvent extends IDomainEvent = IDomainEvent> = Readonly<{
  event: EventType<TEvent>;
  eventName?: DomainEventName;
  handler: EventHandlerClass<TEvent>;
  id: string;
}>;

const sameTxProjectionRegistry: SameTxProjectionRegistration[] = [];

const matchesSameTxRegistration = (
  reg: SameTxProjectionRegistration<IDomainEvent>,
  event: IDomainEvent
): boolean =>
  (typeof reg.event === 'function' &&
    event instanceof (reg.event as abstract new (...args: never[]) => IDomainEvent)) ||
  (reg.eventName !== undefined && event.name.equals(reg.eventName));

export const registerSameTxProjection = <TEvent extends IDomainEvent>(
  event: EventType<TEvent>,
  handler: EventHandlerClass<TEvent>,
  options: SameTxProjectionOptions
): (() => void) => {
  const entry: SameTxProjectionRegistration = {
    event: event as EventType<IDomainEvent>,
    ...(options.eventName ? { eventName: options.eventName } : {}),
    handler: handler as EventHandlerClass<IDomainEvent>,
    id: options.id,
  };
  sameTxProjectionRegistry.push(entry);
  return () => {
    const index = sameTxProjectionRegistry.indexOf(entry);
    if (index >= 0) {
      sameTxProjectionRegistry.splice(index, 1);
    }
  };
};

export const SameTxProjectionHandler =
  <TEvent extends IDomainEvent>(event: EventType<TEvent>, options: SameTxProjectionOptions) =>
  (target: EventHandlerClass<TEvent>): void => {
    registerSameTxProjection(event, target, options);
  };

export const getSameTxProjectionRegistrations = (): ReadonlyArray<
  SameTxProjectionRegistration<IDomainEvent>
> => [...sameTxProjectionRegistry];

export const sameTxTargetsForEvent = (
  event: IDomainEvent
): ReadonlyArray<{ consumerId: string; handler: EventHandlerClass<IDomainEvent> }> =>
  sameTxProjectionRegistry
    .filter((reg) => matchesSameTxRegistration(reg, event))
    .map((reg) => ({
      consumerId: reg.id,
      handler: reg.handler,
    }));

export const isSameTxProjectionHandlerForEvent = (
  event: IDomainEvent,
  handler: EventHandlerClass<IDomainEvent>
): boolean =>
  sameTxProjectionRegistry.some(
    (reg) => reg.handler === handler && matchesSameTxRegistration(reg, event)
  );

export type ISameTxProjectionHandler<TEvent extends IDomainEvent> = IEventHandler<TEvent>;
