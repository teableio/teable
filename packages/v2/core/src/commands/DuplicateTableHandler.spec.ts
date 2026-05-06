import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableQueryService } from '../application/services/TableQueryService';
import { DefaultTableMapper } from '../ports/mappers/defaults/DefaultTableMapper';
import type { ITablePersistenceDTO } from '../ports/mappers/TableMapper';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { isRecordCreatedEvent } from '../domain/table/events/RecordCreated';
import { isRecordsBatchCreatedEvent } from '../domain/table/events/RecordsBatchCreated';
import { FieldId } from '../domain/table/fields/FieldId';
import type { RecordId } from '../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type {
  IExecutionContext,
  IUnitOfWorkTransaction,
  UnitOfWorkScope,
} from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRecordQueryOptions,
  ITableRecordQueryRepository,
  ITableRecordQueryResult,
  ITableRecordQueryStreamOptions,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  InsertOptions,
  ITableRecordRepository,
  RecordRestoreSystemValues,
  UpdateManyStreamBatchInput,
  UpdateManyStreamOptions,
  UpdateManyStreamResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository, TableProvisionState } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { DuplicateTableCommand } from './DuplicateTableCommand';
import { DuplicateTableHandler } from './DuplicateTableHandler';

const tableMapper = new DefaultTableMapper();

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const sourceBaseId = `bse${'a'.repeat(16)}`;
const sourceTableId = `tbl${'b'.repeat(16)}`;
const externalTableId = `tbl${'c'.repeat(16)}`;
const primaryFieldId = `fld${'d'.repeat(16)}`;
const selfLinkFieldId = `fld${'e'.repeat(16)}`;
const selfLinkBackFieldId = `fld${'f'.repeat(16)}`;
const externalLinkFieldId = `fld${'g'.repeat(16)}`;
const buttonFieldId = `fld${'h'.repeat(16)}`;
const externalLookupFieldId = `fld${'i'.repeat(16)}`;
const defaultViewId = `viw${'j'.repeat(16)}`;
const sourceRecordIdA = `rec${'k'.repeat(16)}`;
const sourceRecordIdB = `rec${'l'.repeat(16)}`;
const externalRecordId = `rec${'m'.repeat(16)}`;

