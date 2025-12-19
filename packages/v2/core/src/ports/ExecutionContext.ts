import type { ActorId } from '../domain/shared/ActorId';

export interface IExecutionContext {
  actorId: ActorId;
}
