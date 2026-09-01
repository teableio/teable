import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../../shared/DomainContext';
import { domainError, type DomainError } from '../../../shared/DomainError';
import {
  DEFAULT_TABLE_DATA_SAFETY_LIMITS,
  tableDataSafetyLimitErrors,
} from '../../../shared/TableDataSafetyLimits';

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
