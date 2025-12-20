import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

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
): Result<ReadonlyArray<SelectOption>, string> => {
  if (!isUniqueByStringValue(options.map((option) => option.name())))
    return err('SelectField options must be unique');

  if (defaultValue) {
    if (mode === 'single' && defaultValue.isMultiple())
      return err('SelectField defaultValue must be a single option');
    if (mode === 'multiple' && !defaultValue.isMultiple())
      return err('SelectField defaultValue must be an array of options');

    const names = new Set(options.map((option) => option.name().toString()));
    const defaults = defaultValue.toDto();
    const values = Array.isArray(defaults) ? defaults : [defaults];
    for (const value of values) {
      if (!names.has(value)) return err('SelectField defaultValue must match an option name');
    }
  }

  return ok([...options]);
};
