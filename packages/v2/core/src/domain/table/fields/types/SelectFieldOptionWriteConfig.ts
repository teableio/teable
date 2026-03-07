import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../../shared/DomainContext';
import { domainError, type DomainError } from '../../../shared/DomainError';

export const ensureSelectFieldOptionCountWithinLimit = (
  optionCount: number,
  domainContext?: IDomainContext
): Result<void, DomainError> => {
  const maxChoicesPerField = domainContext?.config?.selectFieldOptions?.maxChoicesPerField;
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
