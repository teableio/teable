import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import {
  createRecordWritePluginRunner,
  createTrackedRecordWritePlugin,
} from '../../commands/recordWritePluginRunnerTestUtils';
import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { isRecordsBatchCreatedEvent } from '../../domain/table/events/RecordsBatchCreated';
import { DbFieldName } from '../../domain/table/fields/DbFieldName';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { FieldName } from '../../domain/table/fields/FieldName';
import { SelectOption } from '../../domain/table/fields/types/SelectOption';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import { Table } from '../../domain/table/Table';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../../ports/RecordWritePlugin';
import type {
  BatchRecordMutationResult,
  ITableRecordRepository,
  RecordMutationResult,
  RecordStoredSnapshot,
} from '../../ports/TableRecordRepository';
import { RecordBatchCreationService } from './RecordBatchCreationService';
import type { RecordMutationSpecResolverService } from './RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from './RecordWriteSideEffectService';
import type { RecordWriteUndoRedoPlanService } from './RecordWriteUndoRedoPlanService';
import type { TableUpdateFlow } from './TableUpdateFlow';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const noopRecordWriteUndoRedoPlanService = {
  captureSelectOptionSideEffects: async () => ok({ undoCommands: [], redoCommands: [] }),
} as unknown as RecordWriteUndoRedoPlanService;

const noopTableUpdateFlow = {
  execute: async () => ok({ table: undefined, events: [] as IDomainEvent[] }),
} as unknown as TableUpdateFlow;

const noopRecordMutationSpecResolver = {
  resolveCreatedRecords: async (
    ...[, , input]: Parameters<RecordMutationSpecResolverService['resolveCreatedRecords']>
  ) => ok(input),
} as unknown as RecordMutationSpecResolverService;

const noopRecordChangedValueDecoratorService = {
  decorateChangedFields: async (_table: Table, changedFields?: ReadonlyMap<string, unknown>) =>
    ok(changedFields),
  decorateChangedFieldsByRecord: async (
    _table: Table,
    changedFieldsByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ) => ok(changedFieldsByRecord),
};

const buildBasicTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(baseId)
    .withName(TableName.create('Batch Create')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildNormalizationTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Batch Key Normalization')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder.field().checkbox().withName(FieldName.create('Checked')._unsafeUnwrap()).done();
  builder
    .field()
    .singleSelect()
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([SelectOption.create({ name: 'Open', color: 'blue' })._unsafeUnwrap()])
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  for (const [index, field] of table.getFields().entries()) {
    field.setDbFieldName(DbFieldName.rehydrate(`column_${index}`)._unsafeUnwrap())._unsafeUnwrap();
  }
  return table;
};

class FakeTableRecordRepository implements ITableRecordRepository {
  readonly insertedRecords: TableRecord[] = [];
  omitRecordSnapshots = false;

  constructor(
    private readonly insertManyResult: Result<BatchRecordMutationResult, DomainError> = ok({})
  ) {}

  async insert(): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(
    _context: IExecutionContext,
    _table: Table,
    records: ReadonlyArray<TableRecord>
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    if (this.insertManyResult.isOk()) {
      this.insertedRecords.push(...records);
      const recordSnapshots =
        this.insertManyResult.value.recordSnapshots ??
        (this.omitRecordSnapshots ? undefined : records.map((record) => toStoredSnapshot(record)));
      return ok({
        ...this.insertManyResult.value,
        ...(recordSnapshots ? { recordSnapshots } : {}),
      });
    }
    return this.insertManyResult;
  }

  async duplicatePhysicalRows(
    _context: any,
    _plan: any
  ): Promise<Result<{ rowCount: number; recordIds: string[] }, DomainError>> {
    return ok({ rowCount: 0, recordIds: [] });
  }

  async insertManyStream() {
    return ok({ totalInserted: 0 });
  }

  async updateOne() {
    return ok({});
  }

  async updateMany() {
    return ok({ totalUpdated: 0, updatedRecordIds: [], updatedRecords: [] });
  }

  async updateManyStream() {
    return ok({ totalUpdated: 0, updatedRecords: [] });
  }

  async deleteMany() {
    return ok({});
  }

  async deleteManyStream() {
    return ok({ totalDeleted: 0 });
  }
}

const toStoredSnapshot = (record: TableRecord): RecordStoredSnapshot => {
  const fields: Record<string, unknown> = {};
  for (const entry of record.fields().entries()) {
    fields[entry.fieldId.toString()] = entry.value.toValue();
  }

  return {
    recordId: record.id().toString(),
    fields,
  };
};

