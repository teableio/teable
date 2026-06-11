import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { EventType, IEventHandler } from '../../ports/EventHandler';
import { EventHandler } from '../../ports/EventHandler';

export type IProjection<TEvent extends IDomainEvent = IDomainEvent> = IEventHandler<TEvent>;

export const ProjectionHandler = <TEvent extends IDomainEvent>(event: EventType<TEvent>) =>
  EventHandler(event, { role: 'projection' });
