import type { TableI18nKey } from '@teable/i18n-keys';
import type { ActorId } from '../domain/shared/ActorId';
import type { ISelectFieldOptionWriteConfig } from '../domain/table/fields/types/SelectFieldOptionWriteConfig';
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
  config?: {
    selectFieldOptions?: ISelectFieldOptionWriteConfig;
  };
  $t?: (key: TableI18nKey, options?: Record<string, unknown>) => string;
}

export const getSelectFieldOptionWriteConfig = (
  context?: IExecutionContext
): ISelectFieldOptionWriteConfig | undefined => context?.config?.selectFieldOptions;
