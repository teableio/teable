import { randomUUID } from 'node:crypto';
import { PostgresUnitOfWork, getPostgresTransaction } from '@teable/v2-adapter-db-postgres-pg';
import {
  PostgresTableSchemaRepository,
  PostgresTransactionalProjectionMessageJournal,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  ActorId,
  BackgroundTaskTracker,
  BaseId,
  DbTableName,
  DomainWriteTransaction,
  FieldName,
  NoopLogger,
  ProjectionMessageCodecRegistry,
  RecordId,
  RecordsBatchUpdated,
  SameTxProjectionDispatcher,
  Table,
  TableName,
  TableId,
  domainWrite,
  ok,
  recordProjectionCodecs,
} from '@teable/v2-core';
import type { DomainError, IExecutionContext, Result } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { V2RecordsBatchUpdatedHistoryProjection } from './v2-record-history.service';

// Required-PG CI owns and officially migrates PRISMA_DATABASE_URL. Local runs must
// still opt in through an owned override; each test keeps random business IDs/schema.
const ownedUrl =
  process.env.RECORD_HISTORY_PG_URL ??
  process.env.RECORD_ACTOR_PG_URL ??
  (process.env.UNIT_POSTGRES_REQUIRED === '1' ? process.env.PRISMA_DATABASE_URL : undefined);
if (process.env.UNIT_POSTGRES_REQUIRED === '1' && !ownedUrl) {
  throw new Error(
    'PRISMA_DATABASE_URL is required for the isolated history atomicity PostgreSQL job'
  );
}
if (ownedUrl) {
  const url = new URL(ownedUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('History atomicity PostgreSQL tests require an owned loopback database');
  }
}

const requireFixtureValue = <T>(step: string, result: Result<T, DomainError>): T => {
  if (result.isErr()) {
    throw new Error(
      `${step}: ${result.error.code}: ${result.error.message}; ${JSON.stringify(result.error.details ?? {})}`,
      {
        cause: result.error,
      }
    );
  }
  return result.value;
};

const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
const businessSchema = `history_atomic_${suffix}`;
const recordIds = Array.from({ length: 205 }, (_unused, index) =>
  requireFixtureValue(`record id ${index}`, RecordId.generate()).toString()
);
const constraintName = `history_injected_${suffix}`;
const baselineActor = { type: 'user' as const, id: 'usr-history-baseline' };
const currentActor = { type: 'appUser' as const, id: 'apu-history-current' };
const executor = 'system';
const operationAttribution = {
  operationId: randomUUID(),
  occurredAt: new Date().toISOString(),
  action: 'table.record.update',
};
const context: IExecutionContext = {
  actorId: requireFixtureValue('executor', ActorId.create(executor)),
  initiator: currentActor,
  operationAttribution,
};

type StoredBusinessRow = {
  recordId: string;
  value: string;
  version: number;
  creatorType: string | null;
  creatorId: string | null;
  modifierType: string | null;
  modifierId: string | null;
};

type StoredSourceMessage = {
  id: string;
  messageName: string;
  schemaVersion: number;
  requiredConsumers: string[];
  unpublished: boolean;
  payload: { updates: Array<{ recordId: string }> };
  attribution: {
    version: number;
    eventId: string;
    operationId: string;
    occurredAt: string;
    context: {
      actorId: string;
      initiator: { type: string; id: string };
      operationAttribution: { operationId: string; occurredAt: string; action?: string };
    };
  };
};

