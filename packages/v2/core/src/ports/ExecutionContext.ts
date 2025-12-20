import type { ActorId } from '../domain/shared/ActorId';
import type { ITracer } from './Tracer';

export interface IUnitOfWorkTransaction {
  readonly kind: 'unitOfWorkTransaction';
}

export interface IExecutionContext {
  actorId: ActorId;
  transaction?: IUnitOfWorkTransaction;
  tracer?: ITracer;
}
