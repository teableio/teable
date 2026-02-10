import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../domain/shared/ActorId';
import type { DomainError } from '../domain/shared/DomainError';
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
import type { ICsvParser, CsvParseResult, CsvSource } from '../ports/CsvParser';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRecordRepository,
  BatchRecordMutationResult,
  InsertManyStreamOptions,
  RecordMutationResult,
  UpdateManyStreamResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { ImportCsvCommand } from './ImportCsvCommand';
import { ImportCsvHandler } from './ImportCsvHandler';

const baseId = `bse${'b'.repeat(16)}`;

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const isAsyncIterable = <T>(value: Iterable<T> | AsyncIterable<T>): value is AsyncIterable<T> =>
  typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === 'function';

class FakeCsvParser implements ICsvParser {
  constructor(
    private readonly syncResult: Result<CsvParseResult, DomainError>,
    private readonly asyncResult?: Result<CsvParseResult, DomainError>
  ) {}

  parse(_source: CsvSource): Result<CsvParseResult, DomainError> {
    return this.syncResult;
  }

  async parseAsync(_source: CsvSource): Promise<Result<CsvParseResult, DomainError>> {
    return this.asyncResult ?? this.syncResult;
  }
}

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    this.tables.push(table);
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    this.tables.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const match = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!match)
      return err({
        code: 'not_found',
        message: 'Table not found',
        tags: ['not-found'],
        toString: () => 'Table not found',
      });
    return ok(match);
  }

  async find(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    __?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  inserted: Table[] = [];

  async insert(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    this.inserted.push(table);
    return ok(undefined);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    this.inserted.push(...tables);
    return ok(undefined);
  }

  async update(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  inserted: TableRecord[] = [];

  async insert(
    _: IExecutionContext,
    __: Table,
    ___: TableRecord
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(
    _: IExecutionContext,
    __: Table,
    ___: ReadonlyArray<TableRecord>
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertManyStream(
    _: IExecutionContext,
    __: Table,
    batches: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>,
    options?: InsertManyStreamOptions
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    let totalInserted = 0;
    let batchIndex = 0;
    if (isAsyncIterable(batches)) {
      for await (const batch of batches) {
        this.inserted.push(...batch);
        totalInserted += batch.length;
        options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
        batchIndex += 1;
      }
    } else {
      for (const batch of batches) {
        this.inserted.push(...batch);
        totalInserted += batch.length;
        options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
        batchIndex += 1;
      }
    }

    return ok({ totalInserted });
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId,
    ____: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async updateManyStream(
    _: IExecutionContext,
    __: Table,
    ___: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    return ok({ totalUpdated: 0 });
  }

  async deleteMany(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(_: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
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
    return work({ ...context, transaction });
  }
}

describe('ImportCsvHandler', () => {
  it('imports csv data and creates table/records', async () => {
    const parser = new FakeCsvParser(
      ok({
        headers: ['Name', 'Age'],
        rows: [
          { Name: 'Alice', Age: '30' },
          { Name: 'Bob', Age: '40' },
        ],
      })
    );
    const tableRepository = new FakeTableRepository();
    const tableSchemaRepository = new FakeTableSchemaRepository();
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new ImportCsvHandler(
      parser,
      tableRepository,
      tableSchemaRepository,
      tableRecordRepository,
      eventBus,
      unitOfWork
    );

    const command = ImportCsvCommand.createFromString({
      baseId,
      csvData: 'Name,Age\nAlice,30\nBob,40',
      tableName: 'People',
      batchSize: 2,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);

    const value = result._unsafeUnwrap();
    expect(value.totalImported).toBe(2);
    expect(value.table.name().toString()).toBe('People');
    expect(value.table.getFields()).toHaveLength(2);
    expect(value.table.primaryField()._unsafeUnwrap().name().toString()).toBe('Name');
    expect(tableRecordRepository.inserted).toHaveLength(2);
    expect(eventBus.published.length).toBeGreaterThan(0);
  });

  it('returns error when csv has no headers', async () => {
    const parser = new FakeCsvParser(
      ok({
        headers: [],
        rows: [],
      })
    );

    const handler = new ImportCsvHandler(
      parser,
      new FakeTableRepository(),
      new FakeTableSchemaRepository(),
      new FakeTableRecordRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const command = ImportCsvCommand.createFromString({
      baseId,
      csvData: '',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('csv.no_columns');
  });

  it('fails when async parsing is required but not supported', async () => {
    const parser: ICsvParser = {
      parse: () =>
        ok({
          headers: ['Name'],
          rows: [{ Name: 'Only' }],
        }),
    };

    const handler = new ImportCsvHandler(
      parser,
      new FakeTableRepository(),
      new FakeTableSchemaRepository(),
      new FakeTableRecordRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const csvStream = (async function* () {
      yield 'Name\nOnly';
    })();

    const command = ImportCsvCommand.createFromStream({
      baseId,
      csvStream,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('csv.async_not_supported');
  });

  it('imports using async parser for stream source', async () => {
    const rowsAsync = (async function* () {
      yield { Name: 'Streamed' };
    })();

    const parser = new FakeCsvParser(
      ok({ headers: ['Name'], rows: [] }),
      ok({ headers: ['Name'], rows: [], rowsAsync })
    );

    const handler = new ImportCsvHandler(
      parser,
      new FakeTableRepository(),
      new FakeTableSchemaRepository(),
      new FakeTableRecordRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const csvStream = (async function* () {
      yield 'Name\nStreamed';
    })();

    const command = ImportCsvCommand.createFromStream({
      baseId,
      csvStream,
      batchSize: 1,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalImported).toBe(1);
  });
});