describe('RecordBatchCreationService', () => {
  it.each([FieldKeyType.Id, FieldKeyType.Name, FieldKeyType.DbFieldName])(
    'resolves every row with %s keys for each table and preserves typecast values',
    async (fieldKeyType) => {
      const recordRepository = new FakeTableRecordRepository();
      const service = new RecordBatchCreationService(
        recordRepository,
        noopRecordMutationSpecResolver,
        noopRecordChangedValueDecoratorService,
        createRecordWritePluginRunner(),
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        noopTableUpdateFlow
      );

      // Reuse the service, not the resolution context, across tables with identical keys.
      for (const table of [buildNormalizationTable(), buildNormalizationTable()]) {
        const fields = table.getFields();
        const keys = fields.map((field) =>
          fieldKeyType === FieldKeyType.Id
            ? field.id().toString()
            : fieldKeyType === FieldKeyType.Name
              ? field.name().toString()
              : field.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap()
        );
        const result = await service.create(createContext(), {
          table,
          recordsFieldValues: [
            new Map<string, unknown>([
              [keys[0], 'Alpha'],
              [keys[1], false],
              [keys[2], 'New option'],
            ]),
            new Map<string, unknown>([
              [keys[1], null],
              [keys[2], 'New option'],
            ]),
            new Map<string, unknown>([
              [keys[0], 'Beta'],
              [keys[1], true],
              [keys[2], 'Other option'],
            ]),
          ],
          fieldKeyType,
          typecast: true,
          isTransactionBound: true,
        });

        const created = result._unsafeUnwrap();
        const fieldIds = fields.map((field) => field.id().toString());
        const snapshots = created.records.map(toStoredSnapshot);
        expect(snapshots.map((snapshot) => snapshot.fields[fieldIds[1]])).toEqual([
          null,
          null,
          true,
        ]);
        expect(snapshots.map((snapshot) => snapshot.fields[fieldIds[2]])).toEqual([
          'New option',
          'New option',
          'Other option',
        ]);
        expect(snapshots[0].fields[fieldIds[0]]).toBe('Alpha');
        expect(snapshots[2].fields[fieldIds[0]]).toBe('Beta');
        expect(created.fieldKeyMapping.get(fieldIds[2])).toBe(keys[2]);
      }
    }
  );

  it.each([FieldKeyType.Name, FieldKeyType.DbFieldName])(
    'returns the first unknown %s key in a later row without inserting any rows',
    async (fieldKeyType) => {
      const table = buildNormalizationTable();
      const recordRepository = new FakeTableRecordRepository();
      const service = new RecordBatchCreationService(
        recordRepository,
        noopRecordMutationSpecResolver,
        noopRecordChangedValueDecoratorService,
        createRecordWritePluginRunner(),
        new RecordWriteSideEffectService(),
        noopRecordWriteUndoRedoPlanService,
        noopTableUpdateFlow
      );
      const keys = table
        .getFields()
        .map((field) =>
          fieldKeyType === FieldKeyType.Name
            ? field.name().toString()
            : field.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap()
        );
      const result = await service.create(createContext(), {
        table,
        recordsFieldValues: [
          new Map<string, unknown>([
            [keys[0], 'Valid row'],
            [keys[2], 'Uncommitted option'],
          ]),
          new Map<string, unknown>([
            ['Missing first', 'First error'],
            ['Missing second', 'Second error'],
          ]),
          new Map([['Missing later', 'Later error']]),
        ],
        fieldKeyType,
        typecast: true,
        isTransactionBound: true,
      });

      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'field.key_not_found',
        message: 'Field "Missing first" does not exist in this table',
        details: { fieldKeyType, fieldKey: 'Missing first', availableFieldKeys: keys },
      });
      expect(recordRepository.insertedRecords).toHaveLength(0);
    }
  );

  it('creates records and returns batch undo/redo plus deferred afterCommit', async () => {
    const table = buildBasicTable();
    const recordRepository = new FakeTableRecordRepository();
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.createMany]);
    const service = new RecordBatchCreationService(
      recordRepository,
      noopRecordMutationSpecResolver,
      noopRecordChangedValueDecoratorService,
      createRecordWritePluginRunner([plugin]),
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      noopTableUpdateFlow
    );

    const result = await service.create(createContext(), {
      table,
      recordsFieldValues: [
        new Map([[table.primaryFieldId().toString(), 'Alpha']]),
        new Map([[table.primaryFieldId().toString(), 'Beta']]),
      ],
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      isTransactionBound: true,
    });

    const created = result._unsafeUnwrap();
    expect(recordRepository.insertedRecords).toHaveLength(2);
    expect(created.records).toHaveLength(2);
    expect(created.events.some(isRecordsBatchCreatedEvent)).toBe(true);
    expect(created.undoCommands[0]?.type).toBe('DeleteRecords');
    expect(created.redoCommands.at(-1)?.type).toBe('RestoreRecords');
    expect(calls.afterCommit).toHaveLength(0);

    await created.afterCommit();

    expect(calls.prepare).toHaveLength(1);
    expect(calls.guard).toHaveLength(1);
    expect(calls.afterGuard).toHaveLength(1);
    expect(calls.beforePersist).toHaveLength(1);
    expect(calls.afterCommit).toHaveLength(1);
  });

  it('passes link-title creation provenance to every write-plugin phase', async () => {
    const table = buildBasicTable();
    const sourceTable = buildBasicTable();
    const linkTitleSource = {
      baseId: sourceTable.baseId(),
      tableId: sourceTable.id(),
      fieldId: sourceTable.primaryFieldId(),
    };
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.createMany]);
    const service = new RecordBatchCreationService(
      new FakeTableRecordRepository(),
      noopRecordMutationSpecResolver,
      noopRecordChangedValueDecoratorService,
      createRecordWritePluginRunner([plugin]),
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      noopTableUpdateFlow
    );

    const result = await service.create(createContext(), {
      table,
      recordsFieldValues: [new Map([[table.primaryFieldId().toString(), 'Missing title']])],
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      isTransactionBound: true,
      linkTitleSource,
    });

    await result._unsafeUnwrap().afterCommit();

    for (const contexts of [
      calls.prepare,
      calls.guard,
      calls.afterGuard,
      calls.beforePersist,
      calls.afterCommit,
    ]) {
      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toMatchObject({
        kind: RecordWriteOperationKind.createMany,
        payload: { linkTitleSource },
      });
      expect(contexts[0]?.table.id().equals(table.id())).toBe(true);
    }
  });

  it('surfaces repository conflicts and does not run deferred afterCommit on failure', async () => {
    const table = buildBasicTable();
    const recordRepository = new FakeTableRecordRepository(
      err(
        domainError.conflict({
          code: 'db.unique_violation',
          message: 'duplicate key value violates unique constraint',
        })
      )
    );
    const { plugin, calls } = createTrackedRecordWritePlugin([RecordWriteOperationKind.createMany]);
    const service = new RecordBatchCreationService(
      recordRepository,
      noopRecordMutationSpecResolver,
      noopRecordChangedValueDecoratorService,
      createRecordWritePluginRunner([plugin]),
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      noopTableUpdateFlow
    );

    const result = await service.create(createContext(), {
      table,
      recordsFieldValues: [new Map([[table.primaryFieldId().toString(), 'Alpha']])],
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      isTransactionBound: true,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('db.unique_violation');
    expect(recordRepository.insertedRecords).toHaveLength(0);
    expect(calls.prepare).toHaveLength(1);
    expect(calls.guard).toHaveLength(1);
    expect(calls.afterGuard).toHaveLength(1);
    expect(calls.beforePersist).toHaveLength(1);
    expect(calls.afterCommit).toHaveLength(0);
  });

  it('returns an infrastructure error when the repository omits stored snapshots', async () => {
    const table = buildBasicTable();
    const recordRepository = new FakeTableRecordRepository();
    recordRepository.omitRecordSnapshots = true;
    const service = new RecordBatchCreationService(
      recordRepository,
      noopRecordMutationSpecResolver,
      noopRecordChangedValueDecoratorService,
      createRecordWritePluginRunner(),
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      noopTableUpdateFlow
    );

    const result = await service.create(createContext(), {
      table,
      recordsFieldValues: [new Map([[table.primaryFieldId().toString(), 'Alpha']])],
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      isTransactionBound: true,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('record.stored_snapshot.unavailable');
  });

  it('stops before persistence when the createMany plugin guard rejects the batch', async () => {
    const table = buildBasicTable();
    const recordRepository = new FakeTableRecordRepository();
    const calls = {
      prepare: 0,
      guard: 0,
      beforePersist: 0,
      afterCommit: 0,
    };
    const service = new RecordBatchCreationService(
      recordRepository,
      noopRecordMutationSpecResolver,
      noopRecordChangedValueDecoratorService,
      createRecordWritePluginRunner([
        {
          name: 'guard-rejector',
          supports(operation) {
            return operation === RecordWriteOperationKind.createMany;
          },
          async prepare() {
            calls.prepare += 1;
            return ok(undefined);
          },
          async guard() {
            calls.guard += 1;
            return err(
              domainError.forbidden({
                code: 'authz.create_many_denied',
                message: 'createMany is forbidden',
              })
            );
          },
          async beforePersist() {
            calls.beforePersist += 1;
            return ok(undefined);
          },
          async afterCommit() {
            calls.afterCommit += 1;
            return ok(undefined);
          },
        },
      ]),
      new RecordWriteSideEffectService(),
      noopRecordWriteUndoRedoPlanService,
      noopTableUpdateFlow
    );

    const result = await service.create(createContext(), {
      table,
      recordsFieldValues: [new Map([[table.primaryFieldId().toString(), 'Alpha']])],
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      isTransactionBound: true,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('authz.create_many_denied');
    expect(recordRepository.insertedRecords).toHaveLength(0);
    expect(calls.prepare).toBe(1);
    expect(calls.guard).toBe(1);
    expect(calls.beforePersist).toBe(0);
    expect(calls.afterCommit).toBe(0);
  });
});
