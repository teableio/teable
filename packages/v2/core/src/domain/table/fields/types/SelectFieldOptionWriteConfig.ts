import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../../shared/DomainContext';
import { domainError, type DomainError } from '../../../shared/DomainError';
import {
  DEFAULT_TABLE_DATA_SAFETY_LIMITS,
  measureJsonBytes,
  tableDataSafetyLimitErrors,
} from '../../../shared/TableDataSafetyLimits';
import type { SelectOption } from './SelectOption';

export const resolveMaxSelectChoices = (domainContext?: IDomainContext): number =>
  domainContext?.config?.tableLimits?.fieldOptions?.maxSelectChoices ??
  domainContext?.config?.selectFieldOptions?.maxChoicesPerField ??
  DEFAULT_TABLE_DATA_SAFETY_LIMITS.fieldOptions.maxSelectChoices;

export const resolveMaxSelectChoiceNameLength = (domainContext?: IDomainContext): number =>
  domainContext?.config?.tableLimits?.fieldOptions?.maxSelectChoiceNameLength ??
  DEFAULT_TABLE_DATA_SAFETY_LIMITS.fieldOptions.maxSelectChoiceNameLength;

export const selectFieldOptionCountExceededError = (maxChoicesPerField: number): DomainError =>
  domainError.validation({
    code: 'validation.field.select_options_limit',
    message: `Select field options cannot exceed ${maxChoicesPerField} choices`,
    localization: {
      i18nKey: 'httpErrors.limit.selectChoicesMax',
      context: { max: maxChoicesPerField },
    },
  });

export const ensureSelectFieldOptionCountWithinLimit = (
  optionCount: number,
  domainContext?: IDomainContext
): Result<void, DomainError> => {
  const maxChoicesPerField = resolveMaxSelectChoices(domainContext);
  if (maxChoicesPerField == null || optionCount <= maxChoicesPerField) {
    return ok(undefined);
  }

  return err(selectFieldOptionCountExceededError(maxChoicesPerField));
};

export const ensureSelectFieldOptionNameWithinLimit = (
  optionNameLength: number,
  domainContext?: IDomainContext
): Result<void, DomainError> => {
  const maxChoiceNameLength = resolveMaxSelectChoiceNameLength(domainContext);
  if (maxChoiceNameLength == null || optionNameLength <= maxChoiceNameLength) {
    return ok(undefined);
  }

  return err(
    domainError.validation({
      code: tableDataSafetyLimitErrors.selectChoiceNameMaxLength.code,
      message: `Select field option names cannot exceed ${maxChoiceNameLength} characters`,
      localization: {
        i18nKey: tableDataSafetyLimitErrors.selectChoiceNameMaxLength.i18nKey,
        context: { max: maxChoiceNameLength },
      },
    })
  );
};

export const ensureSelectFieldOptionNamesWithinLimit = (
  optionNames: ReadonlyArray<string>,
  domainContext?: IDomainContext
): Result<void, DomainError> => {
  for (const optionName of optionNames) {
    const result = ensureSelectFieldOptionNameWithinLimit(optionName.length, domainContext);
    if (result.isErr()) return result;
  }

  return ok(undefined);
};

export const resolveMaxSelectOptionsBytes = (domainContext?: IDomainContext): number =>
  domainContext?.config?.tableLimits?.fieldOptions?.maxBytes ??
  DEFAULT_TABLE_DATA_SAFETY_LIMITS.fieldOptions.maxBytes;

/** Same measure as the field update limit: the JSON bytes of the choice DTOs. */
export const measureSelectOptionsBytes = (options: ReadonlyArray<SelectOption>): number =>
  measureJsonBytes(options.map((option) => option.toDto()));

export const selectFieldOptionsBytesExceededError = (maxBytes: number): DomainError =>
  domainError.validation({
    code: tableDataSafetyLimitErrors.fieldOptionsMaxBytes.code,
    message: `Select field options cannot exceed ${maxBytes} bytes`,
    localization: {
      i18nKey: tableDataSafetyLimitErrors.fieldOptionsMaxBytes.i18nKey,
      context: { max: maxBytes },
    },
  });

export const ensureSelectFieldOptionsBytesWithinLimit = (
  options: ReadonlyArray<SelectOption>,
  domainContext?: IDomainContext
): Result<void, DomainError> => {
  const maxBytes = resolveMaxSelectOptionsBytes(domainContext);
  if (maxBytes == null || measureSelectOptionsBytes(options) <= maxBytes) {
    return ok(undefined);
  }

  return err(selectFieldOptionsBytesExceededError(maxBytes));
};
