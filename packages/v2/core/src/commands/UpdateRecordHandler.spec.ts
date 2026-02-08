import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type {
  RecordUpdateUndoRedoInput,
  UndoRedoService,
} from '../application/services/UndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { RecordUpdated } from '../domain/table/events/RecordUpdated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { MultipleSelectField } from '../domain/table/fields/types/MultipleSelectField';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import type { SingleSelectField } from '../domain/table/fields/types/SingleSelectField';
import type { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  ITableRecordRepository,
  RecordMutationResult,
  BatchRecordMutationResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { UpdateRecordCommand } from './UpdateRecordCommand';
import { UpdateRecordHandler } from './UpdateRecordHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const createTableUpdateFlow = (
  tableRepository: FakeTableRepository,
  eventBus: FakeEventBus,
  unitOfWork: FakeUnitOfWork
) => new TableUpdateFlow(tableRepository, new FakeTableSchemaRepository(), eventBus, unitOfWork);

const buildTable = () => {
  const baseId = BaseId.create(`bse${'u'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Update Records')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
  const numberFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
  const singleSelectFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const multiSelectFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
  const openOption = SelectOption.create({ name: 'Open', color: 'blue' })._unsafeUnwrap();
  const tagOption = SelectOption.create({ name: 'Tag A', color: 'green' })._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(numberFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder
    .field()
    .singleSelect()
    .withId(singleSelectFieldId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([openOption])
    .done();
  builder
    .field()
    .multipleSelect()
    .withId(multiSelectFieldId)
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions([tagOption])
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    baseId,
    tableId,
    textFieldId,
    numberFieldId,
    singleSelectFieldId,
    multiSelectFieldId,
  };
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  updated: Table[] = [];

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
    if (!match) return err(domainError.notFound({ message: 'Table not found' }));
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
    table: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.tables.findIndex((entry) => entry.id().equals(table.id()));
    if (index >= 0) {
      this.tables[index] = table;
    }
    this.updated.push(table);
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  async insert(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _context: IExecutionContext,
    _tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async update(
    _context: IExecutionContext,
    _table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  lastContext: IExecutionContext | undefined;
  lastRecordId: RecordId | undefined;
  lastMutateSpec: ICellValueSpec | undefined;

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
    ___: Iterable<ReadonlyArray<TableRecord>>
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    return ok({ totalInserted: 0 });
  }

  async updateOne(
    context: IExecutionContext,
    _: Table,
    recordId: RecordId,
    mutateSpec: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    this.lastContext = context;
    this.lastRecordId = recordId;
    this.lastMutateSpec = mutateSpec;
    return ok({});
  }

  async updateManyStream(
    _: IExecutionContext,
    __: Table,
    ___: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<{ totalUpdated: number }, DomainError>> {
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

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  record: TableRecordReadModel | undefined;
  failFindOne: DomainError | undefined;

  async find(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>> {
    return ok({ records: [], total: 0 });
  }

  async findOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    if (this.failFindOne) return err(this.failFindOne);
    if (!this.record) return err(domainError.notFound({ message: 'Record not found' }));
    return ok(this.record);
  }

  async *findStream(): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    // Noop: yields nothing
  }
}

class FakeRecordMutationSpecResolverService {
  needsResolutionValue = false;
  resolveCalls: ICellValueSpec[] = [];

  needsResolution(_: ICellValueSpec): Result<boolean, DomainError> {
    return ok(this.needsResolutionValue);
  }

  async resolveAndReplace(
    _: IExecutionContext,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    this.resolveCalls.push(spec);
    return ok(spec);
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
  transactions: IExecutionContext[] = [];

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    const transactionContext = { ...context, transaction };
    this.transactions.push(transactionContext);
    return work(transactionContext);
  }
}

class FakeUndoRedoService {
  calls: RecordUpdateUndoRedoInput[] = [];

  async recordUpdateRecord(
    _context: IExecutionContext,
    params: RecordUpdateUndoRedoInput
  ): Promise<Result<void, DomainError>> {
    this.calls.push(params);
    return ok(undefined);
  }
}

describe('UpdateRecordHandler', () => {
  it('updates record and publishes event', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new UpdateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoService,
      unitOfWork
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'New Title' },
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.record.fields().get(textFieldId)?.toValue()).toBe('New Title');
    expect(recordRepository.lastRecordId?.equals(recordResult.record.id())).toBe(true);
    expect(recordRepository.lastContext?.transaction?.kind).toBe('unitOfWorkTransaction');
    expect(eventBus.published.some((event) => event instanceof RecordUpdated)).toBe(true);
    expect(unitOfWork.transactions.length).toBe(1);
  });

  it('resolves link titles when typecast is enabled', async () => {
    const { table, tableId, textFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const resolver = new FakeRecordMutationSpecResolverService();
    resolver.needsResolutionValue = true;

    const handler = new UpdateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      resolver as unknown as RecordMutationSpecResolverService,
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
      new FakeEventBus(),
      new FakeUndoRedoService() as unknown as UndoRedoService,
      new FakeUnitOfWork()
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'New Title' },
      typecast: true,
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(resolver.resolveCalls.length).toBe(1);
  });

  it('auto creates select options when typecast is enabled', async () => {
    const { table, tableId, textFieldId, singleSelectFieldId, multiSelectFieldId } = buildTable();
    const recordResult = table
      .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
      ._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordRepository = new FakeTableRecordRepository();
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.record = {
      id: recordResult.record.id().toString(),
      fields: { [textFieldId.toString()]: 'Old Title' },
      version: 1,
    };

    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new UpdateRecordHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
      eventBus,
      new FakeUndoRedoService() as unknown as UndoRedoService,
      unitOfWork
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: recordResult.record.id().toString(),
      typecast: true,
      fields: {
        [singleSelectFieldId.toString()]: 'In Progress',
        [multiSelectFieldId.toString()]: ['Tag A', 'Tag B'],
      },
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(tableRepository.updated.length).toBe(1);
    const updatedTable = tableRepository.updated[0];
    if (!updatedTable) {
      throw new Error('Expected updated table');
    }

    const singleField = updatedTable
      .getField((field) => field.id().equals(singleSelectFieldId))
      ._unsafeUnwrap() as SingleSelectField;
    const singleNames = singleField.selectOptions().map((option) => option.name().toString());
    expect(singleNames).toContain('In Progress');

    const multiField = updatedTable
      .getField((field) => field.id().equals(multiSelectFieldId))
      ._unsafeUnwrap() as MultipleSelectField;
    const multiNames = multiField.selectOptions().map((option) => option.name().toString());
    expect(multiNames).toContain('Tag B');
  });

  it('returns error when record query fails', async () => {
    const { table, tableId, textFieldId } = buildTable();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.failFindOne = domainError.notFound({ message: 'Record missing' });

    const handler = new UpdateRecordHandler(
      tableQueryService,
      new FakeTableRecordRepository(),
      recordQueryRepository,
      new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
      new RecordWriteSideEffectService(),
      createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
      new FakeEventBus(),
      new FakeUndoRedoService() as unknown as UndoRedoService,
      new FakeUnitOfWork()
    );

    const commandResult = UpdateRecordCommand.create({
      tableId: tableId.toString(),
      recordId: `rec${'z'.repeat(16)}`,
      fields: { [textFieldId.toString()]: 'New Title' },
    });

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('Record missing');
  });

  describe('field key mapping', () => {
    it('returns fieldKeyMapping using fieldId when input uses fieldId', async () => {
      const { table, tableId, textFieldId, numberFieldId } = buildTable();
      const recordResult = table
        .createRecord(
          new Map<string, string | number>([
            [textFieldId.toString(), 'Old Title'],
            [numberFieldId.toString(), 100],
          ])
        )
        ._unsafeUnwrap();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordRepository = new FakeTableRecordRepository();
      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.record = {
        id: recordResult.record.id().toString(),
        version: 1,
        fields: {
          [textFieldId.toString()]: 'Old Title',
          [numberFieldId.toString()]: 100,
        },
      };

      const handler = new UpdateRecordHandler(
        tableQueryService,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
        new FakeEventBus(),
        new FakeUndoRedoService() as unknown as UndoRedoService,
        new FakeUnitOfWork()
      );

      const commandResult = UpdateRecordCommand.create({
        tableId: tableId.toString(),
        recordId: recordResult.record.id().toString(),
        fields: {
          [textFieldId.toString()]: 'New Title',
          [numberFieldId.toString()]: 200,
        },
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      const { fieldKeyMapping } = result._unsafeUnwrap();

      // fieldKeyMapping should map fieldId -> original input key (which is fieldId)
      expect(fieldKeyMapping.get(textFieldId.toString())).toBe(textFieldId.toString());
      expect(fieldKeyMapping.get(numberFieldId.toString())).toBe(numberFieldId.toString());
    });

    it('returns fieldKeyMapping using fieldName when input uses fieldName', async () => {
      const { table, tableId, textFieldId, numberFieldId } = buildTable();
      const recordResult = table
        .createRecord(
          new Map<string, string | number>([
            [textFieldId.toString(), 'Old Title'],
            [numberFieldId.toString(), 100],
          ])
        )
        ._unsafeUnwrap();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordRepository = new FakeTableRecordRepository();
      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.record = {
        id: recordResult.record.id().toString(),
        version: 1,
        fields: {
          [textFieldId.toString()]: 'Old Title',
          [numberFieldId.toString()]: 100,
        },
      };

      const handler = new UpdateRecordHandler(
        tableQueryService,
        recordRepository,
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
        new FakeEventBus(),
        new FakeUndoRedoService() as unknown as UndoRedoService,
        new FakeUnitOfWork()
      );

      // Use fieldName as key instead of fieldId
      const commandResult = UpdateRecordCommand.create({
        tableId: tableId.toString(),
        recordId: recordResult.record.id().toString(),
        fields: {
          Title: 'New Title',
          Amount: 200,
        },
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      const { fieldKeyMapping } = result._unsafeUnwrap();

      // fieldKeyMapping should map fieldId -> original input key (which is fieldName)
      expect(fieldKeyMapping.get(textFieldId.toString())).toBe('Title');
      expect(fieldKeyMapping.get(numberFieldId.toString())).toBe('Amount');
    });

    it('returns error when field key is not found', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const recordResult = table
        .createRecord(new Map([[textFieldId.toString(), 'Old Title']]))
        ._unsafeUnwrap();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.record = {
        id: recordResult.record.id().toString(),
        version: 1,
        fields: { [textFieldId.toString()]: 'Old Title' },
      };

      const handler = new UpdateRecordHandler(
        tableQueryService,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
        new FakeEventBus(),
        new FakeUndoRedoService() as unknown as UndoRedoService,
        new FakeUnitOfWork()
      );

      const commandResult = UpdateRecordCommand.create({
        tableId: tableId.toString(),
        recordId: recordResult.record.id().toString(),
        fields: {
          Title: 'Valid',
          UnknownField: 'Should fail',
        },
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe('field.not_found');
    });
  });
});
