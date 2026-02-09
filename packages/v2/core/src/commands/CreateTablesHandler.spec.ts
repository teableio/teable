import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableCreationService } from '../application/services/TableCreationService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  BatchRecordMutationResult,
  ITableRecordRepository,
  InsertManyStreamOptions,
  InsertManyStreamResult,
  RecordMutationResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { CreateTablesCommand } from './CreateTablesCommand';
import { CreateTablesHandler } from './CreateTablesHandler';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  actorIdResult._unsafeUnwrap();
  return { actorId: actorIdResult._unsafeUnwrap() };
};

class FakeTableRepository implements ITableRepository {
  inserted: Table[] = [];
  updated: Table[] = [];
  failFind: DomainError | undefined;

  async insert(_context: IExecutionContext, table: Table) {
    this.inserted.push(table);
    return ok(table);
  }

  async insertMany(_context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.inserted.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    if (this.failFind) return err(this.failFind);
    const match = this.inserted.find((table) => spec.isSatisfiedBy(table));
    if (!match) return err(domainError.notFound({ message: 'Not found' }));
    return ok(match);
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    if (this.failFind) return err(this.failFind);
    return ok(this.inserted.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.inserted.findIndex((entry) => entry.id().equals(table.id()));
    if (index === -1) return err(domainError.notFound({ message: 'Not found' }));
    this.inserted[index] = table;
    this.updated.push(table);
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  inserted: Table[] = [];

  async insert(_context: IExecutionContext, table: Table) {
    this.inserted.push(table);
    return ok(undefined);
  }

  async insertMany(_context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.inserted.push(...tables);
    return ok(undefined);
  }

  async update(
    _context: IExecutionContext,
    _table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ) {
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table) {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  insertedCount = 0;
  insertedTableIds: string[] = [];
  insertedRecordsByTable = new Map<string, TableRecord[]>();

  async insert(
    _context: IExecutionContext,
    _table: Table,
    _record: TableRecord
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(
    _context: IExecutionContext,
    table: Table,
    records: ReadonlyArray<TableRecord>
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    const tableId = table.id().toString();
    this.insertedTableIds.push(tableId);
    this.insertedCount += records.length;
    const existing = this.insertedRecordsByTable.get(tableId) ?? [];
    this.insertedRecordsByTable.set(tableId, [...existing, ...records]);
    return ok({});
  }

  async insertManyStream(
    _context: IExecutionContext,
    _table: Table,
    batches: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>,
    options?: InsertManyStreamOptions
  ) {
    let totalInserted = 0;
    let batchIndex = 0;
    for await (const batch of batches as AsyncIterable<ReadonlyArray<TableRecord>>) {
      totalInserted += batch.length;
      options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
      batchIndex += 1;
    }
    const result: InsertManyStreamResult = { totalInserted };
    this.insertedCount += totalInserted;
    return ok(result);
  }

  async updateOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: RecordId,
    _mutateSpec: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async updateManyStream(
    _context: IExecutionContext,
    _table: Table,
    _batches: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<{ totalUpdated: number }, DomainError>> {
    return ok({ totalUpdated: 0 });
  }

  async deleteMany(
    _context: IExecutionContext,
    _table: Table,
    _spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ) {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_context: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(_context: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.published.push(...events);
    return ok(undefined);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    const transactionContext = { ...context, transaction };
    return work(transactionContext);
  }
}

describe('CreateTablesHandler', () => {
  it('creates tables with internal link references', async () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableAId = `tbl${'a'.repeat(16)}`;
    const tableBId = `tbl${'b'.repeat(16)}`;
    const tableBPrimaryId = `fld${'b'.repeat(16)}`;

    const commandResult = CreateTablesCommand.create({
      baseId,
      tables: [
        {
          tableId: tableAId,
          name: 'Table A',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'link',
              name: 'Link to B',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableBId,
                lookupFieldId: tableBPrimaryId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        },
        {
          tableId: tableBId,
          name: 'Table B',
          fields: [{ type: 'singleLineText', id: tableBPrimaryId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        },
      ],
    });

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const tableCreationService = new TableCreationService(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectService
    );

    const handler = new CreateTablesHandler(
      tableRepository,
      recordRepository,
      foreignTableLoaderService,
      tableCreationService,
      eventBus,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(tableRepository.inserted).toHaveLength(2);
    expect(schemaRepository.inserted).toHaveLength(2);
    expect(tableRepository.updated).toHaveLength(1);
  });

  it('creates records for each table', async () => {
    const baseId = `bse${'c'.repeat(16)}`;
    const firstFieldId = `fld${'c'.repeat(16)}`;
    const secondFieldId = `fld${'d'.repeat(16)}`;

    const commandResult = CreateTablesCommand.create({
      baseId,
      tables: [
        {
          name: 'Table One',
          fields: [{ type: 'singleLineText', id: firstFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
          records: [{ fields: { [firstFieldId]: 'Alpha' } }],
        },
        {
          name: 'Table Two',
          fields: [{ type: 'singleLineText', id: secondFieldId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
          records: [
            { fields: { [secondFieldId]: 'Beta' } },
            { fields: { [secondFieldId]: 'Gamma' } },
          ],
        },
      ],
    });

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const tableCreationService = new TableCreationService(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectService
    );

    const handler = new CreateTablesHandler(
      tableRepository,
      recordRepository,
      foreignTableLoaderService,
      tableCreationService,
      eventBus,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(recordRepository.insertedCount).toBe(3);
  });

  it('keeps record insertion mapped to input order', async () => {
    const baseId = `bse${'e'.repeat(16)}`;
    const tableAId = `tbl${'a'.repeat(16)}`;
    const tableBId = `tbl${'b'.repeat(16)}`;
    const tableAPrimaryId = `fld${'a'.repeat(16)}`;
    const tableBPrimaryId = `fld${'b'.repeat(16)}`;
    const tableALinkId = `fld${'c'.repeat(16)}`;

    const commandResult = CreateTablesCommand.create({
      baseId,
      tables: [
        {
          tableId: tableAId,
          name: 'Table A',
          fields: [
            { type: 'singleLineText', id: tableAPrimaryId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: tableALinkId,
              name: 'Link to B',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableBId,
                lookupFieldId: tableBPrimaryId,
              },
            },
          ],
          views: [{ type: 'grid' }],
          records: [{ fields: { [tableAPrimaryId]: 'Alpha' } }],
        },
        {
          tableId: tableBId,
          name: 'Table B',
          fields: [{ type: 'singleLineText', id: tableBPrimaryId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
          records: [{ fields: { [tableBPrimaryId]: 'Beta' } }],
        },
      ],
    });

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const tableCreationService = new TableCreationService(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectService
    );

    const handler = new CreateTablesHandler(
      tableRepository,
      recordRepository,
      foreignTableLoaderService,
      tableCreationService,
      eventBus,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    const recordsA = recordRepository.insertedRecordsByTable.get(tableAId) ?? [];
    const recordsB = recordRepository.insertedRecordsByTable.get(tableBId) ?? [];

    expect(recordsA).toHaveLength(1);
    expect(recordsB).toHaveLength(1);

    const recordAValue = recordsA[0]
      ?.fields()
      .entries()
      .find((entry) => entry.fieldId.toString() === tableAPrimaryId)
      ?.value.toValue();
    const recordBValue = recordsB[0]
      ?.fields()
      .entries()
      .find((entry) => entry.fieldId.toString() === tableBPrimaryId)
      ?.value.toValue();

    expect(recordAValue).toBe('Alpha');
    expect(recordBValue).toBe('Beta');
  });
});
