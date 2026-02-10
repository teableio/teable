import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { IProjection } from './Projection';

export type IRealtimeProjection<TEvent extends IDomainEvent = IDomainEvent> = IProjection<TEvent>;
