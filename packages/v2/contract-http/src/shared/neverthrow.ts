import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export const sequenceResults = <T>(
  values: ReadonlyArray<Result<T, string>>
): Result<ReadonlyArray<T>, string> =>
  values.reduce<Result<ReadonlyArray<T>, string>>(
    (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
    ok([])
  );
