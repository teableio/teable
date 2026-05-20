import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../../shared/DomainContext';
import { domainError, type DomainError } from '../../../shared/DomainError';
import { DEFAULT_TABLE_DATA_SAFETY_LIMITS } from '../../../shared/TableDataSafetyLimits';

export const ensureSelectFieldOptionCountWithinLimit = (
  optionCount: number,
  domainContext?: IDomainContext
): Result<void, DomainError> => {
  const maxChoicesPerField =
    domainContext?.config?.tableLimits?.fieldOptions?.maxSelectChoices ??
    domainContext?.config?.selectFieldOptions?.maxChoicesPerField ??
    DEFAULT_TABLE_DATA_SAFETY_LIMITS.fieldOptions.maxSelectChoices;
  if (maxChoicesPerField == null || optionCount <= maxChoicesPerField) {
    return ok(undefined);
  }

  return err(
    domainError.validation({
      code: 'validation.field.select_options_limit',
      message: `Select field options cannot exceed ${maxChoicesPerField} choices`,
    })
  );
};

export const ensureSelectFieldOptionNameWithinLimit = (
  optionNameLength: number,
  domainContext?: IDomainContext
): Result<void, DomainError> => {
  const maxChoiceNameLength =
    domainContext?.config?.tableLimits?.fieldOptions?.maxSelectChoiceNameLength ??
    DEFAULT_TABLE_DATA_SAFETY_LIMITS.fieldOptions.maxSelectChoiceNameLength;
  if (maxChoiceNameLength == null || optionNameLength <= maxChoiceNameLength) {
    return ok(undefined);
  }

  return err(
    domainError.validation({
      code: 'validation.limit.select_choice_name_max_length',
      message: `Select field option names cannot exceed ${maxChoiceNameLength} characters`,
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
