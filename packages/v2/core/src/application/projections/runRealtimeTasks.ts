import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';

export const REALTIME_TASK_CONCURRENCY_LIMIT = 32;

export async function runRealtimeTasks(
  tasks: ReadonlyArray<() => Promise<Result<void, DomainError>>>,
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

      results[currentIndex] = await tasks[currentIndex]!();
    }
  };

  const workerCount = Math.min(normalizedConcurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
