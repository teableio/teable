import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { DomainEventName } from '../../domain/shared/DomainEventName';
import { OccurredAt } from '../../domain/shared/OccurredAt';
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
import { domainWrite } from '../../ports/DomainWriteTransaction';
import type { IEventBus } from '../../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import { EventBusDomainWriteTransaction } from '../../ports/memory/EventBusDomainWriteTransaction';
import type { RecordQueryPluginScope } from '../../ports/RecordQueryPlugin';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type { RecordActorAttribution } from '../../ports/TableRecordRepository';
import {
  createTableSchemaCoordinationLease,
  type ITableSchemaCoordination,
} from '../../ports/TableSchemaCoordination';
import { createUndoRedoCommand } from '../../ports/UndoRedoStore';
import type { IUnitOfWork, UnitOfWorkOperation } from '../../ports/UnitOfWork';
import type { IRecordBatchCreationResult } from './RecordBatchCreationService';
import type { IRecordBulkUpdateTransactionResult } from './RecordBulkUpdateService';
import {
  applyUpsertReadScope,
  RecordUpsertService,
  type IRecordUpsertResult,
  type IRecordUpsertRowResult,
} from './RecordUpsertService';
import { NoopSameTxProjectionDispatcher } from './SameTxProjectionDispatcher';

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
  createdByActorType: null,
  createdByActorId: null,
  lastModifiedByActorType: null,
  lastModifiedByActorId: null,
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
  readonly loadTable?: () => Table;
  readonly coordination?: ITableSchemaCoordination;
  readonly writeAfterCommitError?: Error;
  readonly updateAfterCommitError?: Error;
};

