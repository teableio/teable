import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { IExecutionContext } from './ExecutionContext';
import { TeableSpanAttributes } from './Tracer';
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

export type EventHandlerRole = 'projection';

type EventHandlerOptions = Readonly<{
  role?: EventHandlerRole;
}>;

const eventHandlerRoleSymbol = Symbol('v2.eventHandlerRole');

const eventHandlerRegistry = new Map<
  EventType<IDomainEvent>,
  Array<EventHandlerClass<IDomainEvent>>
>();

export const EventHandler =
  <TEvent extends IDomainEvent>(event: EventType<TEvent>, options: EventHandlerOptions = {}) =>
  (target: EventHandlerClass<TEvent>): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target.prototype, 'handle');
    if (
      descriptor &&
      typeof descriptor.value === 'function' &&
      !isTraceSpanWrapped(descriptor.value)
    ) {
      const role = options.role;
      TraceSpan({
        component: role === 'projection' ? 'projection' : 'handler',
        attributes: (_context, payload) => ({
          [TeableSpanAttributes.EVENT_NAME]:
            typeof payload === 'object' &&
            payload != null &&
            'name' in payload &&
            typeof (payload as { name?: { toString?: () => string } }).name?.toString === 'function'
              ? (payload as { name: { toString: () => string } }).name.toString()
              : event.name,
          [TeableSpanAttributes.EVENT_ROLE]: role ?? 'handler',
          [TeableSpanAttributes.EVENT_ASYNC]: role === 'projection',
        }),
      })(target.prototype, 'handle', descriptor);
      Object.defineProperty(target.prototype, 'handle', descriptor);
    }
    if (options.role) {
      Object.defineProperty(target, eventHandlerRoleSymbol, {
        configurable: false,
        enumerable: false,
        value: options.role,
        writable: false,
      });
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

export const getEventHandlerRole = (
  target: EventHandlerClass<IDomainEvent>
): EventHandlerRole | undefined =>
  (
    target as EventHandlerClass<IDomainEvent> & {
      [eventHandlerRoleSymbol]?: EventHandlerRole;
    }
  )[eventHandlerRoleSymbol];
