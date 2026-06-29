import type { DomainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export const sequenceResults = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<ReadonlyArray<T>, DomainError> => {
  const result: T[] = [];
  for (const value of values) {
    if (value.isErr()) return err<ReadonlyArray<T>, DomainError>(value.error);
    result.push(value.value);
  }
  return ok(result);
};
