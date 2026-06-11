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
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { ICellValueSpec } from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
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
  resolveAndReplaceMany: async (
    _context: IExecutionContext,
    specs: ReadonlyArray<ICellValueSpec | null>
  ) => ok(specs),
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
    expect(calls.beforePersist).toHaveLength(1);
    expect(calls.afterCommit).toHaveLength(1);
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
