import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { FieldName } from '../../domain/table/fields/FieldName';
import { FieldUnique } from '../../domain/table/fields/types/FieldUnique';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { TableRecord } from '../../domain/table/records/TableRecord';
import { Table as V2Table } from '../../domain/table/Table';
import type { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { RecordQueryPluginScope } from '../../ports/RecordQueryPlugin';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import { createUndoRedoCommand } from '../../ports/UndoRedoStore';
import type { IRecordBatchCreationResult } from './RecordBatchCreationService';
import type { IRecordBulkUpdateTransactionResult } from './RecordBulkUpdateService';
import {
  applyUpsertReadScope,
  RecordUpsertService,
  type IRecordUpsertResult,
  type IRecordUpsertRowResult,
} from './RecordUpsertService';

const tableId = TableId.create(`tbl${'t'.repeat(16)}`)._unsafeUnwrap();
const fieldA = `fld${'a'.repeat(16)}`;
const fieldB = `fld${'b'.repeat(16)}`;
const recordA = `rec${'a'.repeat(16)}`;
const recordB = `rec${'b'.repeat(16)}`;

const table = { id: () => tableId } as unknown as Table;

const buildRecord = (id: string) =>
  TableRecord.fromRawFieldValues({
    id,
    tableId,
    fields: { [fieldA]: 'visible', [fieldB]: 'secret' },
  })._unsafeUnwrap();

const buildResults = (): IRecordUpsertRowResult[] => [
  { index: 0, status: 'created', recordId: recordA, record: buildRecord(recordA) },
  { index: 1, status: 'updated', recordId: recordB, record: buildRecord(recordB) },
];

const recordSpec = (predicate: (record: TableRecord) => boolean) =>
  ({ isSatisfiedBy: predicate }) as unknown as ISpecification<
    TableRecord,
    ITableRecordConditionSpecVisitor
  >;

const fieldKeys = (result: IRecordUpsertRowResult) =>
  result.record
    ?.fields()
    .entries()
    .map((entry) => entry.fieldId.toString())
    .sort();

describe('applyUpsertReadScope', () => {
  it('returns results untouched without read scope', () => {
    const results = buildResults();
    expect(applyUpsertReadScope(table, results, undefined)).toBe(results);
  });

  it('drops the record id and record for rows outside the read row spec', () => {
    const results = applyUpsertReadScope(table, buildResults(), {
      recordSpec: recordSpec((record) => record.id().toString() === recordA),
    });

    expect(results[0]).toMatchObject({ index: 0, status: 'created', recordId: recordA });
    expect(results[1]).toEqual({ index: 1, status: 'updated' });
  });

  it('keeps the id but strips fields outside the projection allow-list', () => {
    const results = applyUpsertReadScope(table, buildResults(), {
      readableFieldIds: new Set([fieldA]),
    });

    expect(results[0]?.recordId).toBe(recordA);
    expect(fieldKeys(results[0]!)).toEqual([fieldA]);
  });

  it('strips cells hidden by a conditional field mask', () => {
    const results = applyUpsertReadScope(table, buildResults(), {
      fieldMasks: [
        {
          fieldId: fieldB,
          visibleWhen: recordSpec(() => false),
        },
      ],
    });

    expect(results[0]?.recordId).toBe(recordA);
    expect(fieldKeys(results[0]!)).toEqual([fieldA]);
    expect(results[1]?.recordId).toBe(recordB);
  });

  it('drops a bare record id when no record entity is available to authorize', () => {
    const results = applyUpsertReadScope(
      table,
      [{ index: 0, status: 'skipped', recordId: recordA }],
      { readableFieldIds: new Set([fieldA]) }
    );

    expect(results[0]).toEqual({ index: 0, status: 'skipped' });
  });
});

type BehaveTable = ReturnType<typeof buildUpsertTable>;

const buildUpsertTable = (unique = true) => {
  const baseId = BaseId.create(`bse${'u'.repeat(16)}`)._unsafeUnwrap();
  const id = TableId.create(`tbl${'u'.repeat(16)}`)._unsafeUnwrap();
  const keyFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
  const titleFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();

  const builder = V2Table.builder()
    .withId(id)
    .withBaseId(baseId)
    .withName(TableName.create('Upsert Behaviours')._unsafeUnwrap());

  const keyField = builder
    .field()
    .singleLineText()
    .withId(keyFieldId)
    .withName(FieldName.create('Key')._unsafeUnwrap());
  if (unique) {
    keyField.withUnique(FieldUnique.enabled());
  }
  keyField.primary().done();

  builder
    .field()
    .singleLineText()
    .withId(titleFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    keyFieldId: keyFieldId.toString(),
    titleFieldId: titleFieldId.toString(),
  };
};

const matchedRow = (table: BehaveTable, id: string, key: string): TableRecordReadModel => ({
  id,
  fields: { [table.keyFieldId]: key, [table.titleFieldId]: 'stored' },
  version: 1,
});

const matchedEntity = (table: BehaveTable, id: string, key: string) =>
  TableRecord.fromRawFieldValues({
    id,
    tableId: table.table.id(),
    fields: { [table.keyFieldId]: key, [table.titleFieldId]: 'stored' },
  })._unsafeUnwrap();

const undoCommands = (tableIdText: string) => [
  createUndoRedoCommand('DeleteRecords', { tableId: tableIdText, recordIds: [] }),
];
const redoCommands = (tableIdText: string) => [
  createUndoRedoCommand('RestoreRecords', { tableId: tableIdText, records: [] }),
];

const createdRecord = (table: BehaveTable, id: string, key: string) =>
  TableRecord.fromRawFieldValues({
    id,
    tableId: table.table.id(),
    fields: { [table.keyFieldId]: key, [table.titleFieldId]: 'new' },
  })._unsafeUnwrap();

type HarnessOptions = {
  readonly table: BehaveTable;
  readonly matched?: ReadonlyArray<TableRecordReadModel>;
  /** Per-call match results; lets a retry re-read a concurrently inserted row. */
  readonly matchedSequence?: ReadonlyArray<ReadonlyArray<TableRecordReadModel>>;
  readonly writeRecordSpec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>;
  readonly createResults?: ReadonlyArray<Result<IRecordBatchCreationResult, DomainError>>;
  readonly createRecords?: ReadonlyArray<ReadonlyArray<TableRecord>>;
  readonly updateResult?: IRecordBulkUpdateTransactionResult;
  readonly readScope?: RecordQueryPluginScope;
};

const createHarness = (options: HarnessOptions) => {
  const queryCalls: unknown[] = [];
  const updateCalls: Array<{
    records: ReadonlyArray<{ fieldValues: ReadonlyMap<string, unknown> }>;
  }> = [];
  const undoAppends: unknown[] = [];
  const afterCommitOrder: string[] = [];
  let savepointCalls = 0;
  let createCalls = 0;

  const createQueue = [...(options.createResults ?? [])];
  const matchSequence = [...(options.matchedSequence ?? [])];
  const createRecordQueue = [...(options.createRecords ?? [])];

  const batchCreation = {
    create: async () => {
      createCalls += 1;
      if (createQueue.length > 0) {
        return createQueue.shift()!;
      }
      return ok<IRecordBatchCreationResult, DomainError>({
        records: createRecordQueue.shift() ?? [],
        events: [],
        fieldKeyMapping: new Map(),
        undoCommands: [],
        redoCommands: [],
        afterCommit: async () => {
          afterCommitOrder.push('create');
        },
      });
    },
  };

  const bulkUpdate = {
    updateWithinTransaction: async (
      _context: unknown,
      input: { records: ReadonlyArray<{ fieldValues: ReadonlyMap<string, unknown> }> }
    ) => {
      updateCalls.push(input);
      if (options.updateResult) {
        return ok<IRecordBulkUpdateTransactionResult, DomainError>({
          ...options.updateResult,
          afterCommit: async () => {
            afterCommitOrder.push('update');
          },
        });
      }
      return ok<IRecordBulkUpdateTransactionResult, DomainError>({
        updatedCount: 0,
        events: [],
        records: [],
        changedRecordIds: [],
        undoCommands: [],
        redoCommands: [],
        afterCommit: async () => {
          afterCommitOrder.push('update');
        },
      });
    },
  };

  const writePluginRunner = {
    prepare: async () =>
      ok({
        guard: async () => ok(undefined),
        getRecordSpec: () =>
          ok<ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined>(
            options.writeRecordSpec
          ),
        afterCommit: async () => {
          afterCommitOrder.push('write');
        },
      }),
  };

  const queryPluginRunner = {
    prepare: async () =>
      ok({
        guard: async () => ok(undefined),
        getScope: () => ok<RecordQueryPluginScope | undefined>(options.readScope),
      }),
  };

  const domainWrite = {
    execute: async (
      context: unknown,
      work: (
        ctx: unknown
      ) => Promise<Result<{ kind: string; value: unknown; events?: unknown }, DomainError>>
    ) => {
      const decision = await work(context);
      if (decision.isErr()) return decision;
      const value = decision.value as {
        kind: string;
        value: IRecordUpsertResult;
        events?: ReadonlyArray<IDomainEvent>;
      };
      return ok({
        value: value.value,
        events: value.kind === 'changed' ? (value.events ?? []) : [],
        committed: true,
        directDelivery: {
          awaited: { attemptedTargets: 0, failedTargets: 0, failureCodes: [] },
          background: { scheduledTargets: 0, failedToScheduleTargets: 0 },
        },
      });
    },
    savepoint: async (_context: unknown, work: () => Promise<unknown>) => {
      savepointCalls += 1;
      return work();
    },
  };

  const upsertService = new RecordUpsertService(
    {
      find: async (_context: unknown, _table: unknown, spec: unknown) => {
        queryCalls.push(spec);
        const records = matchSequence.length > 0 ? matchSequence.shift()! : (options.matched ?? []);
        return ok({ records, total: records.length });
      },
    } as never,
    batchCreation as never,
    bulkUpdate as never,
    writePluginRunner as never,
    domainWrite as never,
    {
      appendEntry: async (...args: unknown[]) => {
        undoAppends.push(args);
        return ok(undefined);
      },
    } as never,
    { getById: async () => ok(options.table.table) } as never,
    queryPluginRunner as never
  );

  return {
    upsertService,
    get createCalls() {
      return createCalls;
    },
    get savepointCalls() {
      return savepointCalls;
    },
    updateCalls,
    undoAppends,
    afterCommitOrder,
  };
};

const baseInput = (table: BehaveTable, records: ReadonlyArray<Record<string, unknown>>) => ({
  table: table.table,
  recordsFieldValues: records.map((fields) => new Map(Object.entries(fields))),
  matchFieldId: table.keyFieldId,
  onConflict: 'ignore' as const,
  fieldKeyType: FieldKeyType.Id,
  typecast: false,
});

const context = { actorId: undefined, windowId: 'window-upsert' } as never;

describe('RecordUpsertService behaviours', () => {
  it('rejects duplicate match values inside one request', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({ table });

    const result = await harness.upsertService.upsert(
      context,
      baseInput(table, [{ [table.keyFieldId]: 'dup' }, { [table.keyFieldId]: 'dup' }])
    );

    expect(result.isErr() && result.error.code).toBe('record.upsert.duplicate_key_in_batch');
    expect(harness.createCalls).toBe(0);
    expect(harness.undoAppends).toHaveLength(0);
  });

  it('rejects a match field that is not unique', async () => {
    const table = buildUpsertTable(false);
    const harness = createHarness({ table });

    const result = await harness.upsertService.upsert(
      context,
      baseInput(table, [{ [table.keyFieldId]: 'k1' }])
    );

    expect(result.isErr() && result.error.code).toBe('record.upsert.match_field_not_unique');
  });

  it('rejects a row without a match value', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({ table });

    const result = await harness.upsertService.upsert(
      context,
      baseInput(table, [{ [table.titleFieldId]: 'no key' }])
    );

    expect(result.isErr() && result.error.code).toBe('record.upsert.match_value_required');
  });

  it('skips matched rows in ignore mode without creating or updating', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({
      table,
      matched: [matchedRow(table, recordA, 'k1')],
    });

    const result = await harness.upsertService.upsert(
      context,
      baseInput(table, [{ [table.keyFieldId]: 'k1', [table.titleFieldId]: 'ignored' }])
    );

    const value = result._unsafeUnwrap();
    expect(value.results).toMatchObject([{ index: 0, status: 'skipped', recordId: recordA }]);
    expect(harness.createCalls).toBe(0);
    expect(harness.updateCalls).toHaveLength(0);
    expect(harness.undoAppends).toHaveLength(0);
  });

  it('skips matched rows outside the write record spec', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({
      table,
      matched: [matchedRow(table, recordA, 'k1')],
      writeRecordSpec: recordSpec(() => false),
    });

    const result = await harness.upsertService.upsert(context, {
      ...baseInput(table, [{ [table.keyFieldId]: 'k1' }]),
      onConflict: 'update',
    });

    const value = result._unsafeUnwrap();
    expect(value.results).toMatchObject([{ index: 0, status: 'skipped', recordId: recordA }]);
    expect(harness.updateCalls).toHaveLength(0);
  });

  it('reports updated vs unchanged from the update branch', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({
      table,
      matched: [matchedRow(table, recordA, 'k1')],
      updateResult: {
        updatedCount: 1,
        events: [],
        records: [buildRecord(recordA)],
        changedRecordIds: [{ toString: () => recordA } as never],
        undoCommands: undoCommands(table.table.id().toString()),
        redoCommands: redoCommands(table.table.id().toString()),
        afterCommit: async () => {},
      },
    });

    const changed = await harness.upsertService.upsert(context, {
      ...baseInput(table, [{ [table.keyFieldId]: 'k1', [table.titleFieldId]: 'next' }]),
      onConflict: 'update',
    });
    expect(changed._unsafeUnwrap().results).toMatchObject([
      { index: 0, status: 'updated', recordId: recordA },
    ]);
    expect(harness.updateCalls[0]?.records[0]?.fieldValues.get(table.titleFieldId)).toBe('next');
    expect(harness.updateCalls[0]?.records[0]?.fieldValues.has(table.keyFieldId)).toBe(true);

    const unchangedHarness = createHarness({
      table,
      matched: [matchedRow(table, recordA, 'k1')],
      updateResult: {
        updatedCount: 0,
        events: [],
        records: [],
        changedRecordIds: [],
        undoCommands: [],
        redoCommands: [],
        afterCommit: async () => {},
      },
    });
    const unchanged = await unchangedHarness.upsertService.upsert(context, {
      ...baseInput(table, [{ [table.keyFieldId]: 'k1' }]),
      onConflict: 'update',
    });
    expect(unchanged._unsafeUnwrap().results).toMatchObject([
      { index: 0, status: 'unchanged', recordId: recordA },
    ]);
    expect(unchangedHarness.undoAppends).toHaveLength(0);
  });

  it('retries the create branch after a match-key unique violation and keeps one undo entry', async () => {
    const table = buildUpsertTable();
    const createdA = createdRecord(table, recordA, 'k1');
    const uniqueError = domainError.validation({
      code: 'validation.field.unique',
      message: 'duplicate',
      details: { fieldId: table.keyFieldId },
    });

    // First attempt fails with the match-key unique violation; the retry then
    // re-matches and succeeds.

    const sequenceHarness = createHarness({
      table,
      createResults: [
        err<IRecordBatchCreationResult, DomainError>(uniqueError),
        ok<IRecordBatchCreationResult, DomainError>({
          records: [createdA],
          events: [{ name: { toString: () => 'RecordCreated' } } as IDomainEvent],
          fieldKeyMapping: new Map(),
          undoCommands: undoCommands(table.table.id().toString()),
          redoCommands: redoCommands(table.table.id().toString()),
          afterCommit: async () => {},
        }),
      ],
      matched: [],
    });

    const result = await sequenceHarness.upsertService.upsert(
      context,
      baseInput(table, [{ [table.keyFieldId]: 'k1' }])
    );

    expect(result.isOk()).toBe(true);
    expect(sequenceHarness.savepointCalls).toBe(2);
    expect(sequenceHarness.undoAppends).toHaveLength(1);
    expect(result._unsafeUnwrap().results).toMatchObject([
      { index: 0, status: 'created', recordId: recordA },
    ]);
  });

  it('re-matches after a unique violation and skips the concurrent winner (ignore)', async () => {
    const table = buildUpsertTable();
    const uniqueError = domainError.validation({
      code: 'validation.field.unique',
      message: 'duplicate',
      details: { fieldId: table.keyFieldId },
    });
    const harness = createHarness({
      table,
      // First read misses, the retry sees the row another writer committed.
      matchedSequence: [[], [matchedRow(table, recordA, 'k1')]],
      createResults: [err<IRecordBatchCreationResult, DomainError>(uniqueError)],
    });

    const result = await harness.upsertService.upsert(
      context,
      baseInput(table, [{ [table.keyFieldId]: 'k1' }])
    );

    expect(result._unsafeUnwrap().results).toMatchObject([
      { index: 0, status: 'skipped', recordId: recordA },
    ]);
    expect(harness.createCalls).toBe(1);
    expect(harness.savepointCalls).toBe(1);
    expect(harness.updateCalls).toHaveLength(0);
    expect(harness.undoAppends).toHaveLength(0);
  });

  it('re-matches after a unique violation and updates the concurrent winner', async () => {
    const table = buildUpsertTable();
    const uniqueError = domainError.validation({
      code: 'validation.field.unique',
      message: 'duplicate',
      details: { fieldId: table.keyFieldId },
    });
    const harness = createHarness({
      table,
      matchedSequence: [[], [matchedRow(table, recordA, 'k1')]],
      createResults: [err<IRecordBatchCreationResult, DomainError>(uniqueError)],
      updateResult: {
        updatedCount: 1,
        events: [],
        records: [buildRecord(recordA)],
        changedRecordIds: [{ toString: () => recordA } as never],
        undoCommands: undoCommands(table.table.id().toString()),
        redoCommands: redoCommands(table.table.id().toString()),
        afterCommit: async () => {},
      },
    });

    const result = await harness.upsertService.upsert(context, {
      ...baseInput(table, [{ [table.keyFieldId]: 'k1', [table.titleFieldId]: 'next' }]),
      onConflict: 'update',
    });

    expect(result._unsafeUnwrap().results).toMatchObject([
      { index: 0, status: 'updated', recordId: recordA },
    ]);
    expect(harness.createCalls).toBe(1);
    expect(harness.updateCalls).toHaveLength(1);
    expect(harness.undoAppends).toHaveLength(1);
  });

  it('bounds the create retry loop at two retries', async () => {
    const table = buildUpsertTable();
    const uniqueError = () =>
      domainError.validation({
        code: 'validation.field.unique',
        message: 'duplicate',
        details: { fieldId: table.keyFieldId },
      });
    const harness = createHarness({
      table,
      createResults: [
        err<IRecordBatchCreationResult, DomainError>(uniqueError()),
        err<IRecordBatchCreationResult, DomainError>(uniqueError()),
        err<IRecordBatchCreationResult, DomainError>(uniqueError()),
      ],
    });

    const result = await harness.upsertService.upsert(
      context,
      baseInput(table, [{ [table.keyFieldId]: 'k1' }])
    );

    expect(result.isErr() && result.error.code).toBe('validation.field.unique');
    expect(harness.savepointCalls).toBe(3);
    expect(harness.undoAppends).toHaveLength(0);
  });

  it('emits only the successful attempt events after a retried create', async () => {
    const table = buildUpsertTable();
    const uniqueError = domainError.validation({
      code: 'validation.field.unique',
      message: 'duplicate',
      details: { fieldId: table.keyFieldId },
    });
    const eventName = (name: string) => ({ name: { toString: () => name } }) as IDomainEvent;
    const harness = createHarness({
      table,
      matchedSequence: [[], []],
      createResults: [
        err<IRecordBatchCreationResult, DomainError>(uniqueError),
        ok<IRecordBatchCreationResult, DomainError>({
          records: [createdRecord(table, recordA, 'k1')],
          events: [eventName('RecordCreated')],
          fieldKeyMapping: new Map(),
          undoCommands: undoCommands(table.table.id().toString()),
          redoCommands: redoCommands(table.table.id().toString()),
          afterCommit: async () => {},
        }),
      ],
    });

    const result = await harness.upsertService.upsert(
      context,
      baseInput(table, [{ [table.keyFieldId]: 'k1' }])
    );

    const events = result._unsafeUnwrap().events;
    expect(events).toHaveLength(1);
    expect(events[0]?.name.toString()).toBe('RecordCreated');
  });

  it('fails with a conflict in error mode when a key already exists', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({ table, matched: [matchedRow(table, recordA, 'k1')] });

    const result = await harness.upsertService.upsert(context, {
      ...baseInput(table, [{ [table.keyFieldId]: 'k1' }]),
      onConflict: 'error',
    });

    expect(result.isErr() && result.error.code).toBe('record.upsert.conflict');
    expect(harness.createCalls).toBe(0);
    expect(harness.updateCalls).toHaveLength(0);
    expect(harness.undoAppends).toHaveLength(0);
  });

  it('fails when the create branch returns the wrong number of records', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({
      table,
      createResults: [
        ok<IRecordBatchCreationResult, DomainError>({
          records: [],
          events: [],
          fieldKeyMapping: new Map(),
          undoCommands: [],
          redoCommands: [],
          afterCommit: async () => {},
        }),
      ],
    });

    const result = await harness.upsertService.upsert(
      context,
      baseInput(table, [{ [table.keyFieldId]: 'k1' }])
    );

    expect(result.isErr() && result.error.code).toBe('record.upsert.created_count_mismatch');
  });

  it('runs afterCommit handlers for both branches after a mixed batch', async () => {
    const table = buildUpsertTable();
    const createdRecordEntity = createdRecord(table, recordB, 'k2');
    const harness = createHarness({
      table,
      matched: [matchedRow(table, recordA, 'k1')],
      createRecords: [[createdRecordEntity]],
      updateResult: {
        updatedCount: 1,
        events: [],
        records: [],
        changedRecordIds: [{ toString: () => recordA } as never],
        undoCommands: undoCommands(table.table.id().toString()),
        redoCommands: redoCommands(table.table.id().toString()),
        afterCommit: async () => {},
      },
    });

    const result = await harness.upsertService.upsert(context, {
      ...baseInput(table, [{ [table.keyFieldId]: 'k1' }, { [table.keyFieldId]: 'k2' }]),
      onConflict: 'update',
    });

    expect(result._unsafeUnwrap().results.map((row) => row.status)).toEqual(['updated', 'created']);
    expect(harness.afterCommitOrder).toEqual(expect.arrayContaining(['write', 'update', 'create']));
    expect(harness.undoAppends).toHaveLength(1);
    expect(harness.savepointCalls).toBe(1);
  });

  it('drops the row id and record from the response when the read row spec excludes it', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({
      table,
      matched: [matchedRow(table, recordA, 'k1')],
      readScope: { recordSpec: recordSpec(() => false) },
      updateResult: {
        updatedCount: 1,
        events: [],
        records: [matchedEntity(table, recordA, 'k1')],
        changedRecordIds: [{ toString: () => recordA } as never],
        undoCommands: [],
        redoCommands: [],
        afterCommit: async () => {},
      },
    });

    const result = await harness.upsertService.upsert(context, {
      ...baseInput(table, [{ [table.keyFieldId]: 'k1', [table.titleFieldId]: 'next' }]),
      onConflict: 'update',
    });

    // The write still happened; only the response loses the hidden row.
    expect(harness.updateCalls).toHaveLength(1);
    expect(result._unsafeUnwrap().results).toEqual([{ index: 0, status: 'updated' }]);
  });

  it('keeps the id but strips fields outside the read allow-list and masks', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({
      table,
      matched: [matchedRow(table, recordA, 'k1')],
      readScope: {
        readableFieldIds: new Set([table.keyFieldId, table.titleFieldId]),
        fieldMasks: [{ fieldId: table.titleFieldId, visibleWhen: recordSpec(() => false) }],
      },
      updateResult: {
        updatedCount: 1,
        events: [],
        records: [matchedEntity(table, recordA, 'k1')],
        changedRecordIds: [{ toString: () => recordA } as never],
        undoCommands: [],
        redoCommands: [],
        afterCommit: async () => {},
      },
    });

    const result = await harness.upsertService.upsert(context, {
      ...baseInput(table, [{ [table.keyFieldId]: 'k1' }]),
      onConflict: 'update',
    });

    const row = result._unsafeUnwrap().results[0]!;
    expect(row.recordId).toBe(recordA);
    const fieldIds = row.record
      ?.fields()
      .entries()
      .map((entry) => entry.fieldId.toString());
    expect(fieldIds).toEqual([table.keyFieldId]);
  });

  it('gates created rows through the same read scope', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({
      table,
      createRecords: [[createdRecord(table, recordB, 'k2')]],
      readScope: { recordSpec: recordSpec((record) => record.id().toString() !== recordB) },
    });

    const result = await harness.upsertService.upsert(
      context,
      baseInput(table, [{ [table.keyFieldId]: 'k2' }])
    );

    expect(result._unsafeUnwrap().results).toEqual([{ index: 0, status: 'created' }]);
  });
});
