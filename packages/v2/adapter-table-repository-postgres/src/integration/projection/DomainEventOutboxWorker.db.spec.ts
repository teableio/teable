import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ProjectionMessageCodecRegistry,
  recordProjectionCodecs,
  v2CoreTokens,
  type IDurableProjectionContext,
  type IDurableProjectionHandler,
  type ILogger,
  type ProjectionDeliveryError,
  type ProjectionDeliveryOutcome,
  type ProjectionMessageJson,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely, type Transaction } from 'kysely';
import { err, ok, type Result } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainEventOutboxWorker } from '../../projection/DomainEventOutboxWorker';
import {
  RECORD_VALIDATION_CONSUMER_ID,
  ValidationInboxDurableProjection,
} from '../../projection/ValidationInboxDurableProjection';
import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

const MESSAGE_NAME = 'table.record.created.v1';
const SECOND_CONSUMER_ID = 'record.test.second.v1';

type ClaimIdentity = Readonly<{
  consumerId: string;
  messageName: string;
  schemaVersion: number;
}>;

const newId = (prefix: string) => `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

const createdClaim = (consumerId: string): ClaimIdentity => ({
  consumerId,
  messageName: MESSAGE_NAME,
  schemaVersion: 1,
});

const codecRegistry = () => {
  const codecs = ProjectionMessageCodecRegistry.create(recordProjectionCodecs);
  expect(codecs.isOk()).toBe(true);
  return codecs._unsafeUnwrap();
};

const createWorker = (
  db: Kysely<V1TeableDatabase>,
  handlers: ReadonlyMap<string, IDurableProjectionHandler<ProjectionMessageJson>>,
  claimIdentities: ReadonlyArray<ClaimIdentity>,
  schema?: string
) =>
  new DomainEventOutboxWorker(
    db,
    handlers,
    codecRegistry(),
    getV2NodeTestContainer().container.resolve<ILogger>(v2CoreTokens.logger),
    schema,
    claimIdentities
  );

const insertOutbox = async (
  db: Kysely<V1TeableDatabase>,
  input: {
    eventId: string;
    consumers: ReadonlyArray<string>;
    unpublished?: boolean;
    settled?: 'succeeded' | 'partial_failed' | null;
    createdDaysAgo?: number;
    settledDaysAgo?: number | null;
  }
) => {
  const { baseId } = getV2NodeTestContainer();
  await db
    .insertInto('domain_event_outbox')
    .values({
      id: input.eventId,
      base_id: baseId.toString(),
      table_id: null,
      message_name: MESSAGE_NAME,
      schema_version: 1,
      aggregate_id: input.eventId,
      payload: sql`${JSON.stringify({ recordId: input.eventId })}::jsonb`,
      payload_bytes: 2,
      catalog_generation: 1,
      required_consumers: sql`${JSON.stringify(input.consumers)}::jsonb`,
      unpublished: input.unpublished ?? false,
      settled: input.settled ?? null,
      created_at: sql`now() - (${input.createdDaysAgo ?? 0} * interval '1 day')`,
      settled_at:
        input.settledDaysAgo == null
          ? null
          : sql`now() - (${input.settledDaysAgo} * interval '1 day')`,
    } as never)
    .execute();
};

const insertDelivery = async (
  db: Kysely<V1TeableDatabase>,
  input: {
    eventId: string;
    consumerId: string;
    maxAttempts?: number;
    status?: string;
    attempts?: number;
  }
) => {
  const deliveryId = newId('dlv');
  await db
    .insertInto('domain_event_delivery')
    .values({
      id: deliveryId,
      event_id: input.eventId,
      consumer_id: input.consumerId,
      status: input.status ?? 'pending',
      attempts: input.attempts ?? 0,
      max_attempts: input.maxAttempts ?? 12,
    })
    .execute();
  return deliveryId;
};

const loadDelivery = async (db: Kysely<V1TeableDatabase>, eventId: string, consumerId: string) =>
  db
    .selectFrom('domain_event_delivery')
    .selectAll()
    .where('event_id', '=', eventId)
    .where('consumer_id', '=', consumerId)
    .executeTakeFirstOrThrow();

const loadOutbox = async (db: Kysely<V1TeableDatabase>, eventId: string) =>
  db
    .selectFrom('domain_event_outbox')
    .selectAll()
    .where('id', '=', eventId)
    .executeTakeFirstOrThrow();

const insertFamily = async (
  db: Kysely<V1TeableDatabase>,
  input: Omit<Parameters<typeof insertOutbox>[1], 'consumers'>
) => {
  const consumers = [RECORD_VALIDATION_CONSUMER_ID, SECOND_CONSUMER_ID];
  await insertOutbox(db, { ...input, consumers });
  for (const consumerId of consumers) {
    await insertDelivery(db, { eventId: input.eventId, consumerId, status: 'succeeded' });
    await db
      .insertInto('domain_event_inbox')
      .values({ event_id: input.eventId, consumer_id: consumerId })
      .execute();
  }
};

const expectFamily = async (db: Kysely<V1TeableDatabase>, eventId: string, present: boolean) => {
  const outbox = await db
    .selectFrom('domain_event_outbox')
    .select('id')
    .where('id', '=', eventId)
    .execute();
  const deliveries = await db
    .selectFrom('domain_event_delivery')
    .select('id')
    .where('event_id', '=', eventId)
    .execute();
  const inbox = await db
    .selectFrom('domain_event_inbox')
    .select('consumer_id')
    .where('event_id', '=', eventId)
    .execute();
  expect(outbox).toHaveLength(present ? 1 : 0);
  expect(deliveries).toHaveLength(present ? 2 : 0);
  expect(inbox).toHaveLength(present ? 2 : 0);
};

// Set-based fixtures keep batch-boundary cases cheap under both PostgreSQL and PGlite.
const insertBatch = async (
  db: Kysely<V1TeableDatabase>,
  prefix: string,
  count: number,
  kind: 'unsettled' | 'pending' | 'modern' | 'legacy'
) => {
  const settled = kind === 'modern' || kind === 'legacy' ? 'succeeded' : null;
  await sql`
    INSERT INTO domain_event_outbox (
      id, base_id, message_name, schema_version, payload, payload_bytes,
      catalog_generation, required_consumers, unpublished, settled, created_at, settled_at
    )
    SELECT ${prefix} || n, ${getV2NodeTestContainer().baseId.toString()}, ${MESSAGE_NAME},
      1, '{}'::jsonb, 2, 1, '[]'::jsonb, false, ${settled},
      now() - interval '16 days',
      CASE WHEN ${kind} = 'modern' THEN now() - interval '16 days' ELSE NULL END
    FROM generate_series(1, ${count}::integer) n
  `.execute(db);
  await sql`
    INSERT INTO domain_event_delivery (id, event_id, consumer_id, status)
    SELECT ${prefix} || 'delivery' || n, ${prefix} || n, ${RECORD_VALIDATION_CONSUMER_ID},
      ${kind === 'pending' ? 'pending' : 'succeeded'}
    FROM generate_series(1, ${count}::integer) n
  `.execute(db);
  await sql`
    INSERT INTO domain_event_inbox (consumer_id, event_id)
    SELECT ${RECORD_VALIDATION_CONSUMER_ID}, ${prefix} || n
    FROM generate_series(1, ${count}::integer) n
  `.execute(db);
};

const withSeparateTransaction = async (
  action: (transaction: Transaction<V1TeableDatabase>) => Promise<void>
) => {
  const { connectionString } = getV2NodeTestContainer();
  const other = await createV2PostgresDb<V1TeableDatabase>({ pg: { connectionString } });
  try {
    await other.transaction().execute(action);
  } finally {
    await other.destroy();
  }
};

const appliedInbox = (
  consumerId: string
): Result<ProjectionDeliveryOutcome, ProjectionDeliveryError> =>
  ok({
    kind: 'applied',
    effectReceipt: { kind: 'destination-inbox', identity: consumerId },
  });

class RetryableHandler implements IDurableProjectionHandler<ProjectionMessageJson> {
  calls = 0;

  constructor(readonly consumerId = RECORD_VALIDATION_CONSUMER_ID) {}

  async handle(): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>> {
    this.calls += 1;
    return err({
      code: 'test.retryable',
      retryability: 'retryable',
      message: 'transient failure',
    });
  }
}

class InboxMissingHandler implements IDurableProjectionHandler<ProjectionMessageJson> {
  readonly consumerId = RECORD_VALIDATION_CONSUMER_ID;
  calls = 0;

  async handle(): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>> {
    this.calls += 1;
    return appliedInbox(this.consumerId);
  }
}

class CountingInboxHandler implements IDurableProjectionHandler<ProjectionMessageJson> {
  readonly consumerId: string;
  calls = 0;

  constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    consumerId = RECORD_VALIDATION_CONSUMER_ID
  ) {
    this.consumerId = consumerId;
  }

  async handle(
    context: IDurableProjectionContext
  ): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>> {
    this.calls += 1;
    await this.db
      .insertInto('domain_event_inbox')
      .values({
        consumer_id: this.consumerId,
        event_id: context.eventId,
      })
      .execute();
    return appliedInbox(this.consumerId);
  }
}

describe('DomainEventOutboxWorker (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it('releases a retryable failure with incremented attempts, cleared lease, and future next_attempt_at', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, { eventId, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });
    const handler = new RetryableHandler();
    const worker = createWorker(db, new Map([[handler.consumerId, handler]]), [
      createdClaim(RECORD_VALIDATION_CONSUMER_ID),
    ]);
    const before = Date.now();

    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);
    expect(handler.calls).toBe(1);

    const delivery = await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID);
    expect(delivery.status).toBe('pending');
    expect(delivery.attempts).toBe(1);
    expect(delivery.lease_token).toBeNull();
    expect(delivery.lease_expires_at).toBeNull();
    expect(delivery.last_error).toBe('transient failure');
    expect(new Date(delivery.next_attempt_at).getTime()).toBeGreaterThan(before);
    expect((await loadOutbox(db, eventId)).settled).toBeNull();
  });

  it('dead-letters a delivery after max attempts and settles the outbox as dead', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, { eventId, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, {
      eventId,
      consumerId: RECORD_VALIDATION_CONSUMER_ID,
      maxAttempts: 1,
    });
    const handler = new RetryableHandler();
    const worker = createWorker(db, new Map([[handler.consumerId, handler]]), [
      createdClaim(RECORD_VALIDATION_CONSUMER_ID),
    ]);

    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);

    const delivery = await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID);
    expect(delivery.status).toBe('dead');
    expect(delivery.attempts).toBe(1);
    expect(delivery.lease_token).toBeNull();
    expect((await loadOutbox(db, eventId)).settled).toBe('partial_failed');
  });

  it('dead-letters destination-inbox handlers that return applied without an inbox row', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, { eventId, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });
    const handler = new InboxMissingHandler();
    const worker = createWorker(db, new Map([[handler.consumerId, handler]]), [
      createdClaim(RECORD_VALIDATION_CONSUMER_ID),
    ]);

    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);
    expect(handler.calls).toBe(1);

    const delivery = await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID);
    expect(delivery.status).toBe('dead');
    expect(delivery.last_error).toContain('inbox receipt');
    expect((await loadOutbox(db, eventId)).settled).toBe('partial_failed');
  });

  it('does not settle the outbox until every consumer delivery is terminal', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, {
      eventId,
      consumers: [RECORD_VALIDATION_CONSUMER_ID, SECOND_CONSUMER_ID],
    });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });
    await insertDelivery(db, { eventId, consumerId: SECOND_CONSUMER_ID });
    const first = new CountingInboxHandler(db);
    const second = new RetryableHandler(SECOND_CONSUMER_ID);
    const worker = createWorker(
      db,
      new Map<string, IDurableProjectionHandler<ProjectionMessageJson>>([
        [first.consumerId, first],
        [second.consumerId, second],
      ]),
      [createdClaim(RECORD_VALIDATION_CONSUMER_ID), createdClaim(SECOND_CONSUMER_ID)]
    );

    const firstPoll = await worker.pollOnce();
    expect(firstPoll.isOk()).toBe(true);
    expect((await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID)).status).toBe(
      'succeeded'
    );
    expect((await loadDelivery(db, eventId, SECOND_CONSUMER_ID)).status).toBe('pending');
    expect((await loadOutbox(db, eventId)).settled).toBeNull();

    await db
      .updateTable('domain_event_delivery')
      .set({
        max_attempts: 1,
        next_attempt_at: new Date(Date.now() - 1_000),
      })
      .where('event_id', '=', eventId)
      .where('consumer_id', '=', SECOND_CONSUMER_ID)
      .execute();

    const secondPoll = await worker.pollOnce();
    expect(secondPoll.isOk()).toBe(true);
    expect((await loadDelivery(db, eventId, SECOND_CONSUMER_ID)).status).toBe('dead');
    expect((await loadOutbox(db, eventId)).settled).toBe('partial_failed');
  });

  it('settles the outbox as succeeded only after every consumer succeeds', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, {
      eventId,
      consumers: [RECORD_VALIDATION_CONSUMER_ID, SECOND_CONSUMER_ID],
    });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });
    await insertDelivery(db, { eventId, consumerId: SECOND_CONSUMER_ID });
    const first = new CountingInboxHandler(db);
    const second = new CountingInboxHandler(db, SECOND_CONSUMER_ID);
    const worker = createWorker(
      db,
      new Map<string, IDurableProjectionHandler<ProjectionMessageJson>>([
        [first.consumerId, first],
        [second.consumerId, second],
      ]),
      [createdClaim(RECORD_VALIDATION_CONSUMER_ID), createdClaim(SECOND_CONSUMER_ID)]
    );

    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);
    expect((await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID)).status).toBe(
      'succeeded'
    );
    expect((await loadDelivery(db, eventId, SECOND_CONSUMER_ID)).status).toBe('succeeded');
    expect((await loadOutbox(db, eventId)).settled).toBe('succeeded');
  });

  it('acks an existing inbox without invoking the handler again', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, { eventId, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });
    await db
      .insertInto('domain_event_inbox')
      .values({
        consumer_id: RECORD_VALIDATION_CONSUMER_ID,
        event_id: eventId,
      })
      .execute();
    const handler = new CountingInboxHandler(db);
    const worker = createWorker(db, new Map([[handler.consumerId, handler]]), [
      createdClaim(RECORD_VALIDATION_CONSUMER_ID),
    ]);

    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);
    expect(handler.calls).toBe(0);
    expect((await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID)).status).toBe(
      'succeeded'
    );
  });

  it('reclaims an expired lease and skips side effects when the inbox already exists', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, { eventId, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });

    class ExpireAfterInboxHandler implements IDurableProjectionHandler<ProjectionMessageJson> {
      readonly consumerId = RECORD_VALIDATION_CONSUMER_ID;

      async handle(
        context: IDurableProjectionContext
      ): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>> {
        await db
          .insertInto('domain_event_inbox')
          .values({
            consumer_id: context.consumerId,
            event_id: context.eventId,
          })
          .execute();
        await db
          .updateTable('domain_event_delivery')
          .set({ lease_expires_at: new Date(Date.now() - 1_000) })
          .where('id', '=', context.deliveryId)
          .execute();
        return appliedInbox(this.consumerId);
      }
    }

    const firstWorker = createWorker(
      db,
      new Map([[RECORD_VALIDATION_CONSUMER_ID, new ExpireAfterInboxHandler()]]),
      [createdClaim(RECORD_VALIDATION_CONSUMER_ID)]
    );
    const firstPoll = await firstWorker.pollOnce();
    expect(firstPoll.isOk()).toBe(true);
    expect((await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID)).status).toBe(
      'processing'
    );

    const reclaimHandler = new CountingInboxHandler(db);
    const reclaimWorker = createWorker(db, new Map([[reclaimHandler.consumerId, reclaimHandler]]), [
      createdClaim(RECORD_VALIDATION_CONSUMER_ID),
    ]);
    const reclaimPoll = await reclaimWorker.pollOnce();
    expect(reclaimPoll.isOk()).toBe(true);
    expect(reclaimHandler.calls).toBe(0);
    expect((await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID)).status).toBe(
      'succeeded'
    );
  });

  it('does not let two workers process the same delivery under SKIP LOCKED', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, { eventId, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });
    const handler = new CountingInboxHandler(db);
    const claims = [createdClaim(RECORD_VALIDATION_CONSUMER_ID)];
    const workerA = createWorker(db, new Map([[handler.consumerId, handler]]), claims);
    const workerB = createWorker(db, new Map([[handler.consumerId, handler]]), claims);

    const [first, second] = await Promise.all([workerA.pollOnce(), workerB.pollOnce()]);
    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(handler.calls).toBe(1);
    expect((await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID)).status).toBe(
      'succeeded'
    );
  });

  it('does not let a stale lease token overwrite a newer owner', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, { eventId, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });
    const stolenToken = newId('tok');

    class StealLeaseHandler implements IDurableProjectionHandler<ProjectionMessageJson> {
      readonly consumerId = RECORD_VALIDATION_CONSUMER_ID;

      async handle(
        context: IDurableProjectionContext,
        _message: ProjectionMessageJson
      ): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>> {
        await db
          .updateTable('domain_event_delivery')
          .set({
            lease_token: stolenToken,
            lease_expires_at: new Date(Date.now() + 30_000),
          })
          .where('id', '=', context.deliveryId)
          .execute();
        await db
          .insertInto('domain_event_inbox')
          .values({
            consumer_id: context.consumerId,
            event_id: context.eventId,
          })
          .execute();
        return appliedInbox(this.consumerId);
      }
    }

    const worker = createWorker(
      db,
      new Map([[RECORD_VALIDATION_CONSUMER_ID, new StealLeaseHandler()]]),
      [createdClaim(RECORD_VALIDATION_CONSUMER_ID)]
    );
    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);

    const delivery = await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID);
    expect(delivery.status).toBe('processing');
    expect(delivery.lease_token).toBe(stolenToken);
    expect(delivery.status).not.toBe('succeeded');
  });

  it('uses the production validation handler to settle a delivery', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, { eventId, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });
    const handler = new ValidationInboxDurableProjection(db);
    const worker = createWorker(db, new Map([[handler.consumerId, handler]]), [
      createdClaim(RECORD_VALIDATION_CONSUMER_ID),
    ]);

    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);
    expect((await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID)).status).toBe(
      'succeeded'
    );
    const inbox = await db
      .selectFrom('domain_event_inbox')
      .selectAll()
      .where('event_id', '=', eventId)
      .execute();
    expect(inbox).toHaveLength(1);
  });

  it('settles a still-valid lease when the process clock is eight hours ahead of the database', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, { eventId, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });
    const handler = new ValidationInboxDurableProjection(db);
    const worker = createWorker(db, new Map([[handler.consumerId, handler]]), [
      createdClaim(RECORD_VALIDATION_CONSUMER_ID),
    ]);
    const realNow = Date.now.bind(Date);
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 8 * 60 * 60 * 1000);
    try {
      const poll = await worker.pollOnce();
      expect(poll.isOk()).toBe(true);
      expect(poll.isOk() ? poll.value : null).toBe(1);
      expect((await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID)).status).toBe(
        'succeeded'
      );
      const inbox = await db
        .selectFrom('domain_event_inbox')
        .selectAll()
        .where('event_id', '=', eventId)
        .execute();
      expect(inbox).toHaveLength(1);
      expect((await loadOutbox(db, eventId)).settled).toBe('succeeded');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('releases a throwing handler as retryable pending without aborting the poll', async () => {
    const { db } = getV2NodeTestContainer();
    const eventId = newId('deo');
    await insertOutbox(db, { eventId, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, { eventId, consumerId: RECORD_VALIDATION_CONSUMER_ID });

    class ThrowHandler implements IDurableProjectionHandler<ProjectionMessageJson> {
      readonly consumerId = RECORD_VALIDATION_CONSUMER_ID;

      async handle(): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>> {
        throw new Error('boom');
      }
    }

    const worker = createWorker(
      db,
      new Map([[RECORD_VALIDATION_CONSUMER_ID, new ThrowHandler()]]),
      [createdClaim(RECORD_VALIDATION_CONSUMER_ID)]
    );
    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);
    const delivery = await loadDelivery(db, eventId, RECORD_VALIDATION_CONSUMER_ID);
    expect(delivery.status).toBe('pending');
    expect(delivery.last_error).toBe('boom');
    expect(delivery.attempts).toBe(1);
  });

  it('delivers and settles due work without reconciling or purging unrelated history', async () => {
    const { db } = getV2NodeTestContainer();
    const expired = newId('expired');
    const orphan = newId('orphan');
    const due = newId('due');
    await insertFamily(db, {
      eventId: expired,
      settled: 'succeeded',
      createdDaysAgo: 16,
      settledDaysAgo: 16,
    });
    await insertFamily(db, { eventId: orphan });
    await insertOutbox(db, { eventId: due, consumers: [RECORD_VALIDATION_CONSUMER_ID] });
    await insertDelivery(db, { eventId: due, consumerId: RECORD_VALIDATION_CONSUMER_ID });
    const handler = new CountingInboxHandler(db);
    const worker = createWorker(db, new Map([[handler.consumerId, handler]]), [
      createdClaim(handler.consumerId),
    ]);

    expect((await worker.pollOnce())._unsafeUnwrap()).toBe(1);
    expect(handler.calls).toBe(1);
    expect((await loadOutbox(db, due)).settled).toBe('succeeded');
    expect((await loadDelivery(db, due, handler.consumerId)).status).toBe('succeeded');
    await expectFamily(db, expired, true);
    await expectFamily(db, orphan, true);
    expect((await loadOutbox(db, orphan)).settled).toBeNull();
    expect((await worker.pollOnce())._unsafeUnwrap()).toBe(0);
    await expectFamily(db, expired, true);
    expect((await loadOutbox(db, orphan)).settled).toBeNull();

    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 1, purged: 1 });
    await expectFamily(db, expired, false);
    expect((await loadOutbox(db, orphan)).settled).toBe('succeeded');
  });

  it('reconciles only published all-terminal families without starving behind nonterminal rows', async () => {
    const { db } = getV2NodeTestContainer();
    // These IDs sort before all eligible IDs and exceed the reconciliation batch size.
    await insertBatch(db, 'a-pending-', 1001, 'pending');
    const succeeded = 'z-succeeded';
    const partial = 'z-partial';
    const processing = 'z-processing';
    const unpublished = 'z-unpublished';
    const empty = 'z-empty';
    for (const eventId of [succeeded, partial, processing, unpublished, empty]) {
      await insertOutbox(db, {
        eventId,
        consumers: [RECORD_VALIDATION_CONSUMER_ID, SECOND_CONSUMER_ID],
        unpublished: eventId === unpublished,
        settledDaysAgo: eventId === succeeded ? 1 : null,
      });
      if (eventId === empty) continue;
      await insertDelivery(db, {
        eventId,
        consumerId: RECORD_VALIDATION_CONSUMER_ID,
        status: 'succeeded',
      });
      await insertDelivery(db, {
        eventId,
        consumerId: SECOND_CONSUMER_ID,
        status: eventId === partial ? 'dead' : eventId === processing ? 'processing' : 'cancelled',
      });
    }
    const preserved = (await loadOutbox(db, succeeded)).settled_at;
    const worker = createWorker(db, new Map(), []);

    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 2, purged: 0 });
    expect((await loadOutbox(db, succeeded)).settled).toBe('succeeded');
    expect((await loadOutbox(db, succeeded)).settled_at).toEqual(preserved);
    expect((await loadOutbox(db, partial)).settled).toBe('partial_failed');
    expect((await loadOutbox(db, partial)).settled_at).not.toBeNull();
    for (const eventId of [processing, unpublished, empty]) {
      expect((await loadOutbox(db, eventId)).settled).toBeNull();
    }
    const pending = await db
      .selectFrom('domain_event_outbox')
      .select('settled')
      .where('id', 'like', 'a-pending-%')
      .execute();
    expect(pending).toHaveLength(1001);
    expect(pending.every((row) => row.settled === null)).toBe(true);
  });

  it('purges expired modern and legacy families but retains recent settlements and unsettled events', async () => {
    const { db } = getV2NodeTestContainer();
    const expiredModern = newId('modern');
    const expiredLegacy = newId('legacy');
    const recentSettlement = newId('recent');
    const recentLegacy = newId('recentLegacy');
    const unsettled = newId('unsettled');
    await insertFamily(db, {
      eventId: expiredModern,
      settled: 'succeeded',
      createdDaysAgo: 16,
      settledDaysAgo: 16,
    });
    await insertFamily(db, {
      eventId: expiredLegacy,
      settled: 'partial_failed',
      createdDaysAgo: 16,
    });
    await insertFamily(db, {
      eventId: recentSettlement,
      settled: 'partial_failed',
      createdDaysAgo: 16,
      settledDaysAgo: 1,
    });
    await insertFamily(db, {
      eventId: recentLegacy,
      settled: 'succeeded',
      createdDaysAgo: 13,
    });
    await insertFamily(db, { eventId: unsettled, createdDaysAgo: 16 });
    await db
      .updateTable('domain_event_delivery')
      .set({ status: 'pending' })
      .where('event_id', '=', unsettled)
      .where('consumer_id', '=', SECOND_CONSUMER_ID)
      .execute();
    const worker = createWorker(db, new Map(), []);

    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 0, purged: 2 });
    for (const eventId of [expiredModern, expiredLegacy]) await expectFamily(db, eventId, false);
    for (const eventId of [recentSettlement, recentLegacy, unsettled]) {
      await expectFamily(db, eventId, true);
    }
    expect((await loadOutbox(db, unsettled)).settled).toBeNull();
    expect((await loadOutbox(db, recentLegacy)).settled_at).toBeNull();
  });

  it('retains modern and legacy families exactly at the transaction retention cutoff', async () => {
    const { db } = getV2NodeTestContainer();
    const modern = newId('cutoffModern');
    const legacy = newId('cutoffLegacy');
    const transaction = db.transaction();
    // Seed inside the worker's actual transaction so PostgreSQL now() is identical for both.
    const transactionSpy = vi.spyOn(db, 'transaction').mockReturnValue({
      execute: (callback: (executor: Transaction<V1TeableDatabase>) => Promise<unknown>) =>
        transaction.execute(async (executor) => {
          await insertFamily(executor, {
            eventId: modern,
            settled: 'succeeded',
            createdDaysAgo: 16,
            settledDaysAgo: 14,
          });
          await insertFamily(executor, {
            eventId: legacy,
            settled: 'partial_failed',
            createdDaysAgo: 14,
          });
          return callback(executor);
        }),
    } as never);
    try {
      const worker = createWorker(db, new Map(), []);
      expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 0, purged: 0 });
    } finally {
      transactionSpy.mockRestore();
    }
    await expectFamily(db, modern, true);
    await expectFamily(db, legacy, true);
  });

  it('reconciles at most 1000 eligible events per maintenance admission', async () => {
    const { db } = getV2NodeTestContainer();
    await insertBatch(db, 'reconcile-', 1001, 'unsettled');
    const worker = createWorker(db, new Map(), []);
    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 1000, purged: 0 });
    const remaining = await db
      .selectFrom('domain_event_outbox')
      .select('id')
      .where('settled', 'is', null)
      .execute();
    expect(remaining).toHaveLength(1);
    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 1, purged: 0 });
    const settled = await db.selectFrom('domain_event_outbox').select('settled').execute();
    expect(settled).toHaveLength(1001);
    expect(settled.every((row) => row.settled === 'succeeded')).toBe(true);
  });

  it('shares one 1000-event purge budget across modern and legacy candidates', async () => {
    const { db } = getV2NodeTestContainer();
    await insertBatch(db, 'modern-', 600, 'modern');
    await insertBatch(db, 'legacy-', 600, 'legacy');
    const retained = newId('retained');
    await insertFamily(db, { eventId: retained, settled: 'succeeded', settledDaysAgo: 1 });
    const worker = createWorker(db, new Map(), []);
    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 0, purged: 1000 });
    const survivors = await db
      .selectFrom('domain_event_outbox')
      .select('id')
      .where('id', '!=', retained)
      .execute();
    expect(survivors).toHaveLength(200);
    const deliveries = await db
      .selectFrom('domain_event_delivery')
      .select('event_id')
      .where('event_id', '!=', retained)
      .execute();
    const inbox = await db
      .selectFrom('domain_event_inbox')
      .select('event_id')
      .where('event_id', '!=', retained)
      .execute();
    const survivingIds = survivors.map((row) => row.id).sort();
    expect(deliveries.map((row) => row.event_id).sort()).toEqual(survivingIds);
    expect(inbox.map((row) => row.event_id).sort()).toEqual(survivingIds);
    await expectFamily(db, retained, true);
    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 0, purged: 200 });
    expect(await db.selectFrom('domain_event_outbox').select('id').execute()).toEqual([
      { id: retained },
    ]);
    expect(await db.selectFrom('domain_event_delivery').select('event_id').execute()).toEqual([
      { event_id: retained },
      { event_id: retained },
    ]);
    expect(await db.selectFrom('domain_event_inbox').select('event_id').execute()).toEqual([
      { event_id: retained },
      { event_id: retained },
    ]);
  });

  it('skips maintenance while another transaction holds its advisory lock', async (context) => {
    const { db, connectionString } = getV2NodeTestContainer();
    if (!/^postgres(?:ql)?:/.test(connectionString)) {
      context.skip();
      return;
    }
    const orphan = newId('orphan');
    const expired = newId('expired');
    await insertFamily(db, { eventId: orphan });
    await insertFamily(db, { eventId: expired, settled: 'succeeded', settledDaysAgo: 16 });
    const worker = createWorker(db, new Map(), []);

    await withSeparateTransaction(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('domain-event-maintenance:public'))`.execute(
        transaction
      );
      expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 0, purged: 0 });
      expect((await loadOutbox(db, orphan)).settled).toBeNull();
      await expectFamily(db, expired, true);
    });
    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 1, purged: 1 });
    expect((await loadOutbox(db, orphan)).settled).toBe('succeeded');
    await expectFamily(db, expired, false);
  });

  it('skips locked parent rows without deleting their children or blocking unlocked progress', async (context) => {
    const { db, connectionString } = getV2NodeTestContainer();
    if (!/^postgres(?:ql)?:/.test(connectionString)) {
      context.skip();
      return;
    }
    const lockedExpired = newId('lockedExpired');
    const unlockedExpired = newId('unlockedExpired');
    const lockedOrphan = newId('lockedOrphan');
    const unlockedOrphan = newId('unlockedOrphan');
    for (const eventId of [lockedExpired, unlockedExpired]) {
      await insertFamily(db, { eventId, settled: 'succeeded', settledDaysAgo: 16 });
    }
    for (const eventId of [lockedOrphan, unlockedOrphan]) await insertFamily(db, { eventId });
    const worker = createWorker(db, new Map(), []);

    await withSeparateTransaction(async (transaction) => {
      await transaction
        .selectFrom('domain_event_outbox')
        .select('id')
        .where('id', 'in', [lockedExpired, lockedOrphan])
        .forUpdate()
        .execute();
      expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 1, purged: 1 });
      await expectFamily(db, lockedExpired, true);
      await expectFamily(db, unlockedExpired, false);
      expect((await loadOutbox(db, lockedOrphan)).settled).toBeNull();
      expect((await loadOutbox(db, unlockedOrphan)).settled).toBe('succeeded');
    });
    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 1, purged: 1 });
    await expectFamily(db, lockedExpired, false);
    expect((await loadOutbox(db, lockedOrphan)).settled).toBe('succeeded');
  });

  it.for(['modern', 'legacy'] as const)(
    'purges later unlocked families past a full locked %s candidate batch',
    async (kind, context) => {
      const { db, connectionString } = getV2NodeTestContainer();
      if (!/^postgres(?:ql)?:/.test(connectionString)) {
        context.skip();
        return;
      }
      const prefix = newId('locked-');
      const lockedIds = Array.from({ length: 1000 }, (_, index) => `${prefix}${index + 1}`).sort();
      await insertBatch(db, prefix, 1000, kind);
      const unlockedModern = newId('unlockedModern');
      const unlockedLegacy = newId('unlockedLegacy');
      await insertFamily(db, {
        eventId: unlockedModern,
        settled: 'succeeded',
        createdDaysAgo: 15,
        settledDaysAgo: 15,
      });
      await insertFamily(db, {
        eventId: unlockedLegacy,
        settled: 'partial_failed',
        createdDaysAgo: 15,
      });
      const worker = createWorker(db, new Map(), []);

      await withSeparateTransaction(async (transaction) => {
        await transaction
          .selectFrom('domain_event_outbox')
          .select('id')
          .where('id', 'in', lockedIds)
          .forUpdate()
          .execute();
        expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 0, purged: 2 });
        await expectFamily(db, unlockedModern, false);
        await expectFamily(db, unlockedLegacy, false);
        const parents = await db.selectFrom('domain_event_outbox').select('id').execute();
        const deliveries = await db
          .selectFrom('domain_event_delivery')
          .select('event_id')
          .execute();
        const inbox = await db.selectFrom('domain_event_inbox').select('event_id').execute();
        expect(parents.map((row) => row.id).sort()).toEqual(lockedIds);
        expect(deliveries.map((row) => row.event_id).sort()).toEqual(lockedIds);
        expect(inbox.map((row) => row.event_id).sort()).toEqual(lockedIds);
      });

      expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({
        reconciled: 0,
        purged: 1000,
      });
      expect(await db.selectFrom('domain_event_outbox').select('id').execute()).toEqual([]);
      expect(await db.selectFrom('domain_event_delivery').select('event_id').execute()).toEqual([]);
      expect(await db.selectFrom('domain_event_inbox').select('event_id').execute()).toEqual([]);
    }
  );

  it('rolls back reconciliation and all purge mutations when inbox deletion fails', async () => {
    const { db } = getV2NodeTestContainer();
    const orphan = newId('orphan');
    const expired = newId('expired');
    await insertFamily(db, { eventId: orphan });
    await insertFamily(db, { eventId: expired, settled: 'succeeded', settledDaysAgo: 16 });
    const worker = createWorker(db, new Map(), []);
    const trigger = newId('reject_delete_');
    await sql`
      CREATE FUNCTION ${sql.id(trigger)}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture inbox delete failure'; END;
      $$
    `.execute(db);
    try {
      await sql`
        CREATE TRIGGER ${sql.id(trigger)} BEFORE DELETE ON domain_event_inbox
        FOR EACH ROW EXECUTE FUNCTION ${sql.id(trigger)}()
      `.execute(db);
      const failed = await worker.maintainOnce();
      expect(failed.isErr()).toBe(true);
      expect(failed._unsafeUnwrapErr().code).toBe('domain_event.purge_failed');
      expect((await loadOutbox(db, orphan)).settled).toBeNull();
      expect((await loadOutbox(db, orphan)).settled_at).toBeNull();
      await expectFamily(db, orphan, true);
      await expectFamily(db, expired, true);
    } finally {
      await sql`DROP TRIGGER IF EXISTS ${sql.id(trigger)} ON domain_event_inbox`.execute(db);
      await sql`DROP FUNCTION ${sql.id(trigger)}()`.execute(db);
    }
    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 1, purged: 1 });
    expect((await loadOutbox(db, orphan)).settled).toBe('succeeded');
    await expectFamily(db, expired, false);
  });

  it('cancels over-budget PostgreSQL maintenance and rolls back both phases', async (context) => {
    const { db, connectionString } = getV2NodeTestContainer();
    if (!/^postgres(?:ql)?:/.test(connectionString)) {
      context.skip();
      return;
    }
    const orphan = newId('orphan');
    const expired = newId('expired');
    await insertFamily(db, { eventId: orphan });
    await insertFamily(db, { eventId: expired, settled: 'succeeded', settledDaysAgo: 16 });
    const worker = createWorker(db, new Map(), []);
    const trigger = newId('slow_delete_');
    await sql`
      CREATE FUNCTION ${sql.id(trigger)}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(6);
        RETURN OLD;
      END;
      $$
    `.execute(db);
    try {
      await sql`
        CREATE TRIGGER ${sql.id(trigger)} BEFORE DELETE ON domain_event_inbox
        FOR EACH ROW EXECUTE FUNCTION ${sql.id(trigger)}()
      `.execute(db);
      const failed = await worker.maintainOnce();
      expect(failed.isErr()).toBe(true);
      expect(failed._unsafeUnwrapErr().code).toBe('domain_event.purge_failed');
      expect((await loadOutbox(db, orphan)).settled).toBeNull();
      expect((await loadOutbox(db, orphan)).settled_at).toBeNull();
      await expectFamily(db, orphan, true);
      await expectFamily(db, expired, true);
    } finally {
      await sql`DROP TRIGGER IF EXISTS ${sql.id(trigger)} ON domain_event_inbox`.execute(db);
      await sql`DROP FUNCTION ${sql.id(trigger)}()`.execute(db);
    }
    expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 1, purged: 1 });
    expect((await loadOutbox(db, orphan)).settled).toBe('succeeded');
    await expectFamily(db, expired, false);
  });

  it('maintains only the explicitly selected schema when event IDs overlap', async () => {
    const { db } = getV2NodeTestContainer();
    const selected = newId('selected_');
    const untouched = newId('untouched_');
    const expired = newId('expired');
    const orphan = newId('orphan');
    const schemas = [selected, untouched];
    try {
      for (const schema of schemas) {
        await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(db);
        for (const table of [
          'domain_event_outbox',
          'domain_event_delivery',
          'domain_event_inbox',
        ]) {
          await sql`
            CREATE TABLE ${sql.id(schema, table)} (LIKE ${sql.id('public', table)} INCLUDING ALL)
          `.execute(db);
        }
        const scoped = db.withSchema(schema);
        await insertFamily(scoped, {
          eventId: expired,
          settled: 'succeeded',
          createdDaysAgo: schema === selected ? 16 : 18,
          settledDaysAgo: schema === selected ? 16 : 18,
        });
        await insertFamily(scoped, {
          eventId: orphan,
          createdDaysAgo: schema === selected ? 1 : 2,
        });
      }
      const otherDb = db.withSchema(untouched);
      const beforeExpired = await loadOutbox(otherDb, expired);
      const beforeOrphan = await loadOutbox(otherDb, orphan);
      const worker = createWorker(db, new Map(), [], selected);
      expect((await worker.maintainOnce())._unsafeUnwrap()).toEqual({ reconciled: 1, purged: 1 });
      await expectFamily(db.withSchema(selected), expired, false);
      expect((await loadOutbox(db.withSchema(selected), orphan)).settled).toBe('succeeded');
      await expectFamily(otherDb, expired, true);
      await expectFamily(otherDb, orphan, true);
      expect(await loadOutbox(otherDb, expired)).toEqual(beforeExpired);
      expect(await loadOutbox(otherDb, orphan)).toEqual(beforeOrphan);
    } finally {
      for (const schema of schemas) {
        await sql`DROP SCHEMA IF EXISTS ${sql.id(schema)} CASCADE`.execute(db);
      }
    }
  });

  it('creates valid maintenance access paths in the runtime meta schema', async () => {
    const { db } = getV2NodeTestContainer();
    const indexes = await sql<{
      name: string;
      valid: boolean;
      columns: string[];
      predicate: string | null;
    }>`
      SELECT index_class.relname AS name, index.indisvalid AS valid,
        ARRAY(
          SELECT attribute.attname::text
          FROM unnest(index.indkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute attribute
            ON attribute.attrelid = index.indrelid AND attribute.attnum = key.attnum
          ORDER BY key.position
        ) AS columns,
        pg_get_expr(index.indpred, index.indrelid) AS predicate
      FROM pg_index index
      JOIN pg_class index_class ON index_class.oid = index.indexrelid
      JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
      WHERE namespace.nspname = 'public'
        AND index_class.relname IN (
          'domain_event_outbox_unsettled_idx',
          'domain_event_outbox_legacy_settled_created_at_idx',
          'domain_event_inbox_event_id_idx'
        )
      ORDER BY index_class.relname
    `.execute(db);
    expect(indexes.rows).toEqual([
      {
        name: 'domain_event_inbox_event_id_idx',
        valid: true,
        columns: ['event_id'],
        predicate: null,
      },
      {
        name: 'domain_event_outbox_legacy_settled_created_at_idx',
        valid: true,
        columns: ['created_at'],
        predicate: '((settled IS NOT NULL) AND (settled_at IS NULL))',
      },
      {
        name: 'domain_event_outbox_unsettled_idx',
        valid: true,
        columns: ['id'],
        predicate: '((settled IS NULL) AND (NOT unpublished))',
      },
    ]);
  });
});
