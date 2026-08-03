import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IDomainContext } from '../../../shared/DomainContext';
import { domainError, type DomainError } from '../../../shared/DomainError';
import type { SelectDefaultValue } from './SelectDefaultValue';
import {
  ensureSelectFieldOptionCountWithinLimit,
  ensureSelectFieldOptionNameWithinLimit,
} from './SelectFieldOptionWriteConfig';
import type { SelectOption } from './SelectOption';

export type SelectOptionsValidationContext = {
  domainContext?: IDomainContext;
};

export const validateSelectOptions = (
  options: ReadonlyArray<SelectOption>,
  defaultValue?: SelectDefaultValue,
  mode: 'single' | 'multiple' = 'single',
  context?: SelectOptionsValidationContext
): Result<ReadonlyArray<SelectOption>, DomainError> => {
  const domainContext = context?.domainContext;
  if (domainContext) {
    const countResult = ensureSelectFieldOptionCountWithinLimit(options.length, domainContext);
    if (countResult.isErr()) return err(countResult.error);
  }

  const names = new Set<string>();
  let hasDuplicateName = false;
  for (const option of options) {
    const name = option.name().toString();
    if (domainContext) {
      const nameLimitResult = ensureSelectFieldOptionNameWithinLimit(name.length, domainContext);
      if (nameLimitResult.isErr()) return err(nameLimitResult.error);
    }
    if (names.has(name)) {
      hasDuplicateName = true;
    } else {
      names.add(name);
    }
  }

  if (hasDuplicateName)
    return err(domainError.conflict({ message: 'SelectField options must be unique' }));

  if (defaultValue) {
    if (mode === 'single' && defaultValue.isMultiple())
      return err(
        domainError.validation({ message: 'SelectField defaultValue must be a single option' })
      );

    const defaults = defaultValue.toDto();
    const values = Array.isArray(defaults) ? defaults : [defaults];
    for (const value of values) {
      if (!names.has(value))
        return err(
          domainError.validation({ message: 'SelectField defaultValue must match an option name' })
        );
    }
  }

  return ok([...options]);
};
