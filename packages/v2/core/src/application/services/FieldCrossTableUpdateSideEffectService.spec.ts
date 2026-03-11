import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { DbFieldName } from '../../domain/table/fields/DbFieldName';
import {
  createConditionalLookupFieldPending,
  createLookupFieldPending,
  createNewLinkField,
} from '../../domain/table/fields/FieldFactory';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { ConditionalLookupField } from '../../domain/table/fields/types/ConditionalLookupField';
import { ConditionalLookupOptions } from '../../domain/table/fields/types/ConditionalLookupOptions';
import type { LinkField } from '../../domain/table/fields/types/LinkField';
import { LinkFieldConfig } from '../../domain/table/fields/types/LinkFieldConfig';
import type { LookupField } from '../../domain/table/fields/types/LookupField';
import { LookupOptions } from '../../domain/table/fields/types/LookupOptions';
import { NumberField } from '../../domain/table/fields/types/NumberField';
import { SelectOption } from '../../domain/table/fields/types/SelectOption';
import { SingleSelectField } from '../../domain/table/fields/types/SingleSelectField';
import { UpdateSingleSelectOptionsSpec } from '../../domain/table/specs/field-updates/UpdateSingleSelectOptionsSpec';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { TableByIdSpec } from '../../domain/table/specs/TableByIdSpec';
import { TableUpdateFieldTypeSpec } from '../../domain/table/specs/TableUpdateFieldTypeSpec';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IEventBus } from '../../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import { MemoryTableRepository } from '../../ports/memory/MemoryTableRepository';
import type { ITableRepository } from '../../ports/TableRepository';
import type { ITableSchemaRepository } from '../../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../../ports/UnitOfWork';
import { FieldCrossTableUpdateSideEffectService } from './FieldCrossTableUpdateSideEffectService';
import { TableUpdateFlow } from './TableUpdateFlow';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

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
    ___: ISpecification<Table, ITableSpecVisitor>
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

