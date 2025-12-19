import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { SelectOptionName } from './SelectOptionName';

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
  options: ReadonlyArray<SelectOptionName>
): Result<ReadonlyArray<SelectOptionName>, string> => {
  if (options.length === 0) return err('SelectField requires at least one option');
  if (!isUniqueByStringValue(options)) return err('SelectField options must be unique');
  return ok([...options]);
};
