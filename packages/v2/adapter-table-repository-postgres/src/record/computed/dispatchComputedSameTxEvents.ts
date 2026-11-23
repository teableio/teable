import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  generateUuid,
  NoopSameTxProjectionDispatcher,
  sameTxTargetsForEvent,
  type DomainError,
  type IDomainEvent,
  type IExecutionContext,
  type ISameTxProjectionDispatcher,
  type Table,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

/**
 * Dispatches synchronous transactional projections (such as the Base VCS change log)
 * for computed record update events emitted inside an active PostgreSQL data transaction.
 */
export async function dispatchComputedSameTxEvents(
  context: IExecutionContext,
  dispatcher: ISameTxProjectionDispatcher | undefined,
  events: ReadonlyArray<IDomainEvent>
): Promise<Result<void, DomainError>> {
  if (!dispatcher || dispatcher instanceof NoopSameTxProjectionDispatcher || events.length === 0) {
    return ok(undefined);
  }
  if (!getPostgresTransaction(context, 'data')) {
    return ok(undefined);
  }

  const tables = new Map<string, Table>();
  const historyRowBudget = { remaining: 200 };
  for (const event of events) {
    const targets = sameTxTargetsForEvent(event);
    if (targets.length === 0) {
      continue;
    }
    const res = await dispatcher.dispatch(
      {
        ...context,
        sameTxProjection: {
          eventId: generateUuid(),
          tables,
          historyRowBudget,
        },
      },
      event,
      targets
    );
    if (res.isErr()) {
      return err(res.error);
    }
  }

  return ok(undefined);
}
