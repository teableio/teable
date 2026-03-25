import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { ConditionalLookupField } from '../../domain/table/fields/types/ConditionalLookupField';
import { ConditionalLookupOptions } from '../../domain/table/fields/types/ConditionalLookupOptions';
import { ConditionalRollupConfig } from '../../domain/table/fields/types/ConditionalRollupConfig';
import { ConditionalRollupField } from '../../domain/table/fields/types/ConditionalRollupField';
import { LinkField } from '../../domain/table/fields/types/LinkField';
import { LinkFieldConfig } from '../../domain/table/fields/types/LinkFieldConfig';
import { LookupField } from '../../domain/table/fields/types/LookupField';
import { LookupOptions } from '../../domain/table/fields/types/LookupOptions';
import { RollupExpression } from '../../domain/table/fields/types/RollupExpression';
import { RollupField } from '../../domain/table/fields/types/RollupField';
import { RollupFieldConfig } from '../../domain/table/fields/types/RollupFieldConfig';
import { SingleLineTextField } from '../../domain/table/fields/types/SingleLineTextField';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { Table } from '../../domain/table/Table';
import { TableName } from '../../domain/table/TableName';
import type { TableSortKey } from '../../domain/table/TableSortKey';
import type { IEventBus } from '../../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import type { IFindOptions } from '../../ports/RepositoryQuery';
import type { ITableRepository } from '../../ports/TableRepository';
import type { ITableSchemaRepository } from '../../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../../ports/UnitOfWork';
import { FieldCrossTableUpdateSideEffectService } from './FieldCrossTableUpdateSideEffectService';
import { FieldUpdateSideEffectService } from './FieldUpdateSideEffectService';
import { LinkFieldUpdateSideEffectService } from './LinkFieldUpdateSideEffectService';
import { TableDeletionSideEffectService } from './TableDeletionSideEffectService';
import { TableUpdateFlow } from './TableUpdateFlow';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const createDeletedTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const table = TableAggregate.builder()
    .withBaseId(baseId)
    .withName(TableName.create('Source')._unsafeUnwrap());
  table
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  table.field().singleLineText().withName(FieldName.create('Value')._unsafeUnwrap()).done();
  table.field().number().withName(FieldName.create('Score')._unsafeUnwrap()).done();
  table.view().defaultGrid().done();
  return table.build()._unsafeUnwrap();
};

