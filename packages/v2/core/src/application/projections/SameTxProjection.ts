import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { EventHandlerClass, EventType, IEventHandler } from '../../ports/EventHandler';

export type SameTxProjectionOptions = Readonly<{
  id: string;
}>;

export type SameTxProjectionRegistration<TEvent extends IDomainEvent = IDomainEvent> = Readonly<{
  event: EventType<TEvent>;
  handler: EventHandlerClass<TEvent>;
  id: string;
}>;

const sameTxProjectionRegistry: SameTxProjectionRegistration[] = [];

export const SameTxProjectionHandler =
  <TEvent extends IDomainEvent>(event: EventType<TEvent>, options: SameTxProjectionOptions) =>
  (target: EventHandlerClass<TEvent>): void => {
    sameTxProjectionRegistry.push({ event, handler: target, id: options.id });
  };

export const getSameTxProjectionRegistrations = (): ReadonlyArray<
  SameTxProjectionRegistration<IDomainEvent>
> => [...sameTxProjectionRegistry];

export type ISameTxProjectionHandler<TEvent extends IDomainEvent> = IEventHandler<TEvent>;
