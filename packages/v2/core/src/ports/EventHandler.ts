import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { IExecutionContext } from './ExecutionContext';
import { TraceSpan, isTraceSpanWrapped } from './TraceSpan';

export interface IEventHandler<TEvent extends IDomainEvent> {
  handle(context: IExecutionContext, event: TEvent): Promise<Result<void, DomainError>>;
}

export type EventType<TEvent extends IDomainEvent> = {
  readonly prototype: TEvent;
  readonly name: string;
};
export type EventHandlerClass<TEvent extends IDomainEvent> = {
  readonly prototype: IEventHandler<TEvent>;
};

const eventHandlerRegistry = new Map<
  EventType<IDomainEvent>,
  Array<EventHandlerClass<IDomainEvent>>
>();

export const EventHandler =
  <TEvent extends IDomainEvent>(event: EventType<TEvent>) =>
  (target: EventHandlerClass<TEvent>): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target.prototype, 'handle');
    if (
      descriptor &&
      typeof descriptor.value === 'function' &&
      !isTraceSpanWrapped(descriptor.value)
    ) {
      TraceSpan()(target.prototype, 'handle', descriptor);
      Object.defineProperty(target.prototype, 'handle', descriptor);
    }
    const existing = eventHandlerRegistry.get(event) ?? [];
    if (!existing.includes(target as EventHandlerClass<IDomainEvent>)) {
      existing.push(target as EventHandlerClass<IDomainEvent>);
    }
    eventHandlerRegistry.set(event, existing as Array<EventHandlerClass<IDomainEvent>>);
  };

export const getEventHandlerTokens = (
  event: EventType<IDomainEvent>
): ReadonlyArray<EventHandlerClass<IDomainEvent>> => {
  const handlers = eventHandlerRegistry.get(event) ?? [];
  return [...handlers];
};