const buildTable = (params: {
  baseId: BaseId;
  tableId: TableId;
  tableName: string;
  primaryFieldId: FieldId;
  primaryFieldName: string;
}) => {
  const name = TableName.create(params.tableName)._unsafeUnwrap();
  const primaryName = FieldName.create(params.primaryFieldName)._unsafeUnwrap();

  const builder = Table.builder().withId(params.tableId).withBaseId(params.baseId).withName(name);
  builder
    .field()
    .singleLineText()
    .withId(params.primaryFieldId)
    .withName(primaryName)
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildFlow = (repo: ITableRepository) =>
  new TableUpdateFlow(
    repo,
    new FakeTableSchemaRepository(),
    new FakeEventBus(),
    new FakeUnitOfWork()
  );

describe('FieldCrossTableUpdateSideEffectService', () => {
  it('cleans link filter when referenced foreign field is type-converted', async () => {
    const context = createContext();
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();

    const hostTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
    const hostPrimaryId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const foreignPrimaryId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
    const filterFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();

    const hostTable = buildTable({
      baseId,
      tableId: hostTableId,
      tableName: 'Host',
      primaryFieldId: hostPrimaryId,
      primaryFieldName: 'Host Name',
    });

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .singleSelect()
      .withId(filterFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions([SelectOption.create({ name: 'x', color: 'blue' })._unsafeUnwrap()])
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTable.id().toString(),
      lookupFieldId: foreignTable.primaryFieldId().toString(),
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: filterFieldId.toString(), operator: 'is', value: 'x' }],
      },
    })._unsafeUnwrap();
    const linkField = createNewLinkField({
      id: linkFieldId,
      name: FieldName.create('Link')._unsafeUnwrap(),
      config: linkConfig,
      baseId,
      hostTableId: hostTable.id(),
    })._unsafeUnwrap() as LinkField;

    const hostWithLink = hostTable
      .update((mutator) => mutator.addField(linkField, { foreignTables: [foreignTable] }))
      ._unsafeUnwrap().table;

    const oldField = foreignTable
      .getField((field) => field.id().equals(filterFieldId))
      ._unsafeUnwrap();
    const convertedField = NumberField.create({
      id: oldField.id(),
      name: oldField.name(),
    })._unsafeUnwrap();
    const typeSpec = TableUpdateFieldTypeSpec.create(oldField, convertedField);
    const convertedForeign = typeSpec.mutate(foreignTable)._unsafeUnwrap();
    const updatedField = convertedForeign
      .getField((field) => field.id().equals(filterFieldId))
      ._unsafeUnwrap();

    const repo = new MemoryTableRepository();
    await repo.insert(context, hostWithLink);
    await repo.insert(context, convertedForeign);

    const service = new FieldCrossTableUpdateSideEffectService(repo, buildFlow(repo));
    const result = await service.execute(context, {
      table: convertedForeign,
      updatedField,
      updateSpecs: [typeSpec],
    });
    expect(result.isOk()).toBe(true);

    const persistedHost = await repo.findOne(context, TableByIdSpec.create(hostWithLink.id()));
    expect(persistedHost.isOk()).toBe(true);
    const updatedLink = persistedHost
      ._unsafeUnwrap()
      .getField((field) => field.id().equals(linkFieldId))
      ._unsafeUnwrap() as LinkField;
    expect(updatedLink.config().filter()).toBeNull();
  });

  it('does nothing when update is not a type conversion', async () => {
    const context = createContext();
    const baseId = BaseId.create(`bse${'h'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'i'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldId = FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap();
    const table = buildTable({
      baseId,
      tableId,
      tableName: 'Simple',
      primaryFieldId,
      primaryFieldName: 'Name',
    });

    const repo = new MemoryTableRepository();
    await repo.insert(context, table);
    const service = new FieldCrossTableUpdateSideEffectService(repo, buildFlow(repo));

    const result = await service.execute(context, {
      table,
      updatedField: table.getFields()[0]!,
      updateSpecs: [],
    });
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('syncs linked filter values when select options are renamed in a foreign table', async () => {
    const context = createContext();
    const baseId = BaseId.create(`bse${'k'.repeat(16)}`)._unsafeUnwrap();

    const hostTableId = TableId.create(`tbl${'l'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'m'.repeat(16)}`)._unsafeUnwrap();
    const hostPrimaryId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
    const foreignPrimaryId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();
    const statusFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'r'.repeat(16)}`)._unsafeUnwrap();
    const conditionalLookupFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();

    const hostTable = buildTable({
      baseId,
      tableId: hostTableId,
      tableName: 'Host',
      primaryFieldId: hostPrimaryId,
      primaryFieldName: 'Host Name',
    });

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Foreign')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .singleSelect()
      .withId(statusFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions([
        SelectOption.create({ name: 'Active', color: 'blue' })._unsafeUnwrap(),
        SelectOption.create({ name: 'Closed', color: 'red' })._unsafeUnwrap(),
      ])
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTable.id().toString(),
      lookupFieldId: foreignTable.primaryFieldId().toString(),
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
      },
    })._unsafeUnwrap();
    const linkField = createNewLinkField({
      id: linkFieldId,
      name: FieldName.create('Link')._unsafeUnwrap(),
      config: linkConfig,
      baseId,
      hostTableId: hostTable.id(),
    })._unsafeUnwrap() as LinkField;

    const lookupOptions = LookupOptions.create({
      linkFieldId: linkFieldId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
      foreignTableId: foreignTableId.toString(),
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
      },
    })._unsafeUnwrap();
    const lookupField = createLookupFieldPending({
      id: lookupFieldId,
      name: FieldName.create('Lookup')._unsafeUnwrap(),
      lookupOptions,
    })._unsafeUnwrap() as LookupField;

    const conditionalLookupOptions = ConditionalLookupOptions.create({
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryId.toString(),
      condition: {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
        },
      },
    })._unsafeUnwrap();
    const conditionalLookupField = createConditionalLookupFieldPending({
      id: conditionalLookupFieldId,
      name: FieldName.create('Conditional Lookup')._unsafeUnwrap(),
      conditionalLookupOptions,
    })._unsafeUnwrap() as ConditionalLookupField;

    const hostWithLink = hostTable
      .update((mutator) => mutator.addField(linkField, { foreignTables: [foreignTable] }))
      ._unsafeUnwrap().table;
    const hostWithLookup = hostWithLink
      .update((mutator) => mutator.addField(lookupField, { foreignTables: [foreignTable] }))
      ._unsafeUnwrap().table;
    const hostWithConditionalLookup = hostWithLookup
      .update((mutator) =>
        mutator.addField(conditionalLookupField, { foreignTables: [foreignTable] })
      )
      ._unsafeUnwrap().table;

    const oldField = foreignTable
      .getField((field) => field.id().equals(statusFieldId))
      ._unsafeUnwrap() as SingleSelectField;
    const previousOptions = oldField.selectOptions();
    const nextOptions = previousOptions.map((option) =>
      SelectOption.create({
        id: option.id().toString(),
        name: option.name().toString() === 'Active' ? 'Active Plus' : option.name().toString(),
        color: option.color().toString(),
      })._unsafeUnwrap()
    );
    const optionsSpec = UpdateSingleSelectOptionsSpec.create(
      statusFieldId,
      DbFieldName.rehydrate('status')._unsafeUnwrap(),
      previousOptions,
      nextOptions
    );
    const updatedForeign = optionsSpec.mutate(foreignTable)._unsafeUnwrap();
    const updatedField = updatedForeign
      .getField((field) => field.id().equals(statusFieldId))
      ._unsafeUnwrap();

    const repo = new MemoryTableRepository();
    await repo.insert(context, hostWithConditionalLookup);
    await repo.insert(context, updatedForeign);

    const service = new FieldCrossTableUpdateSideEffectService(repo, buildFlow(repo));
    const result = await service.execute(context, {
      table: updatedForeign,
      updatedField,
      updateSpecs: [optionsSpec],
    });
    expect(result.isOk()).toBe(true);

    const persistedHost = await repo.findOne(
      context,
      TableByIdSpec.create(hostWithConditionalLookup.id())
    );
    expect(persistedHost.isOk()).toBe(true);
    const host = persistedHost._unsafeUnwrap();

    const updatedLink = host
      .getField((field) => field.id().equals(linkFieldId))
      ._unsafeUnwrap() as LinkField;
    expect(
      (updatedLink.config().filter() as { filterSet: Array<{ value?: unknown }> }).filterSet[0]
        ?.value
    ).toBe('Active Plus');

    const updatedLookup = host
      .getField((field) => field.id().equals(lookupFieldId))
      ._unsafeUnwrap() as LookupField;
    expect(
      (
        updatedLookup.lookupOptions().condition()?.toDto().filter as {
          filterSet: Array<{ value?: unknown }>;
        }
      ).filterSet[0]?.value
    ).toBe('Active Plus');

    const updatedConditionalLookup = host
      .getField((field) => field.id().equals(conditionalLookupFieldId))
      ._unsafeUnwrap() as ConditionalLookupField;
    expect(
      (
        updatedConditionalLookup.conditionalLookupOptions().condition().toDto().filter as {
          filterSet: Array<{ value?: unknown }>;
        }
      ).filterSet[0]?.value
    ).toBe('Active Plus');
  });

  it('propagates select option renames across multiple cross-table hops', async () => {
    const context = createContext();
    const baseId = BaseId.create(`bse${'1'.repeat(16)}`)._unsafeUnwrap();

    const sourceTableId = TableId.create(`tbl${'2'.repeat(16)}`)._unsafeUnwrap();
    const middleTableId = TableId.create(`tbl${'3'.repeat(16)}`)._unsafeUnwrap();
    const hostTableId = TableId.create(`tbl${'4'.repeat(16)}`)._unsafeUnwrap();

    const sourcePrimaryId = FieldId.create(`fld${'5'.repeat(16)}`)._unsafeUnwrap();
    const middlePrimaryId = FieldId.create(`fld${'6'.repeat(16)}`)._unsafeUnwrap();
    const hostPrimaryId = FieldId.create(`fld${'7'.repeat(16)}`)._unsafeUnwrap();

    const statusFieldId = FieldId.create(`fld${'8'.repeat(16)}`)._unsafeUnwrap();
    const conditionalLookupFieldId = FieldId.create(`fld${'9'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();

    const sourceBuilder = Table.builder()
      .withId(sourceTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Source')._unsafeUnwrap());
    sourceBuilder
      .field()
      .singleLineText()
      .withId(sourcePrimaryId)
      .withName(FieldName.create('Source Name')._unsafeUnwrap())
      .primary()
      .done();
    sourceBuilder
      .field()
      .singleSelect()
      .withId(statusFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions([
        SelectOption.create({ id: 'cho_active', name: 'Active', color: 'green' })._unsafeUnwrap(),
        SelectOption.create({ id: 'cho_closed', name: 'Closed', color: 'red' })._unsafeUnwrap(),
      ])
      .done();
    sourceBuilder.view().defaultGrid().done();
    const sourceTable = sourceBuilder.build()._unsafeUnwrap();

    const middleTable = buildTable({
      baseId,
      tableId: middleTableId,
      tableName: 'Middle',
      primaryFieldId: middlePrimaryId,
      primaryFieldName: 'Middle Name',
    });

    const conditionalLookup = createConditionalLookupFieldPending({
      id: conditionalLookupFieldId,
      name: FieldName.create('Conditional Status')._unsafeUnwrap(),
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: sourceTableId.toString(),
        lookupFieldId: statusFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: statusFieldId.toString(), operator: 'is', value: 'Active' }],
          },
        },
      })._unsafeUnwrap(),
    })._unsafeUnwrap() as ConditionalLookupField;

    const middleWithConditionalLookup = middleTable
      .update((mutator) => mutator.addField(conditionalLookup, { foreignTables: [sourceTable] }))
      ._unsafeUnwrap().table;

    const hostTable = buildTable({
      baseId,
      tableId: hostTableId,
      tableName: 'Host',
      primaryFieldId: hostPrimaryId,
      primaryFieldName: 'Host Name',
    });

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: middleTableId.toString(),
      lookupFieldId: middlePrimaryId.toString(),
      filter: {
        conjunction: 'and',
        filterSet: [
          { fieldId: conditionalLookupFieldId.toString(), operator: 'is', value: 'Active' },
        ],
      },
    })._unsafeUnwrap();
    const linkField = createNewLinkField({
      id: linkFieldId,
      name: FieldName.create('Middle Link')._unsafeUnwrap(),
      config: linkConfig,
      baseId,
      hostTableId: hostTable.id(),
    })._unsafeUnwrap() as LinkField;

    const hostWithLink = hostTable
      .update((mutator) =>
        mutator.addField(linkField, { foreignTables: [middleWithConditionalLookup] })
      )
      ._unsafeUnwrap().table;

    const oldStatusField = sourceTable
      .getField((field) => field.id().equals(statusFieldId))
      ._unsafeUnwrap() as SingleSelectField;
    const previousOptions = oldStatusField.selectOptions();
    const nextOptions = previousOptions.map((option) =>
      SelectOption.create({
        id: option.id().toString(),
        name: option.name().toString() === 'Active' ? 'Active Plus' : option.name().toString(),
        color: option.color().toString(),
      })._unsafeUnwrap()
    );
    const optionsSpec = UpdateSingleSelectOptionsSpec.create(
      statusFieldId,
      DbFieldName.rehydrate('status')._unsafeUnwrap(),
      previousOptions,
      nextOptions
    );
    const updatedSource = optionsSpec.mutate(sourceTable)._unsafeUnwrap();
    const updatedField = updatedSource
      .getField((field) => field.id().equals(statusFieldId))
      ._unsafeUnwrap();

    const repo = new MemoryTableRepository();
    await repo.insert(context, hostWithLink);
    await repo.insert(context, middleWithConditionalLookup);
    await repo.insert(context, updatedSource);

    const service = new FieldCrossTableUpdateSideEffectService(repo, buildFlow(repo));
    const result = await service.execute(context, {
      table: updatedSource,
      updatedField,
      updateSpecs: [optionsSpec],
    });
    expect(result.isOk()).toBe(true);

    const persistedHost = await repo.findOne(context, TableByIdSpec.create(hostWithLink.id()));
    expect(persistedHost.isOk()).toBe(true);
    const updatedLink = persistedHost
      ._unsafeUnwrap()
      .getField((field) => field.id().equals(linkFieldId))
      ._unsafeUnwrap() as LinkField;

    expect(
      (updatedLink.config().filter() as { filterSet: Array<{ value?: unknown }> }).filterSet[0]
        ?.value
    ).toBe('Active Plus');
  });

  it('syncs lookup inner select options when foreign target select options are appended', async () => {
    const context = createContext();
    const baseId = BaseId.create(`bse${'t'.repeat(16)}`)._unsafeUnwrap();

    const hostTableId = TableId.create(`tbl${'u'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap();
    const hostPrimaryId = FieldId.create(`fld${'w'.repeat(16)}`)._unsafeUnwrap();
    const foreignPrimaryId = FieldId.create(`fld${'x'.repeat(16)}`)._unsafeUnwrap();
    const statusFieldId = FieldId.create(`fld${'y'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'z'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();

    const hostTable = buildTable({
      baseId,
      tableId: hostTableId,
      tableName: 'Host 2',
      primaryFieldId: hostPrimaryId,
      primaryFieldName: 'Host Name',
    });

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Foreign 2')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(foreignPrimaryId)
      .withName(FieldName.create('Foreign Name')._unsafeUnwrap())
      .primary()
      .done();
    foreignBuilder
      .field()
      .singleSelect()
      .withId(statusFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions([SelectOption.create({ name: 'x', color: 'cyan' })._unsafeUnwrap()])
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTable.id().toString(),
      lookupFieldId: foreignTable.primaryFieldId().toString(),
    })._unsafeUnwrap();
    const linkField = createNewLinkField({
      id: linkFieldId,
      name: FieldName.create('Link')._unsafeUnwrap(),
      config: linkConfig,
      baseId,
      hostTableId: hostTable.id(),
    })._unsafeUnwrap() as LinkField;

    const lookupOptions = LookupOptions.create({
      linkFieldId: linkFieldId.toString(),
      lookupFieldId: statusFieldId.toString(),
      foreignTableId: foreignTableId.toString(),
    })._unsafeUnwrap();
    const lookupField = createLookupFieldPending({
      id: lookupFieldId,
      name: FieldName.create('Lookup Status')._unsafeUnwrap(),
      lookupOptions,
    })._unsafeUnwrap() as LookupField;

    const hostWithLink = hostTable
      .update((mutator) => mutator.addField(linkField, { foreignTables: [foreignTable] }))
      ._unsafeUnwrap().table;
    const hostWithLookup = hostWithLink
      .update((mutator) => mutator.addField(lookupField, { foreignTables: [foreignTable] }))
      ._unsafeUnwrap().table;

    const oldField = foreignTable
      .getField((field) => field.id().equals(statusFieldId))
      ._unsafeUnwrap() as SingleSelectField;
    const previousOptions = oldField.selectOptions();
    const nextOptions = [
      ...previousOptions,
      SelectOption.create({ name: 'y', color: 'blue' })._unsafeUnwrap(),
    ];
    const optionsSpec = UpdateSingleSelectOptionsSpec.create(
      statusFieldId,
      DbFieldName.rehydrate('status')._unsafeUnwrap(),
      previousOptions,
      nextOptions
    );
    const updatedForeign = optionsSpec.mutate(foreignTable)._unsafeUnwrap();
    const updatedField = updatedForeign
      .getField((field) => field.id().equals(statusFieldId))
      ._unsafeUnwrap();

    const repo = new MemoryTableRepository();
    await repo.insert(context, hostWithLookup);
    await repo.insert(context, updatedForeign);

    const service = new FieldCrossTableUpdateSideEffectService(repo, buildFlow(repo));
    const result = await service.execute(context, {
      table: updatedForeign,
      updatedField,
      updateSpecs: [optionsSpec],
    });
    expect(result.isOk()).toBe(true);

    const persistedHost = await repo.findOne(context, TableByIdSpec.create(hostWithLookup.id()));
    expect(persistedHost.isOk()).toBe(true);
    const updatedLookup = persistedHost
      ._unsafeUnwrap()
      .getField((field) => field.id().equals(lookupFieldId))
      ._unsafeUnwrap() as LookupField;

    const innerField = updatedLookup.innerField()._unsafeUnwrap();
    expect(innerField).toBeInstanceOf(SingleSelectField);
    const choices = (innerField as SingleSelectField).selectOptions();
    expect(choices).toHaveLength(2);
    expect(choices[0]?.name().toString()).toBe('x');
    expect(choices[1]?.name().toString()).toBe('y');
  });
});
