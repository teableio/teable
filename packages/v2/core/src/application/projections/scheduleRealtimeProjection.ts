import { ok } from 'neverthrow';
import type { Result, ResultAsync } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IEventDispatchScope } from '../../ports/EventHandler';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { getUnitOfWorkTransaction, withoutTransaction } from '../../ports/ExecutionContext';
import { createTeableSpanAttributes, TeableSpanAttributes } from '../../ports/Tracer';
import {
  createRealtimeTableSnapshotCache,
  type RealtimeTableSnapshotCache,
} from './RealtimeTableSnapshotCache';

export type RealtimeProjectionScheduler = (task: () => Promise<void>) => void;

export type RealtimeProjectionScope = {
  tableSnapshotCache: RealtimeTableSnapshotCache;
  viewColumnMetaRealtimePendingKeys: Set<string>;
};

const realtimeProjectionScopeKey = Symbol('v2.realtimeProjectionScope');

const defaultRealtimeProjectionScheduler: RealtimeProjectionScheduler = (task) => {
  const immediate = (globalThis as { setImmediate?: (task: () => void) => void }).setImmediate;
  if (typeof immediate === 'function') {
    immediate(() => void task());
    return;
  }

  const timeout = (globalThis as { setTimeout?: (handler: () => void, timeout: number) => void })
    .setTimeout;
  if (typeof timeout === 'function') {
    timeout(() => void task(), 0);
    return;
  }

  const microtask = (globalThis as { queueMicrotask?: (task: () => void) => void }).queueMicrotask;
  if (typeof microtask === 'function') {
    microtask(() => void task());
    return;
  }

  void task();
};

let realtimeProjectionScheduler: RealtimeProjectionScheduler = defaultRealtimeProjectionScheduler;

const createRealtimeProjectionScope = (): RealtimeProjectionScope => ({
  tableSnapshotCache: createRealtimeTableSnapshotCache(),
  viewColumnMetaRealtimePendingKeys: new Set<string>(),
});

export const getRealtimeProjectionScope = (
  dispatchScope?: IEventDispatchScope
): RealtimeProjectionScope =>
  dispatchScope?.getOrCreate(realtimeProjectionScopeKey, createRealtimeProjectionScope) ??
  createRealtimeProjectionScope();

export const setRealtimeProjectionSchedulerForTest = (
  scheduler?: RealtimeProjectionScheduler
): void => {
  realtimeProjectionScheduler = scheduler ?? defaultRealtimeProjectionScheduler;
};

const registerAfterCommit = (context: IExecutionContext, task: () => Promise<void>): boolean => {
  const metaTransaction = getUnitOfWorkTransaction(context, 'meta');
  if (metaTransaction?.afterCommit) {
    metaTransaction.afterCommit(task);
    return true;
  }

  const dataTransaction = getUnitOfWorkTransaction(context, 'data');
  if (dataTransaction?.afterCommit) {
    dataTransaction.afterCommit(task);
    return true;
  }

  return false;
};

export const scheduleRealtimeProjection = (
  context: IExecutionContext,
  projectionName: string,
  task: (
    context: IExecutionContext,
    scope: RealtimeProjectionScope
  ) => Promise<Result<void, DomainError>> | ResultAsync<void, DomainError>,
  projectionScope: RealtimeProjectionScope = getRealtimeProjectionScope()
): Result<void, DomainError> => {
  const backgroundContext = withoutTransaction(context);
  const run = async () => {
    const tracer = backgroundContext.tracer;
    const span = tracer?.startSpan(
      `teable.${projectionName}.background`,
      createTeableSpanAttributes('projection', `${projectionName}.background`, {
        [TeableSpanAttributes.HANDLER]: projectionName,
        [TeableSpanAttributes.EVENT_ASYNC]: true,
      })
    );

    const execute = async () => {
      try {
        const result = await task(backgroundContext, projectionScope);
        if (result.isErr()) {
          span?.recordError(result.error.message);
        }
      } catch (error) {
        span?.recordError(error instanceof Error ? error.message : String(error));
      } finally {
        span?.end();
      }
    };

    if (span && tracer) {
      await tracer.withSpan(span, execute);
      return;
    }

    await execute();
  };

  const scheduleRun = async () => {
    realtimeProjectionScheduler(run);
  };

  if (registerAfterCommit(context, scheduleRun)) {
    return ok(undefined);
  }

  realtimeProjectionScheduler(run);
  return ok(undefined);
};
