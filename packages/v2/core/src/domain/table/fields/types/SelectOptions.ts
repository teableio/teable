import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import type { SelectDefaultValue } from './SelectDefaultValue';
import type { SelectOption } from './SelectOption';

const isUniqueByStringValue = (values: ReadonlyArray<{ toString(): string }>): boolean => {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toString();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};

export const validateSelectOptions = (
  options: ReadonlyArray<SelectOption>,
  defaultValue?: SelectDefaultValue,
  mode: 'single' | 'multiple' = 'single'
): Result<ReadonlyArray<SelectOption>, DomainError> => {
  if (!isUniqueByStringValue(options.map((option) => option.name())))
    return err(domainError.conflict({ message: 'SelectField options must be unique' }));

  if (defaultValue) {
    if (mode === 'single' && defaultValue.isMultiple())
      return err(
        domainError.validation({ message: 'SelectField defaultValue must be a single option' })
      );

    const names = new Set(options.map((option) => option.name().toString()));
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
