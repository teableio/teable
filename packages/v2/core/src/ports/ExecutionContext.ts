import type { ActorId } from '../domain/shared/ActorId';

export interface IUnitOfWorkTransaction {
  readonly kind: 'unitOfWorkTransaction';
}

export interface IExecutionContext {
  actorId: ActorId;
  transaction?: IUnitOfWorkTransaction;
}
