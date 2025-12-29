import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { IEventHandler } from '../../ports/EventHandler';
import { EventHandler } from '../../ports/EventHandler';

export type IProjection<TEvent extends IDomainEvent = IDomainEvent> = IEventHandler<TEvent>;

export const ProjectionHandler = EventHandler;
