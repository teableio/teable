import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { generateUuid } from '../../domain/shared/IdGenerator';
import type { Table } from '../../domain/table/Table';
import type * as EventBusPort from '../../ports/EventBus';
import {
  withoutTransaction,
  type IExecutionContext,
  type IUnitOfWorkTransaction,
  type UnitOfWorkAfterCommitHandler,
} from '../../ports/ExecutionContext';
import type { ILogger } from '../../ports/Logger';
import type { ISameTxProjectionDispatcher } from '../../ports/SameTxProjectionDispatcher';
import { sameTxTargetsForEvent } from '../projections/SameTxProjection';
import { runAfterCommitTasksSafely } from './batchTransactionOrchestration';
import { NoopSameTxProjectionDispatcher } from './SameTxProjectionDispatcher';

export type DispatchSameTxOptions = Readonly<{
  tables?: Iterable<Table>;
  previousTables?: Iterable<Table>;
}>;

const dispatchedSameTxEventsByTx = new WeakMap<IUnitOfWorkTransaction, WeakSet<IDomainEvent>>();

const collectActiveTransactions = (
  context: IExecutionContext
): ReadonlyArray<IUnitOfWorkTransaction> => {
  const result: IUnitOfWorkTransaction[] = [];
  for (const candidate of [
    context.transaction,
    context.transactions?.meta,
    context.transactions?.data,
  ]) {
    if (candidate && !result.includes(candidate)) {
      result.push(candidate);
    }
  }
  return result;
};

export const recordDispatchedSameTxEvent = (
  context: IExecutionContext,
  event: IDomainEvent
): void => {
  for (const tx of collectActiveTransactions(context)) {
    let set = dispatchedSameTxEventsByTx.get(tx);
    if (!set) {
      set = new WeakSet<IDomainEvent>();
      dispatchedSameTxEventsByTx.set(tx, set);
    }
    set.add(event);
  }
};

export const wasSameTxEventDispatched = (
  context: IExecutionContext,
  event: IDomainEvent
): boolean =>
  collectActiveTransactions(context).some((tx) =>
    Boolean(dispatchedSameTxEventsByTx.get(tx)?.has(event))
  );

export const hasSameTxTargets = (
  dispatcher: ISameTxProjectionDispatcher | undefined,
  events: ReadonlyArray<IDomainEvent>
): boolean =>
  Boolean(
    dispatcher &&
    !(dispatcher instanceof NoopSameTxProjectionDispatcher) &&
    events.some((event) => sameTxTargetsForEvent(event).length > 0)
  );

export const dispatchSameTxEvents = async (
  dataTxContext: IExecutionContext,
  dispatcher: ISameTxProjectionDispatcher,
  events: ReadonlyArray<IDomainEvent>,
  options?: DispatchSameTxOptions
): Promise<Result<void, DomainError>> => {
  if (!hasSameTxTargets(dispatcher, events)) {
    return ok(undefined);
  }

  const tables = new Map<string, Table>();
  for (const table of options?.tables ?? []) {
    tables.set(table.id().toString(), table);
  }

  let previousTables: Map<string, Table> | undefined;
  if (options?.previousTables) {
    previousTables = new Map<string, Table>();
    for (const table of options.previousTables) {
      previousTables.set(table.id().toString(), table);
    }
  }

  const historyRowBudget = { remaining: 200 };
  for (const event of events) {
    if (wasSameTxEventDispatched(dataTxContext, event)) {
      continue;
    }
    const targets = sameTxTargetsForEvent(event);
    if (targets.length === 0) {
      continue;
    }

    const result = await dispatcher.dispatch(
      {
        ...dataTxContext,
        sameTxProjection: {
          eventId: generateUuid(),
          tables,
          ...(previousTables ? { previousTables } : {}),
          historyRowBudget,
        },
      },
      event,
      targets
    );
    if (result.isErr()) {
      return err(result.error);
    }
    recordDispatchedSameTxEvent(dataTxContext, event);
  }

  return ok(undefined);
};

export const publishEventsWithBatchDeferral = async (
  context: IExecutionContext,
  eventBus: EventBusPort.IEventBus,
  events: ReadonlyArray<IDomainEvent>,
  afterPublish?: UnitOfWorkAfterCommitHandler | ReadonlyArray<UnitOfWorkAfterCommitHandler>,
  logger?: ILogger
): Promise<Result<void, DomainError>> => {
  const afterPublishHooks: ReadonlyArray<UnitOfWorkAfterCommitHandler> = !afterPublish
    ? []
    : typeof afterPublish === 'function'
      ? [afterPublish]
      : afterPublish;
  if (events.length === 0 && afterPublishHooks.length === 0) {
    return ok(undefined);
  }

  if (context.batchTransaction) {
    const dispatchContext = withoutTransaction(context);
    if (events.length > 0) {
      context.batchTransaction.enqueueAfterCommit(async () => {
        const publishResult = await eventBus.publishMany(dispatchContext, events);
        if (publishResult.isErr()) {
          throw new Error(publishResult.error.message);
        }
      });
    }
    for (const hook of afterPublishHooks) {
      context.batchTransaction.enqueueAfterCommit(hook);
    }
    return ok(undefined);
  }

  if (events.length > 0) {
    const publishResult = await eventBus.publishMany(context, events);
    if (publishResult.isErr()) {
      return err(publishResult.error);
    }
  }
  await runAfterCommitTasksSafely(afterPublishHooks, 'data', logger);
  return ok(undefined);
};
