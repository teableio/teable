import { tableI18nKeys } from '@teable/i18n-keys';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainContext } from '../shared/DomainContext';
import { domainError, type DomainError } from '../shared/DomainError';
import type { Table } from './Table';

export const DEFAULT_MAX_TABLE_FIELD_COUNT = 500;
export const MAX_TABLE_FIELD_COUNT = DEFAULT_MAX_TABLE_FIELD_COUNT;
export const TABLE_FIELD_LIMIT_ERROR_CODE = 'validation.field.max_column_limit';

export type TableFieldLimitErrorDetails = {
  tableId: string;
  tableName: string;
  currentFieldCount: number;
  attemptedFieldCount: number;
  maxFieldCount: number;
};

export const buildTableFieldLimitErrorDetails = (
  table: Table,
  addedFieldCount = 1,
  domainContext?: IDomainContext
): TableFieldLimitErrorDetails => {
  const currentFieldCount = table.getFields().length;
  const maxFieldCount =
    domainContext?.config?.tableFields?.maxFieldsPerTable ?? DEFAULT_MAX_TABLE_FIELD_COUNT;
  return {
    tableId: table.id().toString(),
    tableName: table.name().toString(),
    currentFieldCount,
    attemptedFieldCount: currentFieldCount + addedFieldCount,
    maxFieldCount,
  };
};

export const buildTableFieldLimitFallbackMessage = (
  tableName: string,
  maxFieldCount = DEFAULT_MAX_TABLE_FIELD_COUNT
): string => `Table "${tableName}" can have at most ${maxFieldCount} fields.`;

export const buildTableFieldLimitMessage = (
  details: TableFieldLimitErrorDetails,
  domainContext?: IDomainContext
): string => {
  if (!domainContext?.t) {
    return buildTableFieldLimitFallbackMessage(details.tableName, details.maxFieldCount);
  }

  try {
    return domainContext.t(tableI18nKeys.validation.field.maxColumnLimit, {
      tableName: details.tableName,
      maxFieldCount: details.maxFieldCount,
    });
  } catch {
    return buildTableFieldLimitFallbackMessage(details.tableName, details.maxFieldCount);
  }
};

export const ensureTableFieldCountWithinLimit = (
  table: Table,
  options?: {
    addedFieldCount?: number;
    domainContext?: IDomainContext;
  }
): Result<void, DomainError> => {
  const details = buildTableFieldLimitErrorDetails(
    table,
    options?.addedFieldCount,
    options?.domainContext
  );
  if (details.attemptedFieldCount <= details.maxFieldCount) {
    return ok(undefined);
  }

  return err(
    domainError.validation({
      code: TABLE_FIELD_LIMIT_ERROR_CODE,
      message: buildTableFieldLimitMessage(details, options?.domainContext),
      details,
    })
  );
};

export const createTableFieldLimitExceededError = (
  table: Table,
  options?: {
    addedFieldCount?: number;
    message?: string;
    domainContext?: IDomainContext;
  }
): DomainError => {
  const details = buildTableFieldLimitErrorDetails(
    table,
    options?.addedFieldCount,
    options?.domainContext
  );
  return domainError.validation({
    code: TABLE_FIELD_LIMIT_ERROR_CODE,
    message: options?.message ?? buildTableFieldLimitMessage(details, options?.domainContext),
    details,
  });
};