const createSourceTable = (): Table => {
  const dto: ITablePersistenceDTO = {
    id: sourceTableId,
    baseId: sourceBaseId,
    name: 'Source Orders',
    dbTableName: `${sourceBaseId}.${sourceTableId}`,
    primaryFieldId,
    fields: [
      {
        id: primaryFieldId,
        name: 'Name',
        type: 'singleLineText',
      },
      {
        id: selfLinkFieldId,
        name: 'Related',
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: sourceTableId,
          lookupFieldId: primaryFieldId,
          isOneWay: false,
          symmetricFieldId: selfLinkBackFieldId,
          fkHostTableName: `${sourceBaseId}.__source_related`,
          selfKeyName: '__fk_related_left',
          foreignKeyName: '__fk_related_right',
        },
      },
      {
        id: selfLinkBackFieldId,
        name: 'Related (linked)',
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: sourceTableId,
          lookupFieldId: primaryFieldId,
          isOneWay: false,
          symmetricFieldId: selfLinkFieldId,
          fkHostTableName: `${sourceBaseId}.__source_related`,
          selfKeyName: '__fk_related_right',
          foreignKeyName: '__fk_related_left',
        },
      },
      {
        id: externalLinkFieldId,
        name: 'Vendor',
        type: 'link',
        options: {
          relationship: 'manyMany',
          foreignTableId: externalTableId,
          lookupFieldId: externalLookupFieldId,
          isOneWay: false,
          symmetricFieldId: `fld${'n'.repeat(16)}`,
          fkHostTableName: `${sourceBaseId}.__source_vendor`,
          selfKeyName: '__fk_vendor_left',
          foreignKeyName: '__fk_vendor_right',
        },
      },
      {
        id: buttonFieldId,
        name: 'Run',
        type: 'button',
        options: {
          label: 'Run',
          workflow: {
            id: 'wfl-source',
            name: 'Source Flow',
            isActive: true,
          },
        },
      },
    ],
    views: [
      {
        id: defaultViewId,
        type: 'grid',
        name: 'Grid',
        options: {
          rowHeight: 'tall',
          frozenFieldId: primaryFieldId,
        },
        columnMeta: {
          [primaryFieldId]: { order: 0 },
          [selfLinkFieldId]: { order: 1 },
          [externalLinkFieldId]: { order: 2 },
        },
      },
    ],
  };

  return tableMapper.toDomain(dto)._unsafeUnwrap();
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  insertedTables: Table[] = [];
  provisionStateChanges: Array<{ tableId: string; state: TableProvisionState }> = [];

  async insert(_context: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    const persisted = table.clone(tableMapper)._unsafeUnwrap();
    this.tables.push(persisted);
    this.insertedTables.push(persisted);
    return ok(persisted);
  }

  async insertMany(
    _context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    const persisted = tables.map((table) => table.clone(tableMapper)._unsafeUnwrap());
    this.tables.push(...persisted);
    this.insertedTables.push(...persisted);
    return ok(persisted);
  }

  async findOne(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: { state?: 'active' | 'deleted' | 'all' }
  ): Promise<Result<Table, DomainError>> {
    const match = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!match) {
      return err(domainError.notFound({ message: 'Table not found' }));
    }
    return ok(match);
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _context: IExecutionContext,
    _table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async restore(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async setProvisionState(
    _context: IExecutionContext,
    table: Table,
    state: TableProvisionState
  ): Promise<Result<void, DomainError>> {
    this.provisionStateChanges.push({ tableId: table.id().toString(), state });
    return ok(undefined);
  }

  async setProvisionStateMany(
    _context: IExecutionContext,
    tables: ReadonlyArray<Table>,
    state: TableProvisionState
  ): Promise<Result<void, DomainError>> {
    for (const table of tables) {
      this.provisionStateChanges.push({ tableId: table.id().toString(), state });
    }
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  insertedTables: Table[] = [];

  async insert(_context: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    this.insertedTables.push(table);
    return ok(undefined);
  }

  async insertMany(
    _context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    this.insertedTables.push(...tables);
    return ok(undefined);
  }

  async update(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  records: TableRecordReadModel[] = [];

  async find(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    return ok({ records: this.records, total: this.records.length });
  }

  async findOne(
    _context: IExecutionContext,
    _table: Table,
    recordId: RecordId
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    const record = this.records.find((entry) => entry.id === recordId.toString());
    if (!record) {
      return err(domainError.notFound({ message: 'Record not found' }));
    }
    return ok(record);
  }

  async *findStream(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    for (const record of this.records) {
      yield ok(record);
    }
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  insertedRecords: TableRecord[] = [];
  lastOptions: InsertOptions | undefined;
  lastTable: Table | undefined;

  async insert(
    _context: IExecutionContext,
    _table: Table,
    _record: TableRecord
  ): Promise<Result<{ computedChanges?: ReadonlyMap<string, unknown> }, DomainError>> {
    return ok({});
  }

  async insertMany(
    _context: IExecutionContext,
    table: Table,
    records: ReadonlyArray<TableRecord>,
    options?: InsertOptions
  ): Promise<
    Result<
      { computedChangesByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>> },
      DomainError
    >
  > {
    this.lastTable = table;
    this.insertedRecords = [...records];
    this.lastOptions = options;
    return ok({});
  }

  async insertManyStream(
    _context: IExecutionContext,
    _table: Table,
    _batches: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    return ok({ totalInserted: 0 });
  }

  async updateOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: RecordId,
    _mutateSpec: ICellValueSpec
  ): Promise<Result<{ computedChanges?: ReadonlyMap<string, unknown> }, DomainError>> {
    return ok({});
  }

  async updateMany(
    _context: IExecutionContext,
    _table: Table,
    _spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _mutateSpec: ICellValueSpec
  ) {
    return ok({ totalUpdated: 0, updatedRecordIds: [], updatedRecords: [] });
  }

  async updateManyStream(
    _context: IExecutionContext,
    _table: Table,
    _batches:
      | Iterable<Result<UpdateManyStreamBatchInput, DomainError>>
      | AsyncIterable<Result<UpdateManyStreamBatchInput, DomainError>>,
    _options?: UpdateManyStreamOptions
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    return ok({ totalUpdated: 0, updatedRecords: [] });
  }

  async deleteMany(
    _context: IExecutionContext,
    _table: Table,
    _spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ) {
    return ok({});
  }

  async deleteManyStream(): Promise<Result<{ totalDeleted: number }, DomainError>> {
    return ok({ totalDeleted: 0 });
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];
  publishedContexts: IExecutionContext[] = [];

  async publish(
    context: IExecutionContext,
    event: IDomainEvent
  ): Promise<Result<void, DomainError>> {
    this.publishedContexts.push({ ...context });
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(
    context: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    this.publishedContexts.push({ ...context });
    this.published.push(...events);
    return ok(undefined);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  transactions: IUnitOfWorkTransaction[] = [];

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const scope: UnitOfWorkScope = options?.scope ?? 'data';
    const existing = context.transactions?.[scope];
    if (existing) {
      return work({ ...context, transaction: existing });
    }
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction', scope };
    this.transactions.push(transaction);
    return work({
      ...context,
      transaction,
      transactions: {
        ...(context.transactions ?? {}),
        [scope]: transaction,
      },
    });
  }
}

const getFieldValue = (record: TableRecord, fieldId: string): unknown => {
  return record.fields().get(FieldId.create(fieldId)._unsafeUnwrap())?.toValue();
};

describe('DuplicateTableHandler', () => {
  it('duplicates records while remapping self links, preserving external links, and restoring row orders', async () => {
    const sourceTable = createSourceTable();
    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(sourceTable);
    const tableQueryService = new TableQueryService(tableRepository);
    const tableSchemaRepository = new FakeTableSchemaRepository();
    const tableRecordQueryRepository = new FakeTableRecordQueryRepository();
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    tableRecordQueryRepository.records = [
      {
        id: sourceRecordIdA,
        version: 1,
        orders: {
          [defaultViewId]: 7,
        },
        fields: {
          [primaryFieldId]: 'Alpha',
          [selfLinkFieldId]: [{ id: sourceRecordIdB, title: 'Beta' }],
          [selfLinkBackFieldId]: [{ id: sourceRecordIdB, title: 'Beta' }],
          [externalLinkFieldId]: [{ id: externalRecordId, title: 'Vendor One' }],
          [buttonFieldId]: { count: 9 },
        },
      },
      {
        id: sourceRecordIdB,
        version: 1,
        orders: {
          [defaultViewId]: 3,
        },
        fields: {
          [primaryFieldId]: 'Beta',
          [selfLinkFieldId]: [{ id: sourceRecordIdA, title: 'Alpha' }],
          [selfLinkBackFieldId]: [{ id: sourceRecordIdA, title: 'Alpha' }],
          [externalLinkFieldId]: [{ id: externalRecordId, title: 'Vendor One' }],
        },
      },
    ];

    const handler = new DuplicateTableHandler(
      tableQueryService,
      tableMapper,
      tableRepository,
      tableSchemaRepository,
      tableRecordQueryRepository,
      tableRecordRepository,
      eventBus,
      unitOfWork
    );

    const command = DuplicateTableCommand.create({
      baseId: sourceBaseId,
      tableId: sourceTableId,
      name: 'Source Orders Copy',
      includeRecords: true,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const duplicated = result._unsafeUnwrap();

    expect(unitOfWork.transactions).toHaveLength(3);
    expect(unitOfWork.transactions.map((transaction) => transaction.scope)).toEqual([
      'meta',
      'data',
      'meta',
    ]);
    expect(tableRepository.insertedTables).toHaveLength(1);
    expect(tableRepository.provisionStateChanges.map(({ state }) => state)).toEqual([
      'pending',
      'ready',
    ]);
    expect(tableSchemaRepository.insertedTables).toHaveLength(1);
    expect(tableRecordRepository.insertedRecords).toHaveLength(2);
    expect(eventBus.published.length).toBeGreaterThan(0);
    expect(eventBus.published.some(isRecordCreatedEvent)).toBe(false);
    const batchCreatedEvent = eventBus.published.find(isRecordsBatchCreatedEvent);
    expect(batchCreatedEvent?.records).toHaveLength(2);
    expect(eventBus.publishedContexts.at(-1)?.duplicateTable).toMatchObject({
      sourceTableId,
      duplicatedTableId: duplicated.table.id().toString(),
      includeRecords: true,
    });

    const duplicatedPrimaryFieldId = duplicated.fieldIdMap.get(primaryFieldId);
    const duplicatedSelfLinkFieldId = duplicated.fieldIdMap.get(selfLinkFieldId);
    const duplicatedSelfLinkBackFieldId = duplicated.fieldIdMap.get(selfLinkBackFieldId);
    const duplicatedExternalLinkFieldId = duplicated.fieldIdMap.get(externalLinkFieldId);
    const duplicatedButtonFieldId = duplicated.fieldIdMap.get(buttonFieldId);
    const duplicatedViewId = duplicated.viewIdMap.get(defaultViewId);

    expect(duplicatedPrimaryFieldId).toBeDefined();
    expect(duplicatedSelfLinkFieldId).toBeDefined();
    expect(duplicatedSelfLinkBackFieldId).toBeDefined();
    expect(duplicatedExternalLinkFieldId).toBeDefined();
    expect(duplicatedButtonFieldId).toBeDefined();
    expect(duplicatedViewId).toBeDefined();
    const duplicatedView = duplicated.table
      .views()
      .find((view) => view.id().toString() === duplicatedViewId);
    expect(duplicatedView?.options()).toEqual({
      rowHeight: 'tall',
      frozenFieldId: duplicatedPrimaryFieldId,
    });

    const duplicatedRecordByName = new Map(
      tableRecordRepository.insertedRecords.map((record) => [
        getFieldValue(record, duplicatedPrimaryFieldId!),
        record,
      ])
    );
    const alphaRecord = duplicatedRecordByName.get('Alpha');
    const betaRecord = duplicatedRecordByName.get('Beta');

    expect(alphaRecord).toBeDefined();
    expect(betaRecord).toBeDefined();
    if (!alphaRecord || !betaRecord) return;

    const alphaSelfLinks = getFieldValue(alphaRecord, duplicatedSelfLinkFieldId!) as Array<{
      id: string;
    }>;
    const betaSelfLinks = getFieldValue(betaRecord, duplicatedSelfLinkFieldId!) as Array<{
      id: string;
    }>;

    expect(alphaSelfLinks).toEqual([{ id: betaRecord.id().toString(), title: 'Beta' }]);
    expect(betaSelfLinks).toEqual([{ id: alphaRecord.id().toString(), title: 'Alpha' }]);
    expect(getFieldValue(alphaRecord, duplicatedSelfLinkBackFieldId!)).toBeUndefined();
    expect(getFieldValue(betaRecord, duplicatedSelfLinkBackFieldId!)).toBeUndefined();

    expect(getFieldValue(alphaRecord, duplicatedExternalLinkFieldId!)).toEqual([
      { id: externalRecordId, title: 'Vendor One' },
    ]);
    expect(getFieldValue(betaRecord, duplicatedExternalLinkFieldId!)).toEqual([
      { id: externalRecordId, title: 'Vendor One' },
    ]);

    expect(getFieldValue(alphaRecord, duplicatedButtonFieldId!)).toBeUndefined();
    expect(getFieldValue(betaRecord, duplicatedButtonFieldId!)).toBeUndefined();

    const restoreRecordsById = tableRecordRepository.lastOptions?.restoreRecordsById as
      | ReadonlyMap<string, RecordRestoreSystemValues>
      | undefined;
    expect(restoreRecordsById).toBeDefined();
    expect(restoreRecordsById?.get(alphaRecord.id().toString())?.orders).toEqual({
      [duplicatedViewId!]: 7,
    });
    expect(restoreRecordsById?.get(betaRecord.id().toString())?.orders).toEqual({
      [duplicatedViewId!]: 3,
    });

    expect(tableRecordRepository.lastTable?.id().equals(duplicated.table.id())).toBe(true);
  });
});