const createHostTable = (
  deletedTable: Table,
  options?: {
    baseId?: BaseId;
    crossBase?: boolean;
  }
) => {
  const primaryFieldId = deletedTable.primaryFieldId();
  const valueField = deletedTable.getFields((field) => field.name().toString() === 'Value').at(0);
  const scoreField = deletedTable.getFields((field) => field.name().toString() === 'Score').at(0);
  const linkFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
  const lookupInnerFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
  const rollupFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
  const conditionalLookupFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
  const conditionalLookupInnerFieldId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();
  const conditionalRollupFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
  if (!valueField || !scoreField) throw new Error('Missing deleted source fields');
  const hostBaseId = options?.baseId ?? deletedTable.baseId();
  const isCrossBase = options?.crossBase ?? false;

  const host = TableAggregate.builder()
    .withBaseId(hostBaseId)
    .withName(TableName.create('Host')._unsafeUnwrap());

  host
    .field()
    .singleLineText()
    .withName(FieldName.create('Host Name')._unsafeUnwrap())
    .primary()
    .done();

  host.view().defaultGrid().done();
  let builtHost = host.build()._unsafeUnwrap();

  builtHost = builtHost
    .addField(
      LinkField.create({
        id: linkFieldId,
        name: FieldName.create('Link')._unsafeUnwrap(),
        config: LinkFieldConfig.create({
          ...(isCrossBase ? { baseId: deletedTable.baseId().toString() } : {}),
          relationship: 'manyMany',
          foreignTableId: deletedTable.id().toString(),
          lookupFieldId: primaryFieldId.toString(),
          isOneWay: true,
        })._unsafeUnwrap(),
      })._unsafeUnwrap(),
      { foreignTables: [deletedTable] }
    )
    ._unsafeUnwrap();

  builtHost = builtHost
    .addField(
      LookupField.create({
        id: lookupFieldId,
        name: FieldName.create('Lookup')._unsafeUnwrap(),
        innerField: SingleLineTextField.create({
          id: lookupInnerFieldId,
          name: FieldName.create('Lookup Inner')._unsafeUnwrap(),
        })._unsafeUnwrap(),
        lookupOptions: LookupOptions.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: deletedTable.id().toString(),
          lookupFieldId: valueField.id().toString(),
        })._unsafeUnwrap(),
      })._unsafeUnwrap(),
      { foreignTables: [deletedTable] }
    )
    ._unsafeUnwrap();

  builtHost = builtHost
    .addField(
      RollupField.create({
        id: rollupFieldId,
        name: FieldName.create('Rollup')._unsafeUnwrap(),
        config: RollupFieldConfig.create({
          linkFieldId: linkFieldId.toString(),
          foreignTableId: deletedTable.id().toString(),
          lookupFieldId: valueField.id().toString(),
        })._unsafeUnwrap(),
        expression: RollupExpression.create('countall({values})')._unsafeUnwrap(),
        valuesField: valueField,
      })._unsafeUnwrap(),
      { foreignTables: [deletedTable] }
    )
    ._unsafeUnwrap();

  builtHost = builtHost
    .addField(
      ConditionalLookupField.create({
        id: conditionalLookupFieldId,
        name: FieldName.create('Conditional Lookup')._unsafeUnwrap(),
        innerField: SingleLineTextField.create({
          id: conditionalLookupInnerFieldId,
          name: FieldName.create('Conditional Lookup Inner')._unsafeUnwrap(),
        })._unsafeUnwrap(),
        conditionalLookupOptions: ConditionalLookupOptions.create({
          foreignTableId: deletedTable.id().toString(),
          lookupFieldId: valueField.id().toString(),
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: valueField.id().toString(), operator: 'isNotEmpty' }],
            },
            sort: { fieldId: scoreField.id().toString(), order: 'asc' },
            limit: 1,
          },
        })._unsafeUnwrap(),
      })._unsafeUnwrap(),
      { foreignTables: [deletedTable] }
    )
    ._unsafeUnwrap();

  builtHost = builtHost
    .addField(
      ConditionalRollupField.create({
        id: conditionalRollupFieldId,
        name: FieldName.create('Conditional Rollup')._unsafeUnwrap(),
        config: ConditionalRollupConfig.create({
          foreignTableId: deletedTable.id().toString(),
          lookupFieldId: scoreField.id().toString(),
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: valueField.id().toString(), operator: 'isNotEmpty' }],
            },
            sort: { fieldId: scoreField.id().toString(), order: 'asc' },
            limit: 1,
          },
        })._unsafeUnwrap(),
        expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
        valuesField: scoreField,
      })._unsafeUnwrap(),
      { foreignTables: [deletedTable] }
    )
    ._unsafeUnwrap();

  return builtHost;
};

