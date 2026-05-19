import type { Result, ResultAsync } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';

export const REALTIME_TASK_CONCURRENCY_LIMIT = 32;

// safeTry with async generators returns ResultAsync, not Promise<Result>.
// Awaiting either yields a Result, so we accept both shapes here.
export async function runRealtimeTasks(
  tasks: ReadonlyArray<
    () =>
      | Promise<Result<void, DomainError>>
      | Promise<Result<undefined, DomainError>>
      | ResultAsync<void, DomainError>
      | ResultAsync<undefined, DomainError>
  >,
  concurrency = REALTIME_TASK_CONCURRENCY_LIMIT
): Promise<ReadonlyArray<Result<void, DomainError>>> {
  if (tasks.length === 0) {
    return [];
  }

  const normalizedConcurrency = Math.max(1, Math.floor(concurrency));
  const results: Result<void, DomainError>[] = new Array(tasks.length);
  let nextIndex = 0;

  const worker = async () => {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= tasks.length) {
        return;
      }

      const r = await tasks[currentIndex]!();
      // Result<undefined, E> is structurally Result<void, E> at runtime.
      results[currentIndex] = r as Result<void, DomainError>;
    }
  };

  const workerCount = Math.min(normalizedConcurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
