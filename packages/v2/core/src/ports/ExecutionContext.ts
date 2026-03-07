import type { TableI18nKey } from '@teable/i18n-keys';

import type { ActorId } from '../domain/shared/ActorId';
import type { IDomainContext, IDomainContextConfig } from '../domain/shared/DomainContext';
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
    selectFieldOptions?: IDomainContextConfig['selectFieldOptions'];
    tableFields?: IDomainContextConfig['tableFields'];
  };
  $t?: (key: TableI18nKey, options?: Record<string, unknown>) => string;
}

export const getDomainContext = (context?: IExecutionContext): IDomainContext | undefined => {
  const selectFieldOptions = context?.config?.selectFieldOptions;
  const tableFields = context?.config?.tableFields;
  if (!context?.$t && !selectFieldOptions && !tableFields) {
    return undefined;
  }

  const translate = context?.$t
    ? (key: string, options?: Record<string, unknown>) =>
        context.$t?.(key as TableI18nKey, options) ?? key
    : undefined;

  return {
    t: translate,
    config:
      selectFieldOptions || tableFields
        ? {
            ...(selectFieldOptions ? { selectFieldOptions } : {}),
            ...(tableFields ? { tableFields } : {}),
          }
        : undefined,
  };
};
