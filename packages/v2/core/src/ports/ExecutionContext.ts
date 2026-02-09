import type { TableI18nKey } from '@teable/i18n-keys';
import type { ActorId } from '../domain/shared/ActorId';
import type { ITracer } from './Tracer';

export interface IUnitOfWorkTransaction {
  readonly kind: 'unitOfWorkTransaction';
}

export interface IExecutionContext {
  actorId: ActorId;
  transaction?: IUnitOfWorkTransaction;
  tracer?: ITracer;
  requestId?: string;
  windowId?: string;
  undoRedo?: { mode: 'undo' | 'redo' | 'normal' };
  $t?: (key: TableI18nKey, options?: Record<string, unknown>) => string;
}
