/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateFieldCommand,
  CreateRecordsCommand,
  CreateTableCommand,
  GetTableByIdQuery,
  ProjectionMessageCodecRegistry,
  recordProjectionCodecs,
  type CreateFieldResult,
  type CreateRecordsResult,
  type CreateTableResult,
  type GetTableByIdResult,
  type ICommandBus,
  type IDurableProjectionContext,
  type IDurableProjectionHandler,
  type IQueryBus,
  type ProjectionDeliveryError,
  type ProjectionDeliveryOutcome,
  type ProjectionMessageJson,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { ok, type Result } from 'neverthrow';
import { beforeEach, describe, expect, it } from 'vitest';

import { DomainEventOutboxWorker } from '../../projection/DomainEventOutboxWorker';
import {
  RECORD_VALIDATION_CONSUMER_ID,
  ValidationInboxDurableProjection,
} from '../../projection/ValidationInboxDurableProjection';
import { v2RecordRepositoryPostgresTokens } from '../../record/di/tokens';
import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

describe('CreateRecordsHandler (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  const createContext = () => {
    const actorIdResult = ActorId.create('system');
    return { actorId: actorIdResult._unsafeUnwrap() };
  };

  const createTestTable = async (
    commandBus: ICommandBus,
    baseId: string,
    tableName: string
  ): Promise<CreateTableResult> => {
    const command = CreateTableCommand.create({
      baseId,
      name: tableName,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'checkbox', name: 'Approved' },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      command
    );

    return result._unsafeUnwrap();
  };

  it('inserts multiple records into the database', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    // Create a table first
    const { table } = await createTestTable(commandBus, baseId.toString(), 'Batch Records Table');
    const tableId = table.id().toString();

    // Get field IDs
    const fields = table.getFields();
    const titleField = fields.find((f) => f.name().toString() === 'Title');
    const amountField = fields.find((f) => f.name().toString() === 'Amount');
    const approvedField = fields.find((f) => f.name().toString() === 'Approved');

    expect(titleField).toBeDefined();
    expect(amountField).toBeDefined();
    expect(approvedField).toBeDefined();
    if (!titleField || !amountField || !approvedField) return;

    // Create multiple records in one command
    const createRecordsCommand = CreateRecordsCommand.create({
      tableId,
      records: [
        {
          fields: {
            [titleField.id().toString()]: 'First Record',
            [amountField.id().toString()]: 100,
            [approvedField.id().toString()]: true,
          },
        },
        {
          fields: {
            [titleField.id().toString()]: 'Second Record',
            [amountField.id().toString()]: 200,
            [approvedField.id().toString()]: false,
          },
        },
        {
          fields: {
            [titleField.id().toString()]: 'Third Record',
            [amountField.id().toString()]: 300,
            [approvedField.id().toString()]: true,
          },
        },
      ],
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      createRecordsCommand
    );
    result._unsafeUnwrap();

    const { records } = result._unsafeUnwrap();
    expect(records.length).toBe(3);

    // Verify all records were inserted
    const dbTableNameResult = table.dbTableName();
    expect(dbTableNameResult.isOk()).toBe(true);
    const dbTableName = dbTableNameResult._unsafeUnwrap().value()._unsafeUnwrap();

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .execute();

    expect(rows.length).toBe(3);

    // Verify each record has unique ID and correct version
    const recordIds = new Set(rows.map((row) => row['__id']));
    expect(recordIds.size).toBe(3);

    for (const row of rows) {
      expect(row['__version']).toBe(1);
      expect(row['__created_by']).toBe('system');
    }

    // Verify field values
    const titleDbField = titleField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const amountDbField = amountField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const approvedDbField = approvedField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    const sortedRows = [...rows].sort(
      (a, b) => (a[amountDbField] as number) - (b[amountDbField] as number)
    );

    expect(sortedRows[0][titleDbField]).toBe('First Record');
    expect(sortedRows[0][amountDbField]).toBe(100);
    expect(sortedRows[0][approvedDbField]).toBe(true);

    expect(sortedRows[1][titleDbField]).toBe('Second Record');
    expect(sortedRows[1][amountDbField]).toBe(200);
    // v1 contract: checkbox false is stored as null (T6520)
    expect(sortedRows[1][approvedDbField]).toBeNull();

    expect(sortedRows[2][titleDbField]).toBe('Third Record');
    expect(sortedRows[2][amountDbField]).toBe(300);
    expect(sortedRows[2][approvedDbField]).toBe(true);
  });

  it('inserts records with empty fields', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const { table } = await createTestTable(
      commandBus,
      baseId.toString(),
      'Empty Batch Fields Table'
    );
    const tableId = table.id().toString();

    const createRecordsCommand = CreateRecordsCommand.create({
      tableId,
      records: [{ fields: {} }, { fields: {} }, { fields: {} }],
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      createRecordsCommand
    );
    result._unsafeUnwrap();

    const { records } = result._unsafeUnwrap();
    expect(records.length).toBe(3);

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .execute();

    expect(rows.length).toBe(3);
  });

  it('returns all created records with unique IDs', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const { table } = await createTestTable(commandBus, baseId.toString(), 'Unique IDs Table');
    const tableId = table.id().toString();

    const createRecordsCommand = CreateRecordsCommand.create({
      tableId,
      records: Array.from({ length: 10 }, () => ({ fields: {} })),
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      createRecordsCommand
    );
    const { records } = result._unsafeUnwrap();

    expect(records.length).toBe(10);

    const ids = new Set(records.map((r) => r.id().toString()));
    expect(ids.size).toBe(10); // All IDs should be unique
  });

  it('returns error when table not found', async () => {
    const { container } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

    const createRecordsCommand = CreateRecordsCommand.create({
      tableId: `tbl${'x'.repeat(16)}`,
      records: [{ fields: {} }],
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      createRecordsCommand
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message.toLowerCase()).toContain('not found');
    const outboxRows = await db.selectFrom('domain_event_outbox').selectAll().execute();
    expect(outboxRows).toHaveLength(0);
  });

  it('handles mixed field sets across records', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const { table } = await createTestTable(commandBus, baseId.toString(), 'Mixed Fields Table');
    const tableId = table.id().toString();

    const fields = table.getFields();
    const titleField = fields.find((f) => f.name().toString() === 'Title');
    const amountField = fields.find((f) => f.name().toString() === 'Amount');

    expect(titleField).toBeDefined();
    expect(amountField).toBeDefined();
    if (!titleField || !amountField) return;

    // Create records with different field combinations
    const createRecordsCommand = CreateRecordsCommand.create({
      tableId,
      records: [
        {
          fields: {
            [titleField.id().toString()]: 'Only Title',
          },
        },
        {
          fields: {
            [amountField.id().toString()]: 500,
          },
        },
        {
          fields: {
            [titleField.id().toString()]: 'Both Fields',
            [amountField.id().toString()]: 1000,
          },
        },
      ],
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      createRecordsCommand
    );
    result._unsafeUnwrap();

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const titleDbField = titleField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const amountDbField = amountField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .execute();

    expect(rows.length).toBe(3);

    const rowWithOnlyTitle = rows.find((r) => r[titleDbField] === 'Only Title');
    const rowWithOnlyAmount = rows.find((r) => r[amountDbField] === 500);
    const rowWithBoth = rows.find((r) => r[titleDbField] === 'Both Fields');

    expect(rowWithOnlyTitle).toBeDefined();
    expect(rowWithOnlyAmount).toBeDefined();
    expect(rowWithBoth).toBeDefined();

    expect(rowWithOnlyTitle?.[amountDbField]).toBeNull();
    expect(rowWithOnlyAmount?.[titleDbField]).toBeNull();
    expect(rowWithBoth?.[amountDbField]).toBe(1000);
  });

  it('computes formula fields depending on unprovided fields', async () => {
    const { container, baseId, processOutbox } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    // Create a table with a text field and formula fields that depend on it
    const createTableCommand = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Formula With Blank Test',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'singleLineText', name: 'Text' },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const tableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      createTableCommand
    );
    const { table } = tableResult._unsafeUnwrap();
    const tableId = table.id().toString();

    const fields = table.getFields();
    const amountField = fields.find((f) => f.name().toString() === 'Amount');
    const textField = fields.find((f) => f.name().toString() === 'Text');
    expect(amountField).toBeDefined();
    expect(textField).toBeDefined();
    if (!amountField || !textField) return;

    // Add formula field: {Text} + '' (depends on Text field)
    const createFormulaCommand = CreateFieldCommand.create({
      baseId: baseId.toString(),
      tableId,
      field: {
        type: 'formula',
        name: 'TextConcat',
        options: {
          expression: `{${textField.id().toString()}} + ''`,
        },
      },
    })._unsafeUnwrap();

    const formulaResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      createContext(),
      createFormulaCommand
    );
    expect(formulaResult.isOk()).toBe(true);

    // Create a record with only the Amount field set - Text field is null
    const createRecordsCommand = CreateRecordsCommand.create({
      tableId,
      records: [
        {
          fields: {
            [amountField.id().toString()]: 100,
          },
        },
      ],
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      createRecordsCommand
    );
    expect(result.isOk()).toBe(true);
    const { records } = result._unsafeUnwrap();
    expect(records.length).toBe(1);

    // Process the outbox to ensure computed fields are updated
    await processOutbox();

    // Verify the formula field was computed with empty string result
    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .execute();

    expect(rows.length).toBe(1);
    const row = rows[0];

    // The formula {Text} + '' should return '' when Text is null
    // Find the formula field and its db column name
    const getTableQuery = GetTableByIdQuery.create({
      baseId: baseId.toString(),
      tableId,
    })._unsafeUnwrap();
    const updatedTableResult = await queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
      createContext(),
      getTableQuery
    );
    expect(updatedTableResult.isOk()).toBe(true);
    const { table: updatedTable } = updatedTableResult._unsafeUnwrap();
    const formulaField = updatedTable.getFields().find((f) => f.name().toString() === 'TextConcat');
    expect(formulaField).toBeDefined();
    if (!formulaField) return;

    const formulaDbField = formulaField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    expect(row[formulaDbField]).toBe('');
  });

  it('writes a domain event outbox row and the worker settles validation delivery', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const { table } = await createTestTable(commandBus, baseId.toString(), 'Domain Event Outbox');
    const titleField = table.getFields().find((field) => field.name().toString() === 'Title');
    expect(titleField).toBeDefined();
    if (!titleField) return;

    const createResult = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [{ fields: { [titleField.id().toString()]: 'Outbox record' } }],
      })._unsafeUnwrap()
    );
    expect(createResult.isOk()).toBe(true);

    const outboxRows = await db.selectFrom('domain_event_outbox').selectAll().execute();
    expect(outboxRows.length).toBeGreaterThan(0);
    expect(outboxRows.some((row) => row.base_id === baseId.toString())).toBe(true);

    const worker = container.resolve<DomainEventOutboxWorker>(
      v2RecordRepositoryPostgresTokens.domainEventOutboxWorker
    );
    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);

    const inboxRows = await db.selectFrom('domain_event_inbox').selectAll().execute();
    expect(inboxRows.some((row) => row.consumer_id === 'record.validation.v1')).toBe(true);
  });

  it('skips claim for unknown consumers without burning attempts or dead-lettering', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const { table } = await createTestTable(
      commandBus,
      baseId.toString(),
      'Unknown Consumer Outbox'
    );
    const titleField = table.getFields().find((field) => field.name().toString() === 'Title');
    expect(titleField).toBeDefined();
    if (!titleField) return;

    const createResult = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [{ fields: { [titleField.id().toString()]: 'Unknown consumer' } }],
      })._unsafeUnwrap()
    );
    expect(createResult.isOk()).toBe(true);

    const outboxRows = await db.selectFrom('domain_event_outbox').selectAll().execute();
    expect(outboxRows.length).toBeGreaterThan(0);

    await db
      .insertInto('domain_event_delivery')
      .values({
        id: crypto.randomUUID().replaceAll('-', '').slice(0, 20),
        event_id: outboxRows[0]!.id,
        consumer_id: 'unknown.future.consumer',
        status: 'pending',
        attempts: 0,
        max_attempts: 12,
      })
      .execute();

    const worker = container.resolve<DomainEventOutboxWorker>(
      v2RecordRepositoryPostgresTokens.domainEventOutboxWorker
    );
    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);

    const unknown = await db
      .selectFrom('domain_event_delivery')
      .selectAll()
      .where('consumer_id', '=', 'unknown.future.consumer')
      .executeTakeFirstOrThrow();
    expect(unknown.status).toBe('pending');
    expect(unknown.attempts).toBe(0);
    expect(unknown.lease_token).toBeNull();
  });

  it('skips claim when a known consumer is not subscribed to the message', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const { table } = await createTestTable(commandBus, baseId.toString(), 'Unsubscribed Message');
    const titleField = table.getFields().find((field) => field.name().toString() === 'Title');
    expect(titleField).toBeDefined();
    if (!titleField) return;

    const createResult = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [{ fields: { [titleField.id().toString()]: 'Unsubscribed' } }],
      })._unsafeUnwrap()
    );
    expect(createResult.isOk()).toBe(true);

    const codecs = ProjectionMessageCodecRegistry.create(recordProjectionCodecs);
    expect(codecs.isOk()).toBe(true);
    const handler = new ValidationInboxDurableProjection(db);
    const worker = new DomainEventOutboxWorker(
      db,
      new Map([[handler.consumerId, handler]]),
      codecs._unsafeUnwrap(),
      container.resolve(v2CoreTokens.logger),
      undefined,
      [
        {
          consumerId: RECORD_VALIDATION_CONSUMER_ID,
          messageName: 'table.record.updated.v1',
          schemaVersion: 1,
        },
      ]
    );
    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);

    const deliveries = await db
      .selectFrom('domain_event_delivery')
      .selectAll()
      .where('consumer_id', '=', RECORD_VALIDATION_CONSUMER_ID)
      .execute();
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries.every((row) => row.status === 'pending' && row.attempts === 0)).toBe(true);
  });

  it('skips claim for unsupported decoder versions without burning attempts', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const { table } = await createTestTable(commandBus, baseId.toString(), 'Unsupported Decoder');
    const titleField = table.getFields().find((field) => field.name().toString() === 'Title');
    expect(titleField).toBeDefined();
    if (!titleField) return;

    const createResult = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [{ fields: { [titleField.id().toString()]: 'Unsupported decoder' } }],
      })._unsafeUnwrap()
    );
    expect(createResult.isOk()).toBe(true);

    const source = await db.selectFrom('domain_event_outbox').selectAll().executeTakeFirstOrThrow();
    await db
      .updateTable('domain_event_outbox')
      .set({ schema_version: 99 })
      .where('id', '=', source.id)
      .execute();

    const worker = container.resolve<DomainEventOutboxWorker>(
      v2RecordRepositoryPostgresTokens.domainEventOutboxWorker
    );
    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);

    const unsupported = await db
      .selectFrom('domain_event_delivery')
      .selectAll()
      .where('event_id', '=', source.id)
      .executeTakeFirstOrThrow();
    expect(unsupported.status).toBe('pending');
    expect(unsupported.attempts).toBe(0);
  });

  it('does not complete a delivery after its lease expires', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const { table } = await createTestTable(commandBus, baseId.toString(), 'Expired Lease');
    const titleField = table.getFields().find((field) => field.name().toString() === 'Title');
    expect(titleField).toBeDefined();
    if (!titleField) return;

    const createResult = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [{ fields: { [titleField.id().toString()]: 'Expired lease' } }],
      })._unsafeUnwrap()
    );
    expect(createResult.isOk()).toBe(true);

    class ExpireLeaseHandler implements IDurableProjectionHandler<ProjectionMessageJson> {
      readonly consumerId = RECORD_VALIDATION_CONSUMER_ID;

      async handle(
        context: IDurableProjectionContext,
        _message: ProjectionMessageJson
      ): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>> {
        await db
          .updateTable('domain_event_delivery')
          .set({ lease_expires_at: new Date(Date.now() - 1_000) })
          .where('id', '=', context.deliveryId)
          .execute();
        await db
          .insertInto('domain_event_inbox')
          .values({
            consumer_id: context.consumerId,
            event_id: context.eventId,
          })
          .execute();
        return ok({
          kind: 'applied',
          effectReceipt: {
            kind: 'destination-inbox',
            identity: RECORD_VALIDATION_CONSUMER_ID,
          },
        });
      }
    }

    const codecs = ProjectionMessageCodecRegistry.create(recordProjectionCodecs);
    expect(codecs.isOk()).toBe(true);
    const handler = new ExpireLeaseHandler();
    const worker = new DomainEventOutboxWorker(
      db,
      new Map([[handler.consumerId, handler]]),
      codecs._unsafeUnwrap(),
      container.resolve(v2CoreTokens.logger)
    );
    const poll = await worker.pollOnce();
    expect(poll.isOk()).toBe(true);

    const deliveries = await db
      .selectFrom('domain_event_delivery')
      .selectAll()
      .where('consumer_id', '=', RECORD_VALIDATION_CONSUMER_ID)
      .execute();
    expect(deliveries.some((row) => row.status === 'succeeded')).toBe(false);
    expect(deliveries.some((row) => row.status === 'processing' && row.attempts >= 1)).toBe(true);
  });
});