describe.skipIf(!ownedUrl)('required record history PostgreSQL batch atomicity', () => {
  let db: Kysely<V1TeableDatabase>;
  let officialSchema: string;
  let table: Table;
  let fieldId: string;
  let fieldColumn: string;
  let physicalTableName: string;
  let transaction: DomainWriteTransaction;
  let emit: Mock;
  const successfulHistoryInsertRows: number[] = [];

  beforeAll(async () => {
    if (!ownedUrl) throw new Error('An owner-provisioned official schema URL is required');
    officialSchema = new URL(ownedUrl).searchParams.get('schema') ?? 'public';
    db = new Kysely<V1TeableDatabase>({
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: ownedUrl, max: 2 }) }),
      log: (event) => {
        if (event.level !== 'query' || !event.query.sql.startsWith('insert into "record_history"'))
          return;
        // Kysely logs this branch after the actual PostgreSQL INSERT succeeded.
        // Every history row has the same ten scalar/payload columns.
        successfulHistoryInsertRows.push(event.query.parameters.length / 10);
      },
    });
    const historyColumns = await sql<{ name: string }>`
      SELECT attname AS name FROM pg_attribute
      WHERE attrelid = ${`${officialSchema}.record_history`}::regclass
        AND attnum > 0 AND NOT attisdropped AND attname IN ('actor_type', 'actor_id')
    `.execute(db);
    expect(historyColumns.rows.map((row) => row.name).sort()).toEqual(['actor_id', 'actor_type']);
    const outboxColumns = await sql<{ name: string }>`SELECT attname AS name FROM pg_attribute
      WHERE attrelid = ${`${officialSchema}.domain_event_outbox`}::regclass
        AND attnum > 0 AND NOT attisdropped AND attname = 'attribution'`.execute(db);
    expect(outboxColumns.rows.map((row) => row.name)).toEqual(['attribution']);

    const fixtureId = requireFixtureValue('table id', TableId.generate());
    physicalTableName = fixtureId.toString();
    const builder = Table.builder()
      .withId(fixtureId)
      .withBaseId(requireFixtureValue('base id', BaseId.generate()))
      .withDbTableName(
        requireFixtureValue(
          'physical table name',
          DbTableName.rehydrate(`${businessSchema}.${physicalTableName}`)
        )
      )
      .withName(requireFixtureValue('table name', TableName.create('Required history atomicity')));
    builder
      .field()
      .singleLineText()
      .withName(requireFixtureValue('field name', FieldName.create('Value')))
      .done();
    builder.view().defaultGrid().done();
    table = requireFixtureValue('build product table', builder.build());

    // Text-only table creation does not invoke record lookup, computed planning,
    // backfill, or cascade ports. The actual creator owns native columns, the
    // four actor columns/checks, field storage, and view-order schema.
    const schemaRepository = new PostgresTableSchemaRepository(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    requireFixtureValue(
      'provision product schema',
      await schemaRepository.insertMany(context, [table], { skipUndoCaptureSetup: true })
    );
    const field = table.getFields()[0];
    fieldId = field.id().toString();
    fieldColumn = requireFixtureValue(
      'physical field name',
      field.dbFieldName().andThen((name) => name.value())
    );

    emit = vi.fn();
    const history = new V2RecordsBatchUpdatedHistoryProjection(
      { getContainerForTable: vi.fn(), getContainer: vi.fn() } as never,
      { recordHistoryDisabled: false } as never,
      { getById: vi.fn() } as never,
      { emit } as never
    );
    const config = { pg: { connectionString: ownedUrl, schema: officialSchema } };
    const logger = new NoopLogger();
    const codecs = requireFixtureValue(
      'record projection codecs',
      ProjectionMessageCodecRegistry.create(recordProjectionCodecs)
    );
    transaction = new DomainWriteTransaction(
      new PostgresUnitOfWork(db, db, config, config),
      codecs,
      {
        snapshot: () =>
          ok({
            generation: 1,
            resolve: () =>
              ok({
                messageName: 'table.records.batch-updated.v1',
                durableMode: 'active',
                sameTxTargets: [
                  {
                    consumerId: 'teable.host.record-history.records-batch-updated',
                    handler: V2RecordsBatchUpdatedHistoryProjection,
                  },
                ],
                durableTargets: [
                  {
                    consumerId: 'record.audit-log.v1',
                    consumerGeneration: 1,
                    retry: { maxAttempts: 12, policy: 'exponential-jitter' },
                    ordering: 'none',
                    idempotency: 'destination-inbox',
                    replay: 'safe',
                  },
                ],
                directTargets: [],
              }),
          }),
      } as never,
      new PostgresTransactionalProjectionMessageJournal(logger, {
        publish: vi.fn().mockResolvedValue(undefined),
      }),
      { dispatch: async () => ({ attemptedTargets: 0, failedTargets: 0, failureCodes: [] }) },
      new SameTxProjectionDispatcher({ resolve: () => history } as never),
      logger,
      new BackgroundTaskTracker()
    );
  });

  beforeEach(async () => {
    if (!table) return;
    emit.mockClear();
    successfulHistoryInsertRows.length = 0;
    await sql`DELETE FROM ${sql.id(officialSchema, 'record_history')} WHERE table_id = ${table.id().toString()}`.execute(
      db
    );
    await sql`DELETE FROM ${sql.id(officialSchema, 'domain_event_outbox')} WHERE table_id = ${table.id().toString()}`.execute(
      db
    );
    await sql`DELETE FROM ${sql.id(businessSchema, physicalTableName)}`.execute(db);
    await sql`INSERT INTO ${sql.id(businessSchema, physicalTableName)}
      (__id, ${sql.id(fieldColumn)}, __version, __created_by, __last_modified_by,
       __created_by_actor_type, __created_by_actor_id, __last_modified_by_actor_type, __last_modified_by_actor_id)
      VALUES ${sql.join(
        recordIds.map(
          (id) => sql`(${id}, 'before', 1, ${executor}, ${executor},
        ${baselineActor.type}, ${baselineActor.id}, ${baselineActor.type}, ${baselineActor.id})`
        )
      )}
    `.execute(db);
  });

  afterAll(async () => {
    if (!db) return;
    try {
      if (table) {
        await sql`DELETE FROM ${sql.id(officialSchema, 'record_history')} WHERE table_id = ${table.id().toString()}`.execute(
          db
        );
        await sql`DELETE FROM ${sql.id(officialSchema, 'domain_event_outbox')} WHERE table_id = ${table.id().toString()}`.execute(
          db
        );
      }
      await sql`DROP SCHEMA IF EXISTS ${sql.id(businessSchema)} CASCADE`.execute(db);
    } finally {
      await db.destroy();
    }
  });

  const readBusinessRows = async (): Promise<StoredBusinessRow[]> => {
    const result =
      await sql<StoredBusinessRow>`SELECT __id AS "recordId", ${sql.id(fieldColumn)} AS value,
      __version AS version, __created_by_actor_type AS "creatorType", __created_by_actor_id AS "creatorId",
      __last_modified_by_actor_type AS "modifierType", __last_modified_by_actor_id AS "modifierId"
      FROM ${sql.id(businessSchema, physicalTableName)} ORDER BY __id
    `.execute(db);
    return result.rows;
  };

  const readSourceMessages = async (): Promise<StoredSourceMessage[]> => {
    const result = await sql<StoredSourceMessage>`SELECT id, message_name AS "messageName",
      schema_version AS "schemaVersion", required_consumers AS "requiredConsumers", unpublished, payload, attribution
      FROM ${sql.id(officialSchema, 'domain_event_outbox')} WHERE table_id = ${table.id().toString()}`.execute(
      db
    );
    return result.rows;
  };

  const executeUpdate = async (injectConstraint: boolean) =>
    transaction.execute(context, async (txContext) => {
      const pg = getPostgresTransaction<V1TeableDatabase>(txContext);
      if (!pg)
        throw new Error(
          'The production domain transaction must own a real PostgreSQL data transaction'
        );
      await sql`SET LOCAL lock_timeout = '3s'`.execute(pg);
      await sql`SET LOCAL statement_timeout = '15s'`.execute(pg);
      if (injectConstraint) {
        // NOT VALID avoids scanning unrelated owned-schema history. The constraint
        // rejects only our 205th record, so the 200-row first history insert must
        // succeed before the finite second insert aborts. Transaction rollback
        // removes this fault-injection constraint along with the partial effect.
        await sql`ALTER TABLE ${sql.id(officialSchema, 'record_history')}
        ADD CONSTRAINT ${sql.id(constraintName)} CHECK (
          table_id <> ${sql.lit(table.id().toString())} OR record_id <> ${sql.lit(recordIds[204])}
        ) NOT VALID`.execute(pg);
      }
      await sql`UPDATE ${sql.id(businessSchema, physicalTableName)} SET
      ${sql.id(fieldColumn)} = 'after', __version = 2,
      __last_modified_by = ${executor}, __last_modified_time = now(),
      __last_modified_by_actor_type = ${currentActor.type}, __last_modified_by_actor_id = ${currentActor.id}
      WHERE __id IN (${sql.join(recordIds)})`.execute(pg);
      const event = RecordsBatchUpdated.create({
        tableId: table.id(),
        baseId: table.baseId(),
        source: 'user',
        updates: recordIds.map((recordId) => ({
          recordId,
          oldVersion: 1,
          newVersion: 2,
          changes: [{ fieldId, oldValue: 'before', newValue: 'after' }],
        })),
      });
      return ok(domainWrite.changed(undefined, [event], { tables: [table] }));
    });

  it('commits 205 business changes, last actors, all history rows, and one frozen durable audit source message', async () => {
    const result = await executeUpdate(false);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.message);
    const rows = await readBusinessRows();
    expect(rows).toHaveLength(205);
    expect(
      rows.every(
        (row) =>
          row.value === 'after' &&
          row.version === 2 &&
          row.modifierType === currentActor.type &&
          row.modifierId === currentActor.id &&
          row.creatorType === baselineActor.type &&
          row.creatorId === baselineActor.id
      )
    ).toBe(true);
    const history = await sql<{
      recordId: string;
      actorType: string;
      actorId: string;
      executor: string;
      fieldId: string;
    }>`
      SELECT record_id AS "recordId", actor_type AS "actorType", actor_id AS "actorId", created_by AS executor, field_id AS "fieldId"
      FROM ${sql.id(officialSchema, 'record_history')} WHERE table_id = ${table.id().toString()}
    `.execute(db);
    expect(history.rows).toHaveLength(205);
    expect(successfulHistoryInsertRows).toEqual([200, 5]);
    expect(new Set(history.rows.map((row) => row.recordId))).toEqual(new Set(recordIds));
    expect(
      history.rows.every(
        (row) =>
          row.actorType === currentActor.type &&
          row.actorId === currentActor.id &&
          row.executor === executor &&
          row.fieldId === fieldId
      )
    ).toBe(true);
    const source = await readSourceMessages();
    expect(source).toHaveLength(1);
    const message = source[0];
    expect(message).toMatchObject({
      messageName: 'table.records.batch-updated.v1',
      schemaVersion: 1,
      requiredConsumers: ['record.audit-log.v1'],
      unpublished: true,
      attribution: {
        version: 1,
        eventId: message.id,
        operationId: operationAttribution.operationId,
        occurredAt: result.value.events[0].occurredAt.toDate().toISOString(),
        context: { actorId: executor, initiator: currentActor, operationAttribution },
      },
    });
    expect(message.payload.updates).toHaveLength(205);
    expect(new Set(message.payload.updates.map((update) => update.recordId))).toEqual(
      new Set(recordIds)
    );
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('rolls back business values, actors, and partial history and leaves no source message when the second history batch fails', async () => {
    const result = await executeUpdate(true);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record_history.insert_failed');
    expect(result._unsafeUnwrapErr().message).toContain(constraintName);
    expect(successfulHistoryInsertRows).toEqual([200]);
    const rows = await readBusinessRows();
    expect(rows).toHaveLength(205);
    expect(
      rows.every(
        (row) =>
          row.value === 'before' &&
          row.version === 1 &&
          row.modifierType === baselineActor.type &&
          row.modifierId === baselineActor.id &&
          row.creatorType === baselineActor.type &&
          row.creatorId === baselineActor.id
      )
    ).toBe(true);
    const remaining = await sql<{ count: number }>`SELECT count(*)::int AS count
      FROM ${sql.id(officialSchema, 'record_history')} WHERE table_id = ${table.id().toString()}`.execute(
      db
    );
    expect(remaining.rows[0].count).toBe(0);
    // The actual registered journal participates in the successful path. The
    // domain transaction deliberately runs required history before appending its
    // planned source message, so a failed history effect must leave no outbox row.
    expect(await readSourceMessages()).toEqual([]);
    const constraint = await sql<{ count: number }>`SELECT count(*)::int AS count FROM pg_constraint
      WHERE conrelid = ${`${officialSchema}.record_history`}::regclass AND conname = ${constraintName}`.execute(
      db
    );
    expect(constraint.rows[0].count).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });
});