class FakeTableRepository implements ITableRepository {
  constructor(private readonly tablesById: Map<string, Table>) {}

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    this.tablesById.set(table.id().toString(), table);
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    tables.forEach((table) => this.tablesById.set(table.id().toString(), table));
    return ok([...tables]);
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const table = [...this.tablesById.values()].find((candidate) => spec.isSatisfiedBy(candidate));
    if (!table) return err(domainError.notFound({ message: 'Table not found' }));
    return ok(table);
  }

  async find(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    __?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([...this.tablesById.values()].filter((candidate) => spec.isSatisfiedBy(candidate)));
  }

  async updateOne(
    _: IExecutionContext,
    table: Table,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    this.tablesById.set(table.id().toString(), table);
    return ok(undefined);
  }

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    this.tablesById.delete(table.id().toString());
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  async insert(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _: IExecutionContext,
    __: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async update(
    _: IExecutionContext,
    table: Table,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  async publish(_: IExecutionContext, __: IDomainEvent): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async publishMany(
    _: IExecutionContext,
    __: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
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

class CountingUnitOfWork extends FakeUnitOfWork {
  transactionCount = 0;

  override async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    this.transactionCount += 1;
    return super.withTransaction(context, work);
  }
}

describe('TableDeletionSideEffectService', () => {
  it('converts incoming links to text and marks all foreign-table dependents errored', async () => {
    const deletedTable = createDeletedTable();
    const hostTable = createHostTable(deletedTable);
    const tableRepository = new FakeTableRepository(
      new Map([
        [deletedTable.id().toString(), deletedTable],
        [hostTable.id().toString(), hostTable],
      ])
    );
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );
    const fieldUpdateSideEffectService = new FieldUpdateSideEffectService(
      tableUpdateFlow,
      tableRepository,
      new LinkFieldUpdateSideEffectService(tableUpdateFlow),
      new FieldCrossTableUpdateSideEffectService(tableRepository, tableUpdateFlow)
    );
    const service = new TableDeletionSideEffectService(
      tableRepository,
      tableUpdateFlow,
      fieldUpdateSideEffectService
    );

    const result = await service.execute(createContext(), { table: deletedTable });
    const updatedTables = result._unsafeUnwrap().updatedTables;
    const updatedHost = updatedTables.find((table) => table.id().equals(hostTable.id()));
    expect(updatedHost).toBeDefined();
    if (!updatedHost) return;

    const linkField = updatedHost.getFields((field) => field.name().toString() === 'Link').at(0);
    const lookupField = updatedHost
      .getFields((field) => field.name().toString() === 'Lookup')
      .at(0);
    const rollupField = updatedHost
      .getFields((field) => field.name().toString() === 'Rollup')
      .at(0);
    const conditionalLookupField = updatedHost
      .getFields((field) => field.name().toString() === 'Conditional Lookup')
      .at(0);
    const conditionalRollupField = updatedHost
      .getFields((field) => field.name().toString() === 'Conditional Rollup')
      .at(0);

    expect(linkField?.type().toString()).toBe('singleLineText');
    expect(lookupField?.hasError().isError()).toBe(true);
    expect(rollupField?.hasError().isError()).toBe(true);
    expect(conditionalLookupField?.hasError().isError()).toBe(true);
    expect(conditionalRollupField?.hasError().isError()).toBe(true);
  });

  it('keeps hook-bearing link conversion isolated and batches the remaining delete-table reactions', async () => {
    const deletedTable = createDeletedTable();
    const hostTable = createHostTable(deletedTable);
    const tableRepository = new FakeTableRepository(
      new Map([
        [deletedTable.id().toString(), deletedTable],
        [hostTable.id().toString(), hostTable],
      ])
    );
    const unitOfWork = new CountingUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      unitOfWork
    );
    const fieldUpdateSideEffectService = new FieldUpdateSideEffectService(
      tableUpdateFlow,
      tableRepository,
      new LinkFieldUpdateSideEffectService(tableUpdateFlow),
      new FieldCrossTableUpdateSideEffectService(tableRepository, tableUpdateFlow)
    );
    const service = new TableDeletionSideEffectService(
      tableRepository,
      tableUpdateFlow,
      fieldUpdateSideEffectService
    );

    const result = await service.execute(createContext(), { table: deletedTable });
    expect(result.isOk()).toBe(true);
    expect(unitOfWork.transactionCount).toBe(4);
  });

  it('reacts to cross-base incoming references when deleting a foreign table', async () => {
    const deletedTable = createDeletedTable();
    const otherBaseId = BaseId.create(`bse${'z'.repeat(16)}`)._unsafeUnwrap();
    const hostTable = createHostTable(deletedTable, {
      baseId: otherBaseId,
      crossBase: true,
    });
    const tableRepository = new FakeTableRepository(
      new Map([
        [deletedTable.id().toString(), deletedTable],
        [hostTable.id().toString(), hostTable],
      ])
    );
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );
    const fieldUpdateSideEffectService = new FieldUpdateSideEffectService(
      tableUpdateFlow,
      tableRepository,
      new LinkFieldUpdateSideEffectService(tableUpdateFlow),
      new FieldCrossTableUpdateSideEffectService(tableRepository, tableUpdateFlow)
    );
    const service = new TableDeletionSideEffectService(
      tableRepository,
      tableUpdateFlow,
      fieldUpdateSideEffectService
    );

    const result = await service.execute(createContext(), { table: deletedTable });
    const updatedTables = result._unsafeUnwrap().updatedTables;
    const updatedHost = updatedTables.find((table) => table.id().equals(hostTable.id()));
    expect(updatedHost).toBeDefined();
    if (!updatedHost) return;

    const linkField = updatedHost.getFields((field) => field.name().toString() === 'Link').at(0);
    const lookupField = updatedHost
      .getFields((field) => field.name().toString() === 'Lookup')
      .at(0);

    expect(updatedHost.baseId().equals(otherBaseId)).toBe(true);
    expect(linkField?.type().toString()).toBe('singleLineText');
    expect(lookupField?.hasError().isError()).toBe(true);
  });
});
