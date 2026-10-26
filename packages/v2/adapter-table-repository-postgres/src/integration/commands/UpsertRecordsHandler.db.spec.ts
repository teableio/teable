/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateTableCommand,
  FieldKeyType,
  UpsertRecordsCommand,
  v2CoreTokens,
  type CreateTableResult,
  type IUndoRedoStore,
  type Table,
  type UpsertRecordsResult,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DomainEventOutboxWorker } from '../../projection/DomainEventOutboxWorker';
import { v2RecordRepositoryPostgresTokens } from '../../record/di/tokens';
import {
  createUndoRedoDbHarness,
  disposeHarness,
  findField,
  getFieldDbName,
  listRows,
  type UndoRedoDbHarness,
} from '../undo-redo/shared/undoRedoDbTestKit';

describe('UpsertRecordsHandler (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  const requireHarness = () => {
    if (!harness) throw new Error('Missing harness');
    return harness;
  };

  const createUpsertTable = async (name: string): Promise<Table> => {
    const activeHarness = requireHarness();
    const command = CreateTableCommand.create({
      baseId: activeHarness.testContainer.baseId.toString(),
      name,
      fields: [
        { type: 'singleLineText', name: 'Key', isPrimary: true, unique: true },
        { type: 'singleLineText', name: 'Title' },
        { type: 'singleLineText', name: 'Email', unique: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();
    const result = await activeHarness.execute<CreateTableCommand, CreateTableResult>(command);
    return result.table;
  };

  const upsert = async (
    table: Table,
    onConflict: 'error' | 'ignore' | 'update',
    records: ReadonlyArray<Record<string, unknown>>
  ) => {
    const activeHarness = requireHarness();
    const keyField = findField(table, 'Key');
    const titleField = findField(table, 'Title');
    const emailField = findField(table, 'Email');
    const amountField = findField(table, 'Amount');
    const command = UpsertRecordsCommand.create({
      tableId: table.id().toString(),
      matchField: keyField.id().toString(),
      onConflict,
      records: records.map((record) => ({
        fields: {
          ...(typeof record.Key === 'string' ? { [keyField.id().toString()]: record.Key } : {}),
          ...(record.Title !== undefined ? { [titleField.id().toString()]: record.Title } : {}),
          ...(record.Amount !== undefined ? { [amountField.id().toString()]: record.Amount } : {}),
          ...(record.Email !== undefined ? { [emailField.id().toString()]: record.Email } : {}),
        },
      })),
    })._unsafeUnwrap();

    return activeHarness.execute<UpsertRecordsCommand, UpsertRecordsResult>(command);
  };

  it('creates missing rows and fails the whole batch in error mode when a key exists', async () => {
    const table = await createUpsertTable('Upsert Error Mode');
    const keyField = findField(table, 'Key');
    const titleField = findField(table, 'Title');

    const first = await upsert(table, 'error', [
      { Key: 'k1', Title: 'One' },
      { Key: 'k2', Title: 'Two' },
    ]);
    expect(first.summary).toEqual({
      requested: 2,
      created: 2,
      updated: 0,
      unchanged: 0,
      skipped: 0,
    });
    expect(first.results.map((result) => result.status)).toEqual(['created', 'created']);

    const keyFieldId = keyField.id().toString();
    const titleFieldId = titleField.id().toString();
    const conflictingCommand = UpsertRecordsCommand.create({
      tableId: table.id().toString(),
      matchField: keyFieldId,
      onConflict: 'error',
      records: [
        { fields: { [keyFieldId]: 'k3', [titleFieldId]: 'Three' } },
        { fields: { [keyFieldId]: 'k1', [titleFieldId]: 'One again' } },
      ],
    })._unsafeUnwrap();
    const second = await requireHarness().commandBus.execute(
      requireHarness().context,
      conflictingCommand
    );
    expect(second.isErr()).toBe(true);
    expect(second.isErr() && second.error.code).toBe('record.upsert.conflict');

    const rows = await listRows(requireHarness().db, table);
    expect(rows).toHaveLength(2);
    const titleDb = getFieldDbName(table, 'Title');
    const keyDb = getFieldDbName(table, 'Key');
    expect(rows.find((row) => row[keyDb] === 'k1')?.[titleDb]).toBe('One');
    expect(keyField.id().toString()).toBeTruthy();
    expect(titleField.id().toString()).toBeTruthy();
  });

  it('skips existing rows without consuming auto numbers', async () => {
    const table = await createUpsertTable('Upsert Ignore Mode');

    await upsert(table, 'ignore', [
      { Key: 'k1', Title: 'One' },
      { Key: 'k2', Title: 'Two' },
    ]);

    const skipped = await upsert(table, 'ignore', [
      { Key: 'k1', Title: 'Changed but ignored' },
      { Key: 'k2', Title: 'Also ignored' },
    ]);
    expect(skipped.results.map((result) => result.status)).toEqual(['skipped', 'skipped']);
    expect(skipped.summary).toEqual({
      requested: 2,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 2,
    });

    const created = await upsert(table, 'ignore', [{ Key: 'k3', Title: 'Three' }]);
    expect(created.results[0]?.status).toBe('created');

    const rows = await listRows(requireHarness().db, table);
    const autoNumbers = rows.map((row) => Number(row['__auto_number'])).sort((a, b) => a - b);
    expect(autoNumbers).toEqual([1, 2, 3]);
    const titleDb = getFieldDbName(table, 'Title');
    expect(rows.find((row) => row['__auto_number'] === 1)?.[titleDb]).toBe('One');
  });

  it('updates only provided fields and reports unchanged rows', async () => {
    const table = await createUpsertTable('Upsert Update Mode');

    const created = await upsert(table, 'update', [{ Key: 'k1', Title: 'One', Amount: 1 }]);
    const recordId = created.results[0]?.recordId;
    expect(recordId).toBeTruthy();

    const updated = await upsert(table, 'update', [
      { Key: 'k1', Amount: 42 },
      { Key: 'k1b', Title: 'New row' },
    ]);
    expect(updated.results.map((result) => result.status)).toEqual(['updated', 'created']);
    expect(updated.summary).toEqual({
      requested: 2,
      created: 1,
      updated: 1,
      unchanged: 0,
      skipped: 0,
    });

    const rows = await listRows(requireHarness().db, table);
    const keyDb = getFieldDbName(table, 'Key');
    const titleDb = getFieldDbName(table, 'Title');
    const amountDb = getFieldDbName(table, 'Amount');
    const updatedRow = rows.find((row) => row[keyDb] === 'k1');
    expect(updatedRow?.[amountDb]).toBe(42);
    expect(updatedRow?.[titleDb]).toBe('One');
    expect(updatedRow?.['__version']).toBe(2);

    const unchanged = await upsert(table, 'update', [{ Key: 'k1', Amount: 42 }]);
    expect(unchanged.results.map((result) => result.status)).toEqual(['unchanged']);
    const afterUnchanged = await listRows(requireHarness().db, table);
    expect(afterUnchanged.find((row) => row[keyDb] === 'k1')?.['__version']).toBe(2);
  });

  // Resolve the database exactly like createV2NodeTestContainer: an explicit
  // connection string wins, otherwise the container starts its own real Postgres
  // testcontainer. Only an explicit PGlite/memory config is a single-connection
  // engine that cannot model a write race — that is the only case to skip.
  const resolvedDatabaseUrl =
    process.env.TEABLE_V2_TEST_DATABASE_URL ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL ??
    '';
  const isExplicitPglite =
    resolvedDatabaseUrl === 'memory://' || resolvedDatabaseUrl.startsWith('pglite://');
  const hasRealPostgres = !isExplicitPglite;

  it.runIf(hasRealPostgres)(
    'leaves exactly one row for 20 concurrent writes of the same key',
    async () => {
      const table = await createUpsertTable('Upsert Concurrent');

      // Two waves of 10: the pg pool is smaller than 20, and a fully saturated
      // pool can stall every writer on the winner's uncommitted row lock. Each
      // wave is a genuine race and the invariant is asserted over all 20 writes.
      const writers = Array.from({ length: 20 }, (_, index) => index);
      const attempts: Array<Awaited<ReturnType<typeof upsert>>> = [];
      for (const wave of [writers.slice(0, 10), writers.slice(10)]) {
        attempts.push(
          ...(await Promise.all(
            wave.map((index) =>
              upsert(table, 'ignore', [{ Key: 'race-key', Title: `writer-${index}` }])
            )
          ))
        );
      }

      // Reaching this point means no loser surfaced 23505/25P02 as a request
      // failure: every writer had to converge through the savepoint retry.
      expect(attempts).toHaveLength(20);

      const rows = await listRows(requireHarness().db, table);
      const keyDb = getFieldDbName(table, 'Key');
      const raceRows = rows.filter((row) => row[keyDb] === 'race-key');
      expect(raceRows).toHaveLength(1);
      // The winner inserted exactly once and no loser bumped it.
      expect(raceRows[0]?.['__version']).toBe(1);

      const totals = attempts.reduce(
        (accumulator, result) => {
          for (const row of result.results) {
            accumulator[row.status] += 1;
          }
          return accumulator;
        },
        { created: 0, updated: 0, unchanged: 0, skipped: 0 }
      );
      expect(totals.created).toBe(1);
      expect(totals.skipped).toBe(19);
      expect(totals.created + totals.updated + totals.unchanged + totals.skipped).toBe(20);
    }
  );

  it('records one undo entry and replays delete plus restore', async () => {
    const activeHarness = requireHarness();
    const table = await createUpsertTable('Upsert Undo');
    const store = activeHarness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    await upsert(table, 'update', [{ Key: 'k1', Title: 'One', Amount: 1 }]);
    const createdIds = (await listRows(activeHarness.db, table)).map((row) => String(row['__id']));

    await upsert(table, 'update', [
      { Key: 'k1', Amount: 5 },
      { Key: 'k2', Title: 'Two' },
    ]);

    const entries = (
      await store.list({
        actorId: activeHarness.context.actorId,
        tableId: table.id(),
        windowId: activeHarness.context.windowId!,
      })
    )._unsafeUnwrap();

    const batchEntry = entries.find((candidate) => candidate.undoCommand.type === 'Batch');
    expect(batchEntry).toBeDefined();
    if (batchEntry?.undoCommand.type === 'Batch') {
      expect(batchEntry.undoCommand.payload.map((command) => command.type).sort()).toEqual([
        'DeleteRecords',
        'UpdateRecords',
      ]);
    }

    await activeHarness.undo(table.id().toString());
    const afterUndo = await listRows(activeHarness.db, table);
    expect(afterUndo.map((row) => String(row['__id']))).toEqual(createdIds);
    const amountDb = getFieldDbName(table, 'Amount');
    const keyDb = getFieldDbName(table, 'Key');
    expect(afterUndo.find((row) => row[keyDb] === 'k1')?.[amountDb]).toBe(1);

    await activeHarness.redo(table.id().toString());
    const afterRedo = await listRows(activeHarness.db, table);
    expect(afterRedo.find((row) => row[keyDb] === 'k1')?.[amountDb]).toBe(5);
    expect(afterRedo.some((row) => row[keyDb] === 'k2')).toBe(true);
  });

  it('rolls back earlier updates when a later insert in the same request fails', async () => {
    const activeHarness = requireHarness();
    const table = await createUpsertTable('Upsert Atomic');
    const amountDb = getFieldDbName(table, 'Amount');
    const keyDb = getFieldDbName(table, 'Key');

    await upsert(table, 'update', [{ Key: 'k1', Title: 'One', Amount: 1 }]);
    const emailField = findField(table, 'Email');
    const keyField = findField(table, 'Key');
    const amountField = findField(table, 'Amount');
    await upsert(table, 'ignore', [{ Key: 'taken', Email: 'taken@example.com' }]);

    const command = UpsertRecordsCommand.create({
      tableId: table.id().toString(),
      matchField: keyField.id().toString(),
      onConflict: 'update',
      fieldKeyType: FieldKeyType.Id,
      records: [
        { fields: { [keyField.id().toString()]: 'k1', [amountField.id().toString()]: 99 } },
        {
          fields: {
            [keyField.id().toString()]: 'brand-new',
            [emailField.id().toString()]: 'taken@example.com',
          },
        },
      ],
    })._unsafeUnwrap();
    const result = await activeHarness.commandBus.execute(activeHarness.context, command);

    expect(result.isErr() && result.error.code).toBe('validation.field.unique');
    const rows = await listRows(activeHarness.db, table);
    // The k1 update was in the same transaction as the failed insert: it must not
    // survive, which only holds when the batch is genuinely atomic.
    expect(rows.find((row) => row[keyDb] === 'k1')?.[amountDb]).toBe(1);
    expect(rows.some((row) => row[keyDb] === 'brand-new')).toBe(false);
  });

  it('emits no events and appends no undo entry for skipped or unchanged batches', async () => {
    const activeHarness = requireHarness();
    const table = await createUpsertTable('Upsert No Side Effects');
    const store = activeHarness.container.resolve<IUndoRedoStore>(v2CoreTokens.undoRedoStore);

    await upsert(table, 'update', [{ Key: 'k1', Title: 'One', Amount: 1 }]);
    const entriesBefore = (
      await store.list({
        actorId: activeHarness.context.actorId,
        tableId: table.id(),
        windowId: activeHarness.context.windowId!,
      })
    )._unsafeUnwrap();

    const skipped = await upsert(table, 'ignore', [{ Key: 'k1', Title: 'Changed' }]);
    expect(skipped.events).toHaveLength(0);
    expect(skipped.results[0]?.status).toBe('skipped');

    const unchanged = await upsert(table, 'update', [{ Key: 'k1', Amount: 1 }]);
    expect(unchanged.events).toHaveLength(0);
    expect(unchanged.results[0]?.status).toBe('unchanged');

    const entriesAfter = (
      await store.list({
        actorId: activeHarness.context.actorId,
        tableId: table.id(),
        windowId: activeHarness.context.windowId!,
      })
    )._unsafeUnwrap();
    expect(entriesAfter).toHaveLength(entriesBefore.length);

    const keyDb = getFieldDbName(table, 'Key');
    const rows = await listRows(activeHarness.db, table);
    expect(rows.find((row) => row[keyDb] === 'k1')?.['__version']).toBe(1);
  });

  it('rejects duplicate keys and a non-unique match field before writing', async () => {
    const activeHarness = requireHarness();
    const table = await createUpsertTable('Upsert Validation');
    const keyField = findField(table, 'Key');
    const titleField = findField(table, 'Title');

    const duplicate = UpsertRecordsCommand.create({
      tableId: table.id().toString(),
      matchField: keyField.id().toString(),
      onConflict: 'ignore',
      fieldKeyType: FieldKeyType.Id,
      records: [
        { fields: { [keyField.id().toString()]: 'dup' } },
        { fields: { [keyField.id().toString()]: 'dup' } },
      ],
    })._unsafeUnwrap();
    const duplicateResult = await activeHarness.commandBus.execute(
      activeHarness.context,
      duplicate
    );
    expect(duplicateResult.isErr() && duplicateResult.error.code).toBe(
      'record.upsert.duplicate_key_in_batch'
    );

    const nonUnique = UpsertRecordsCommand.create({
      tableId: table.id().toString(),
      matchField: titleField.id().toString(),
      onConflict: 'ignore',
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [titleField.id().toString()]: 'title' } }],
    })._unsafeUnwrap();
    const nonUniqueResult = await activeHarness.commandBus.execute(
      activeHarness.context,
      nonUnique
    );
    expect(nonUniqueResult.isErr() && nonUniqueResult.error.code).toBe(
      'record.upsert.match_field_not_unique'
    );

    expect(await listRows(activeHarness.db, table)).toHaveLength(0);
  });

  it('emits created and updated events and settles an outbox delivery', async () => {
    const activeHarness = requireHarness();
    const table = await createUpsertTable('Upsert Events');

    await upsert(table, 'ignore', [{ Key: 'k1', Title: 'One' }]);
    const mixed = await upsert(table, 'update', [
      { Key: 'k1', Title: 'Two' },
      { Key: 'k2', Title: 'New' },
    ]);

    const names = mixed.events.map((event) => event.name.toString());
    expect(names).toContain('RecordsBatchUpdated');
    expect(names.some((name) => name === 'RecordCreated' || name === 'RecordsBatchCreated')).toBe(
      true
    );

    const updatedEvent = mixed.events.find(
      (event) => event.name.toString() === 'RecordsBatchUpdated'
    ) as unknown as { updates: ReadonlyArray<{ recordId: string; changes: unknown[] }> };
    expect(updatedEvent.updates).toHaveLength(1);
    expect(updatedEvent.updates[0]?.changes.length).toBeGreaterThan(0);

    const createdEvent = mixed.events.find(
      (event) =>
        event.name.toString() === 'RecordCreated' || event.name.toString() === 'RecordsBatchCreated'
    ) as unknown as { recordId?: string; records?: ReadonlyArray<{ recordId: string }> };
    const createdIds = createdEvent.records?.map((record) => record.recordId) ?? [
      createdEvent.recordId,
    ];
    expect(createdIds.filter(Boolean)).toHaveLength(1);

    const outbox = await sql<{ base_id: string }>`select base_id from domain_event_outbox`.execute(
      activeHarness.db
    );
    expect(outbox.rows.some((row) => row.base_id === table.baseId().toString())).toBe(true);

    const worker = activeHarness.container.resolve<DomainEventOutboxWorker>(
      v2RecordRepositoryPostgresTokens.domainEventOutboxWorker
    );
    expect((await worker.pollOnce()).isOk()).toBe(true);

    const inbox = await sql<{ consumer_id: string }>`
      select consumer_id from domain_event_inbox
    `.execute(activeHarness.db);
    expect(inbox.rows.some((row) => row.consumer_id === 'record.validation.v1')).toBe(true);
  });

  it('matches unique number and date keys across equivalent spellings', async () => {
    const activeHarness = requireHarness();
    const createCommand = CreateTableCommand.create({
      baseId: activeHarness.testContainer.baseId.toString(),
      name: 'Upsert Match Keys',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Num', unique: true },
        { type: 'date', name: 'When', unique: true },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();
    const { table } = await activeHarness.execute<CreateTableCommand, CreateTableResult>(
      createCommand
    );

    const numField = findField(table, 'Num');
    const whenField = findField(table, 'When');
    const titleField = findField(table, 'Title');
    const whenFieldDbName = getFieldDbName(table, 'When');

    const numberRequest = (value: unknown, title: string) =>
      UpsertRecordsCommand.create({
        tableId: table.id().toString(),
        matchField: numField.id().toString(),
        onConflict: 'update',
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          { fields: { [numField.id().toString()]: value, [titleField.id().toString()]: title } },
        ],
      })._unsafeUnwrap();

    const firstNumber = await activeHarness.commandBus.execute<
      UpsertRecordsCommand,
      UpsertRecordsResult
    >(activeHarness.context, numberRequest(1, 'Numeric'));
    expect(firstNumber._unsafeUnwrap().results[0]?.status).toBe('created');

    const stringyNumber = await activeHarness.commandBus.execute<
      UpsertRecordsCommand,
      UpsertRecordsResult
    >(activeHarness.context, numberRequest('1', 'Numeric'));
    expect(stringyNumber._unsafeUnwrap().results[0]?.status).toBe('unchanged');

    const dateRequest = (value: string, title: string) =>
      UpsertRecordsCommand.create({
        tableId: table.id().toString(),
        matchField: whenField.id().toString(),
        onConflict: 'update',
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          { fields: { [whenField.id().toString()]: value, [titleField.id().toString()]: title } },
        ],
      })._unsafeUnwrap();

    // Date-only input must normalize exactly like the write path (field/system
    // timezone), otherwise the replay would miss and collide on the unique index.
    const firstDate = await activeHarness.commandBus.execute<
      UpsertRecordsCommand,
      UpsertRecordsResult
    >(activeHarness.context, dateRequest('2024-01-01', 'Date'));
    expect(firstDate._unsafeUnwrap().results[0]?.status).toBe('created');

    const replayedDateOnly = await activeHarness.commandBus.execute<
      UpsertRecordsCommand,
      UpsertRecordsResult
    >(activeHarness.context, dateRequest('2024-01-01', 'Date'));
    expect(replayedDateOnly._unsafeUnwrap().results[0]?.status).toBe('unchanged');

    const storedDate = String(
      (await listRows(activeHarness.db, table)).find((row) => row[whenFieldDbName] != null)?.[
        whenFieldDbName
      ]
    );
    const sameInstant = await activeHarness.commandBus.execute<
      UpsertRecordsCommand,
      UpsertRecordsResult
    >(activeHarness.context, dateRequest(storedDate, 'Date'));
    expect(sameInstant._unsafeUnwrap().results[0]?.status).toBe('unchanged');

    // One numeric row plus one date row: equivalent spellings never duplicated.
    expect(await listRows(activeHarness.db, table)).toHaveLength(2);
  });
});
