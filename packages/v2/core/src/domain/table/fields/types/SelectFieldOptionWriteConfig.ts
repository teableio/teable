import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';

export interface ISelectFieldOptionWriteConfig {
  maxChoicesPerField?: number;
}

export const ensureSelectFieldOptionCountWithinLimit = (
  optionCount: number,
  config?: ISelectFieldOptionWriteConfig
): Result<void, DomainError> => {
  const maxChoicesPerField = config?.maxChoicesPerField;
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