const createHarness = (options: HarnessOptions) => {
  const queryCalls: unknown[] = [];
  const updateCalls: Array<{
    records: ReadonlyArray<{ fieldValues: ReadonlyMap<string, unknown> }>;
  }> = [];
  const undoAppends: unknown[] = [];
  const afterCommitOrder: string[] = [];
  const mutationOrder: string[] = [];
  const savepointContexts: IExecutionContext[] = [];
  const creationContexts: IExecutionContext[] = [];
  const creationSizes: number[] = [];
  let savepointCalls = 0;
  let createCalls = 0;
  const createTables: Table[] = [];

  const createQueue = [...(options.createResults ?? [])];
  const matchSequence = [...(options.matchedSequence ?? [])];
  const createRecordQueue = [...(options.createRecords ?? [])];

  const batchCreation = {
    create: async (
      creationContext: IExecutionContext,
      input: { table: Table; recordsFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>> }
    ) => {
      createTables.push(input.table);
      creationContexts.push(creationContext);
      creationSizes.push(input.recordsFieldValues.length);
      mutationOrder.push('create');
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
      mutationOrder.push('update');
      if (options.updateResult) {
        return ok<IRecordBulkUpdateTransactionResult, DomainError>({
          ...options.updateResult,
          afterCommit: async () => {
            afterCommitOrder.push('update');
            if (options.updateAfterCommitError) {
              throw options.updateAfterCommitError;
            }
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
          if (options.updateAfterCommitError) {
            throw options.updateAfterCommitError;
          }
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
          if (options.writeAfterCommitError) {
            throw options.writeAfterCommitError;
          }
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
        status: 'committed' as const,
        value: value.value,
        events: value.kind === 'changed' ? (value.events ?? []) : [],
        committed: true,
        directDelivery: {
          awaited: { attemptedTargets: 0, failedTargets: 0, failureCodes: [] },
          background: { scheduledTargets: 0, failedToScheduleTargets: 0 },
        },
      });
    },
    savepoint: async (
      parentContext: IExecutionContext,
      work: (childContext: IExecutionContext) => Promise<unknown>
    ) => {
      savepointCalls += 1;
      const childContext = { ...parentContext };
      savepointContexts.push(childContext);
      return work(childContext);
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
    { getById: async () => ok(options.loadTable?.() ?? options.table.table) } as never,
    queryPluginRunner as never,
    options.coordination
  );

  return {
    upsertService,
    createTables,
    get createCalls() {
      return createCalls;
    },
    get savepointCalls() {
      return savepointCalls;
    },
    updateCalls,
    queryCalls,
    undoAppends,
    afterCommitOrder,
    mutationOrder,
    savepointContexts,
    creationContexts,
    creationSizes,
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
  it.each([0, 1])(
    'uses the actual leased upsert capability %s instead of the caller snapshot',
    async (version) => {
      const stale = buildUpsertTable();
      const fresh = V2Table.rehydrate({
        id: stale.table.id(),
        baseId: stale.table.baseId(),
        name: stale.table.name(),
        fields: stale.table.getFields(),
        primaryFieldId: stale.table.primaryFieldId(),
        views: stale.table.views(),
        actorStorageVersion: version,
      })._unsafeUnwrap();
      let leased = false;
      const harness = createHarness({
        table: stale,
        createRecords: [
          [createdRecord(stale, recordB, 'k2')],
          [createdRecord(stale, recordA, 'k3')],
        ],
        loadTable: () => {
          expect(leased).toBe(true);
          return fresh;
        },
        coordination: {
          acquire: async (_context, ids, mode) => {
            leased = true;
            return ok(
              createTableSchemaCoordinationLease(mode, ids, async () => {
                leased = false;
              })
            );
          },
        },
      });
      const native = await harness.upsertService.upsert(
        { actorId: ActorId.create('robot')._unsafeUnwrap() },
        baseInput(stale, [{ [stale.keyFieldId]: 'k2' }])
      );
      expect(native.isOk()).toBe(true);
      expect(harness.createTables[0]?.actorStorageVersion()).toBe(version);
      expect(leased).toBe(false);
      const beforeAppCreates = harness.createCalls;
      const app = await harness.upsertService.upsert(
        {
          actorId: ActorId.create('robot')._unsafeUnwrap(),
          initiator: { type: 'appUser', id: 'apu_verified' },
          requireActorStorage: true,
        },
        baseInput(stale, [{ [stale.keyFieldId]: 'k3' }])
      );
      if (version === 0) {
        expect(app._unsafeUnwrapErr().code).toBe('actor_storage.not_enabled');
        expect(harness.createCalls).toBe(beforeAppCreates);
      } else {
        expect(app.isOk()).toBe(true);
      }
      expect(leased).toBe(false);
    }
  );

  it.each([true, false])(
    'keeps persistence actors for updated=%s without re-reading rows',
    async (changed) => {
      const table = buildUpsertTable();
      const actors: RecordActorAttribution = {
        createdByActorType: 'appUser',
        createdByActorId: 'apu_creator',
        lastModifiedByActorType: 'user',
        lastModifiedByActorId: 'usr_last',
      };
      const harness = createHarness({
        table,
        matched: [matchedRow(table, recordA, 'k1')],
        updateResult: {
          updatedCount: changed ? 1 : 0,
          events: [],
          records: [buildRecord(recordA)],
          changedRecordIds: changed ? [{ toString: () => recordA } as never] : [],
          recordActorsByRecord: new Map([[recordA, actors]]),
          undoCommands: [],
          redoCommands: [],
          afterCommit: async () => {},
        },
      });
      const result = (
        await harness.upsertService.upsert(context, {
          ...baseInput(table, [{ [table.keyFieldId]: 'k1', [table.titleFieldId]: 'next' }]),
          onConflict: 'update',
        })
      )._unsafeUnwrap();

      expect(result.results[0]?.status).toBe(changed ? 'updated' : 'unchanged');
      expect(result.results[0]?.recordActors).toEqual(actors);
      expect(result.recordActorsByRecord?.get(recordA)).toEqual(actors);
      expect(harness.queryCalls).toHaveLength(1);
    }
  );

  it('does not disclose stored actors when the read scope hides the upsert row', async () => {
    const table = buildUpsertTable();
    const matched = {
      ...matchedRow(table, recordA, 'k1'),
      createdByActorType: 'appUser' as const,
      createdByActorId: 'apu_private',
    };
    const harness = createHarness({
      table,
      matched: [matched],
      readScope: { recordSpec: recordSpec(() => false) },
    });
    const result = (
      await harness.upsertService.upsert(context, {
        ...baseInput(table, [{ [table.keyFieldId]: 'k1' }]),
        onConflict: 'ignore',
      })
    )._unsafeUnwrap();

    expect(result.results).toEqual([{ index: 0, status: 'skipped' }]);
    expect(result.recordActorsByRecord?.size).toBe(0);
  });

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

  it('finishes concrete creates and race reclassification before one ordered update stage', async () => {
    const table = buildUpsertTable();
    const recordC = `rec${'c'.repeat(16)}`;
    const uniqueError = domainError.validation({
      code: 'validation.field.unique',
      message: 'duplicate',
      details: { fieldId: table.keyFieldId },
    });
    const harness = createHarness({
      table,
      matchedSequence: [
        [matchedRow(table, recordA, 'existing')],
        [matchedRow(table, recordB, 'raced')],
      ],
      createResults: [
        err<IRecordBatchCreationResult, DomainError>(uniqueError),
        ok<IRecordBatchCreationResult, DomainError>({
          records: [createdRecord(table, recordC, 'new')],
          events: [],
          fieldKeyMapping: new Map(),
          undoCommands: [],
          redoCommands: [],
          afterCommit: async () => {},
        }),
      ],
      updateResult: {
        updatedCount: 2,
        events: [],
        records: [
          matchedEntity(table, recordA, 'existing'),
          matchedEntity(table, recordB, 'raced'),
        ],
        changedRecordIds: [recordA, recordB].map((id) => ({ toString: () => id }) as never),
        undoCommands: [],
        redoCommands: [],
        afterCommit: async () => {},
      },
    });

    const result = await harness.upsertService.upsert(context, {
      ...baseInput(
        table,
        ['raced', 'existing', 'new'].map((key) => ({
          [table.keyFieldId]: key,
          [table.titleFieldId]: key,
        }))
      ),
      onConflict: 'update',
    });

    expect(result._unsafeUnwrap().results).toMatchObject([
      { index: 0, status: 'updated', recordId: recordB },
      { index: 1, status: 'updated', recordId: recordA },
      { index: 2, status: 'created', recordId: recordC },
    ]);
    expect(harness.mutationOrder).toEqual(['create', 'create', 'update']);
    expect(harness.updateCalls).toHaveLength(1);
    expect(harness.creationSizes).toEqual([2, 1]);
    expect(
      harness.updateCalls[0]!.records.map((record) => record.fieldValues.get(table.keyFieldId))
    ).toEqual(['raced', 'existing']);
    expect(harness.creationContexts[0]).toBe(harness.savepointContexts[0]);
    expect(harness.creationContexts[1]).toBe(harness.savepointContexts[1]);
    expect(harness.creationContexts[0]).not.toBe(context);
    expect(harness.creationContexts[1]).not.toBe(harness.creationContexts[0]);
  });

  it('does not update matched rows when concrete create admission fails', async () => {
    const table = buildUpsertTable();
    const denied = domainError.forbidden({ message: 'row limit exceeded' });
    const harness = createHarness({
      table,
      matched: [matchedRow(table, recordA, 'existing')],
      createResults: [err<IRecordBatchCreationResult, DomainError>(denied)],
    });

    const result = await harness.upsertService.upsert(context, {
      ...baseInput(
        table,
        ['existing', 'new'].map((key) => ({ [table.keyFieldId]: key }))
      ),
      onConflict: 'update',
    });

    expect(result.isErr() && result.error).toBe(denied);
    expect(harness.mutationOrder).toEqual(['create']);
    expect(harness.updateCalls).toHaveLength(0);
    expect(harness.undoAppends).toHaveLength(0);
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
  it('rejects an unreadable non-unique match field before metadata validation or writes', async () => {
    const table = buildUpsertTable(false);
    const harness = createHarness({
      table,
      readScope: { readableFieldIds: new Set() },
    });
    const result = await harness.upsertService.upsert(
      context,
      baseInput(table, [
        {
          [table.keyFieldId]: 'secret',
        },
      ])
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('record.upsert.match_field_not_readable');
      expect(result.error.tags).toContain('forbidden');
    }
    expect(harness.createCalls).toBe(0);
    expect(harness.updateCalls).toHaveLength(0);
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

  it('commits outer withBatchTransaction when an inner savepoint unique violation triggers retry via update', async () => {
    const upsertTable = buildUpsertTable();
    const afterCommitOrder: string[] = [];
    const publishedEvents: string[] = [];
    const undoAppends: unknown[] = [];

    class SiblingEvent implements IDomainEvent {
      readonly name = DomainEventName.recordCreated();
      readonly occurredAt = OccurredAt.now();
    }

    const fakeUnitOfWork: IUnitOfWork & { commits: number; rollbacks: number } = {
      commits: 0,
      rollbacks: 0,
      async withTransaction<T>(
        ctx: IExecutionContext,
        work: UnitOfWorkOperation<T>
      ): Promise<Result<T, DomainError>> {
        if (ctx.transaction) {
          return work(ctx);
        }
        const tx: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction', scope: 'data' };
        const res = await work({
          ...ctx,
          transaction: tx,
          transactions: { data: tx, meta: tx },
        });
        if (res.isOk()) {
          this.commits += 1;
        } else {
          this.rollbacks += 1;
        }
        return res;
      },
      async savepoint<T>(
        ctx: IExecutionContext,
        work: UnitOfWorkOperation<T>
      ): Promise<Result<T, DomainError>> {
        return work(ctx);
      },
    };

    const eventBus: IEventBus = {
      async publish(_ctx, event) {
        publishedEvents.push(event.name.toString());
        return ok(undefined);
      },
      async publishMany(_ctx, events) {
        for (const e of events) publishedEvents.push(e.name.toString());
        return ok(undefined);
      },
    };

    const realDomainWriteTx = new EventBusDomainWriteTransaction(
      fakeUnitOfWork,
      eventBus,
      new NoopSameTxProjectionDispatcher()
    );

    const matchSequence: Array<ReadonlyArray<TableRecordReadModel>> = [
      [],
      [matchedRow(upsertTable, recordA, 'k1')],
    ];
    const uniqueErr = domainError.validation({
      code: 'validation.field.unique',
      message: 'duplicate',
      details: { fieldId: upsertTable.keyFieldId },
    });

    const upsertService = new RecordUpsertService(
      {
        find: async () => {
          const rows = matchSequence.shift() ?? [];
          return ok({ records: rows, total: rows.length });
        },
      } as never,
      {
        // Mirrors an inner transaction-bound table update/insert failing on unique violation inside savepoint
        create: async (txCtx: IExecutionContext) =>
          realDomainWriteTx.execute(txCtx, async () => err(uniqueErr)),
      } as never,
      {
        updateWithinTransaction: async () =>
          ok<IRecordBulkUpdateTransactionResult, DomainError>({
            updatedCount: 1,
            events: [
              {
                name: DomainEventName.recordsBatchUpdated(),
                occurredAt: OccurredAt.now(),
              } as IDomainEvent,
            ],
            records: [buildRecord(recordA)],
            changedRecordIds: [{ toString: () => recordA } as never],
            undoCommands: undoCommands(upsertTable.table.id().toString()),
            redoCommands: redoCommands(upsertTable.table.id().toString()),
            afterCommit: async () => {
              afterCommitOrder.push('update');
            },
          }),
      } as never,
      {
        prepare: async () =>
          ok({
            guard: async () => ok(undefined),
            getRecordSpec: () => ok(undefined),
            afterCommit: async () => {
              afterCommitOrder.push('write');
            },
          }),
      } as never,
      realDomainWriteTx,
      {
        appendEntry: async (...args: unknown[]) => {
          undoAppends.push(args);
          return ok(undefined);
        },
      } as never,
      { getById: async () => ok(upsertTable.table) } as never,
      {
        prepare: async () =>
          ok({
            guard: async () => ok(undefined),
            getScope: () => ok(undefined),
          }),
      } as never
    );

    const rootCtx: IExecutionContext = {
      actorId: ActorId.create('usrUpsertBatch')._unsafeUnwrap(),
    };
    const batchResult = await realDomainWriteTx.withBatchTransaction(rootCtx, async (batchCtx) => {
      const sibling = await realDomainWriteTx.execute(batchCtx, async () =>
        ok(domainWrite.changed('sibling', [new SiblingEvent()]))
      );
      if (sibling.isErr()) return err(sibling.error);

      const upsertRes = await upsertService.upsert(batchCtx, {
        ...baseInput(upsertTable, [
          { [upsertTable.keyFieldId]: 'k1', [upsertTable.titleFieldId]: 'v2' },
        ]),
        onConflict: 'update',
      });
      if (upsertRes.isErr()) return err(upsertRes.error);

      // Post-commit hooks & event publishing must remain deferred until the outer batch commits
      expect(afterCommitOrder).toEqual([]);
      expect(publishedEvents).toEqual([]);
      return upsertRes;
    });

    expect(batchResult.isOk()).toBe(true);
    expect(batchResult._unsafeUnwrap().results).toMatchObject([
      { index: 0, status: 'updated', recordId: recordA },
    ]);
    expect(fakeUnitOfWork.commits).toBe(1);
    expect(fakeUnitOfWork.rollbacks).toBe(0);
    expect(afterCommitOrder).toEqual(['write', 'update']);
    expect(publishedEvents).toEqual(['RecordCreated', 'RecordsBatchUpdated']);
    expect(undoAppends).toHaveLength(1);
  });

  it('isolates throwing afterCommit handlers in withBatchTransaction so remaining upsert callbacks still run and caller receives ok', async () => {
    const upsertTable = buildUpsertTable();
    const afterCommitOrder: string[] = [];
    const publishedEvents: string[] = [];

    const fakeUnitOfWork: IUnitOfWork = {
      async withTransaction<T>(
        ctx: IExecutionContext,
        work: UnitOfWorkOperation<T>
      ): Promise<Result<T, DomainError>> {
        if (ctx.transaction) {
          return work(ctx);
        }
        const tx: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction', scope: 'data' };
        return work({ ...ctx, transaction: tx, transactions: { data: tx, meta: tx } });
      },
      async savepoint<T>(
        ctx: IExecutionContext,
        work: UnitOfWorkOperation<T>
      ): Promise<Result<T, DomainError>> {
        return work(ctx);
      },
    };

    const eventBus: IEventBus = {
      async publish(_ctx, event) {
        publishedEvents.push(event.name.toString());
        return ok(undefined);
      },
      async publishMany(_ctx, events) {
        for (const e of events) publishedEvents.push(e.name.toString());
        return ok(undefined);
      },
    };

    const realDomainWriteTx = new EventBusDomainWriteTransaction(
      fakeUnitOfWork,
      eventBus,
      new NoopSameTxProjectionDispatcher()
    );

    const upsertService = new RecordUpsertService(
      {
        find: async () => ok({ records: [matchedRow(upsertTable, recordA, 'k1')], total: 1 }),
      } as never,
      {
        create: async () =>
          ok<IRecordBatchCreationResult, DomainError>({
            records: [createdRecord(upsertTable, recordB, 'k2')],
            events: [
              {
                name: DomainEventName.recordCreated(),
                occurredAt: OccurredAt.now(),
              } as IDomainEvent,
            ],
            fieldKeyMapping: new Map(),
            undoCommands: [],
            redoCommands: [],
            afterCommit: async () => {
              afterCommitOrder.push('second-plan-handler-ran');
            },
          }),
      } as never,
      {
        updateWithinTransaction: async () =>
          ok<IRecordBulkUpdateTransactionResult, DomainError>({
            updatedCount: 1,
            events: [],
            records: [buildRecord(recordA)],
            changedRecordIds: [{ toString: () => recordA } as never],
            undoCommands: [],
            redoCommands: [],
            afterCommit: async () => {
              afterCommitOrder.push('update-throws');
              throw new Error('first plan handler boom');
            },
          }),
      } as never,
      {
        prepare: async () =>
          ok({
            guard: async () => ok(undefined),
            getRecordSpec: () => ok(undefined),
            afterCommit: async () => {
              afterCommitOrder.push('write-throws');
              throw new Error('plugin afterCommit boom');
            },
          }),
      } as never,
      realDomainWriteTx,
      { appendEntry: async () => ok(undefined) } as never,
      { getById: async () => ok(upsertTable.table) } as never,
      {
        prepare: async () =>
          ok({
            guard: async () => ok(undefined),
            getScope: () => ok(undefined),
          }),
      } as never
    );

    const rootCtx: IExecutionContext = {
      actorId: ActorId.create('usrUpsertIsolated')._unsafeUnwrap(),
    };
    const batchResult = await realDomainWriteTx.withBatchTransaction(rootCtx, async (batchCtx) =>
      upsertService.upsert(batchCtx, {
        ...baseInput(upsertTable, [
          { [upsertTable.keyFieldId]: 'k1' },
          { [upsertTable.keyFieldId]: 'k2' },
        ]),
        onConflict: 'update',
      })
    );

    expect(batchResult.isOk()).toBe(true);
    expect(batchResult._unsafeUnwrap().results.map((r) => r.status)).toEqual([
      'updated',
      'created',
    ]);
    // Isolation requires every callback exactly once, not a particular create/update schedule.
    expect(afterCommitOrder.sort()).toEqual([
      'second-plan-handler-ran',
      'update-throws',
      'write-throws',
    ]);
    expect(publishedEvents).toEqual(['RecordCreated']);
  });

  it('isolates throwing afterCommit handlers in standalone upsert so remaining callbacks still run and committed result stays ok', async () => {
    const table = buildUpsertTable();
    const harness = createHarness({
      table,
      matched: [matchedRow(table, recordA, 'k1')],
      createRecords: [[createdRecord(table, recordB, 'k2')]],
      writeAfterCommitError: new Error('plugin afterCommit boom'),
      updateAfterCommitError: new Error('first plan handler boom'),
      updateResult: {
        updatedCount: 1,
        events: [],
        records: [buildRecord(recordA)],
        changedRecordIds: [{ toString: () => recordA } as never],
        undoCommands: [],
        redoCommands: [],
        afterCommit: async () => {},
      },
    });

    const result = await harness.upsertService.upsert(context, {
      ...baseInput(table, [{ [table.keyFieldId]: 'k1' }, { [table.keyFieldId]: 'k2' }]),
      onConflict: 'update',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results.map((r) => r.status)).toEqual(['updated', 'created']);
    expect(harness.afterCommitOrder.sort()).toEqual(['create', 'update', 'write']);
  });
});
