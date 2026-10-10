import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  DomainWriteTransaction,
  ProjectionMessageCodecRegistry,
  RecordCreated,
  RecordId,
  TableId,
  domainError,
  domainWrite,
  recordProjectionCodecs,
  v2CoreTokens,
  type IDurableSubscriptionCatalog,
  type IEventHandler,
  type IExecutionContext,
  type ILogger,
  type ITransactionalProjectionMessageJournal,
  type IUnitOfWork,
  type SameTxProjectionTarget,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

const markerConsumer = 'tx.atomicity.marker';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const createRecordCreated = () =>
  RecordCreated.create({
    tableId: TableId.generate()._unsafeUnwrap(),
    baseId: getV2NodeTestContainer().baseId,
    recordId: RecordId.generate()._unsafeUnwrap(),
    fieldValues: [],
  });

const insertMarker = async (transactionContext: IExecutionContext, eventId: string) => {
  const transaction = getPostgresTransaction<V1TeableDatabase>(transactionContext);
  expect(transaction).not.toBeNull();
  await transaction!
    .insertInto('domain_event_inbox')
    .values({
      consumer_id: markerConsumer,
      event_id: eventId,
    })
    .execute();
};

const countMarkers = async (db: Kysely<V1TeableDatabase>, eventId: string) => {
  const rows = await db
    .selectFrom('domain_event_inbox')
    .selectAll()
    .where('consumer_id', '=', markerConsumer)
    .where('event_id', '=', eventId)
    .execute();
  return rows.length;
};

const countOutbox = async (db: Kysely<V1TeableDatabase>) => {
  const rows = await db.selectFrom('domain_event_outbox').selectAll().execute();
  return rows.length;
};

const codecRegistry = () => {
  const codecs = ProjectionMessageCodecRegistry.create(recordProjectionCodecs);
  expect(codecs.isOk()).toBe(true);
  return codecs._unsafeUnwrap();
};

const noopLegacyDispatcher = {
  dispatch: async () => ({ attemptedTargets: 0, failedTargets: 0, failureCodes: [] }),
};

describe('DomainWriteTransaction (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it('rolls back business writes and writes no outbox when work fails', async () => {
    const { container, db } = getV2NodeTestContainer();
    const transaction = container.resolve<DomainWriteTransaction>(
      v2CoreTokens.domainWriteTransaction
    );
    const markerId = `marker-work-fail-${crypto.randomUUID()}`;

    const result = await transaction.execute(createContext(), async (transactionContext) => {
      await insertMarker(transactionContext, markerId);
      return err(domainError.unexpected({ message: 'injected business write failure' }));
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('injected business write failure');
    expect(await countMarkers(db, markerId)).toBe(0);
    expect(await countOutbox(db)).toBe(0);
  });

  it('rolls back business writes and outbox rows when journal append fails after insert', async () => {
    const { container, db } = getV2NodeTestContainer();
    const realJournal = container.resolve<ITransactionalProjectionMessageJournal>(
      v2CoreTokens.projectionMessageJournal
    );
    let appendedInTransaction = 0;
    const failingJournal: ITransactionalProjectionMessageJournal = {
      append: async (context, messages) => {
        const appended = await realJournal.append(context, messages);
        if (appended.isOk()) {
          appendedInTransaction = messages.length;
        }
        return err(
          domainError.infrastructure({
            code: 'domain_event.append_injected_failure',
            message: 'injected journal append failure',
          })
        );
      },
    };
    const transaction = new DomainWriteTransaction(
      container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork),
      codecRegistry(),
      container.resolve<IDurableSubscriptionCatalog>(v2CoreTokens.durableSubscriptionCatalog),
      failingJournal,
      noopLegacyDispatcher,
      { dispatch: async () => ok(undefined) },
      container.resolve<ILogger>(v2CoreTokens.logger)
    );
    const markerId = `marker-append-fail-${crypto.randomUUID()}`;

    const result = await transaction.execute(createContext(), async (transactionContext) => {
      await insertMarker(transactionContext, markerId);
      return ok(domainWrite.changed({ ok: true }, [createRecordCreated()]));
    });

    expect(appendedInTransaction).toBeGreaterThan(0);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('domain_event.append_injected_failure');
    expect(await countMarkers(db, markerId)).toBe(0);
    expect(await countOutbox(db)).toBe(0);
  });

  it('rolls back business writes when a same-tx projection fails inside the postgres transaction', async () => {
    const { container, db } = getV2NodeTestContainer();
    class FailingSameTxProjection implements IEventHandler<RecordCreated> {
      async handle() {
        return ok(undefined);
      }
    }
    const sameTxTarget: SameTxProjectionTarget = {
      consumerId: 'teable.test.same-tx.fail',
      handler: FailingSameTxProjection,
    };
    const catalog: IDurableSubscriptionCatalog = {
      snapshot: () =>
        ok({
          generation: 1,
          resolve: () =>
            ok({
              messageName: 'table.record.created.v1',
              durableMode: 'active',
              sameTxTargets: [sameTxTarget],
              durableTargets: [
                {
                  consumerId: 'record.validation.v1',
                  consumerGeneration: 1,
                  retry: { maxAttempts: 12, policy: 'exponential-jitter' },
                  ordering: 'none' as const,
                  idempotency: 'destination-inbox' as const,
                  replay: 'safe' as const,
                },
              ],
              directTargets: [],
            }),
        }),
    };
    let journalAppends = 0;
    const transaction = new DomainWriteTransaction(
      container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork),
      codecRegistry(),
      catalog,
      {
        append: async () => {
          journalAppends += 1;
          return ok([]);
        },
      },
      noopLegacyDispatcher,
      {
        dispatch: async (transactionContext) => {
          const postgres = getPostgresTransaction<V1TeableDatabase>(transactionContext);
          expect(postgres).not.toBeNull();
          await postgres!
            .insertInto('domain_event_inbox')
            .values({
              consumer_id: 'same-tx.side-effect',
              event_id: 'same-tx-marker',
            })
            .execute();
          return err(
            domainError.infrastructure({
              code: 'record_history.write_failed',
              message: 'same-tx projection failed',
            })
          );
        },
      },
      container.resolve<ILogger>(v2CoreTokens.logger)
    );
    const markerId = `marker-same-tx-fail-${crypto.randomUUID()}`;

    const result = await transaction.execute(createContext(), async (transactionContext) => {
      await insertMarker(transactionContext, markerId);
      return ok(domainWrite.changed({ ok: true }, [createRecordCreated()]));
    });

    expect(journalAppends).toBe(0);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record_history.write_failed');
    expect(await countMarkers(db, markerId)).toBe(0);
    expect(await countOutbox(db)).toBe(0);
    const sameTxRows = await db
      .selectFrom('domain_event_inbox')
      .selectAll()
      .where('consumer_id', '=', 'same-tx.side-effect')
      .execute();
    expect(sameTxRows).toHaveLength(0);
  });
});
