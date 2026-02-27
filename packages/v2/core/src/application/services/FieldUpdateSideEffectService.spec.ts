import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { Field } from '../../domain/table/fields/Field';
import { createNewLinkField } from '../../domain/table/fields/FieldFactory';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { LinkField } from '../../domain/table/fields/types/LinkField';
import { LinkFieldConfig } from '../../domain/table/fields/types/LinkFieldConfig';
import { NumberField } from '../../domain/table/fields/types/NumberField';
import { SingleLineTextField } from '../../domain/table/fields/types/SingleLineTextField';
import { ForeignTable } from '../../domain/table/ForeignTable';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { TableUpdateFieldTypeSpec } from '../../domain/table/specs/TableUpdateFieldTypeSpec';
import { TableUpdateViewColumnMetaSpec } from '../../domain/table/specs/TableUpdateViewColumnMetaSpec';
import { TableUpdateViewQueryDefaultsSpec } from '../../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import { ViewColumnMeta } from '../../domain/table/views/ViewColumnMeta';
import { ViewQueryDefaults } from '../../domain/table/views/ViewQueryDefaults';
import { CloneViewVisitor } from '../../domain/table/views/visitors/CloneViewVisitor';
import type { IEventBus } from '../../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import { MemoryTableRepository } from '../../ports/memory/MemoryTableRepository';
import type { ITableRepository } from '../../ports/TableRepository';
import type { ITableSchemaRepository } from '../../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../../ports/UnitOfWork';
import { FieldCrossTableUpdateSideEffectService } from './FieldCrossTableUpdateSideEffectService';
import { FieldUpdateSideEffectService } from './FieldUpdateSideEffectService';
import { LinkFieldUpdateSideEffectService } from './LinkFieldUpdateSideEffectService';
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
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
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

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildFlow = (repo: ITableRepository) =>
  new TableUpdateFlow(
    repo,
    new FakeTableSchemaRepository(),
    new FakeEventBus(),
    new FakeUnitOfWork()
  );

const buildTable = (params: {
  baseId: BaseId;
  tableId: TableId;
  tableName: string;
  primaryFieldId: FieldId;
  primaryFieldName: string;
}) => {
  const builder = Table.builder()
    .withId(params.tableId)
    .withBaseId(params.baseId)
    .withName(TableName.create(params.tableName)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(params.primaryFieldId)
    .withName(FieldName.create(params.primaryFieldName)._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildFieldSpec = (
  build: (builder: ReturnType<typeof Field.specs>) => ReturnType<typeof Field.specs>
) => build(Field.specs()).build()._unsafeUnwrap();

const buildConversionScenario = (params: { withFilter: boolean; withStatisticFunc: boolean }) => {
  const baseId = createBaseId('a');
  const tableId = createTableId('b');
  const primaryFieldId = createFieldId('c');
  const numberFieldId = createFieldId('d');

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('View Cleanup Host')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(numberFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  const baseTable = builder.build()._unsafeUnwrap();
  const baseView = baseTable.views()[0]!;
  const clonedView = baseView.accept(new CloneViewVisitor())._unsafeUnwrap();

  const fieldIdText = numberFieldId.toString();
  const baseMeta = baseView.columnMeta()._unsafeUnwrap().toDto();
  const nextMeta = ViewColumnMeta.create({
    ...baseMeta,
    [fieldIdText]: {
      ...baseMeta[fieldIdText],
      statisticFunc: params.withStatisticFunc ? 'sum' : null,
    },
  })._unsafeUnwrap();
  clonedView.setColumnMeta(nextMeta)._unsafeUnwrap();

  const queryDefaults = params.withFilter
    ? ViewQueryDefaults.create({
        filter: {
          conjunction: 'and',
          items: [{ fieldId: fieldIdText, operator: 'isGreater', value: 1 }],
        },
      })._unsafeUnwrap()
    : ViewQueryDefaults.empty();
  clonedView.setQueryDefaults(queryDefaults)._unsafeUnwrap();

  const table = Table.rehydrate({
    id: baseTable.id(),
    baseId: baseTable.baseId(),
    name: baseTable.name(),
    fields: baseTable.getFields(),
    views: [clonedView],
    primaryFieldId: baseTable.primaryFieldId(),
  })._unsafeUnwrap();

  const oldField = table.getField((field) => field.id().equals(numberFieldId))._unsafeUnwrap();
  const convertedField = SingleLineTextField.create({
    id: numberFieldId,
    name: oldField.name(),
  })._unsafeUnwrap();
  const typeSpec = TableUpdateFieldTypeSpec.create(oldField, convertedField);
  const convertedTable = typeSpec.mutate(table)._unsafeUnwrap();
  const updatedField = convertedTable
    .getField((field): field is NumberField | SingleLineTextField =>
      field.id().equals(numberFieldId)
    )
    ._unsafeUnwrap();

  return {
    table: convertedTable,
    updatedField,
    updateSpecs: [typeSpec],
    fieldId: numberFieldId,
    viewId: clonedView.id(),
  };
};

describe('FieldUpdateSideEffectService', () => {
  it('prepare pre-creates symmetric field for text -> two-way manyOne conversion', async () => {
    const context = createContext();
    const repo = new MemoryTableRepository();
    const flow = buildFlow(repo);
    const service = new FieldUpdateSideEffectService(
      flow,
      repo,
      new LinkFieldUpdateSideEffectService(flow),
      new FieldCrossTableUpdateSideEffectService(repo, flow)
    );

    const baseId = createBaseId('z');
    const hostTableId = createTableId('1');
    const foreignTableId = createTableId('2');
    const hostPrimaryFieldId = createFieldId('3');
    const foreignPrimaryFieldId = createFieldId('4');
    const convertFieldId = createFieldId('5');

    const hostTable = buildTable({
      baseId,
      tableId: hostTableId,
      tableName: 'Prepare Host',
      primaryFieldId: hostPrimaryFieldId,
      primaryFieldName: 'Title',
    });

    const foreignTable = buildTable({
      baseId,
      tableId: foreignTableId,
      tableName: 'Prepare Foreign',
      primaryFieldId: foreignPrimaryFieldId,
      primaryFieldName: 'Foreign Title',
    });

    const previousField = SingleLineTextField.create({
      id: convertFieldId,
      name: FieldName.create('ToLink')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const hostWithTextField = hostTable.addField(previousField)._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryFieldId.toString(),
      isOneWay: false,
    })._unsafeUnwrap();
    const updatedField = createNewLinkField({
      id: convertFieldId,
      name: FieldName.create('ToLink')._unsafeUnwrap(),
      config: linkConfig,
      baseId,
      hostTableId,
    })._unsafeUnwrap();

    await repo.insert(context, hostWithTextField);
    await repo.insert(context, foreignTable);

    const result = await service.prepare(context, {
      table: hostWithTextField,
      updatedField,
      previousField,
      updateSpecs: [],
      foreignTables: [foreignTable],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const foreignInRepo = repo.tables().find((t) => t.id().equals(foreignTableId));
    expect(foreignInRepo).toBeDefined();
    if (!foreignInRepo) return;

    const symmetricFields = foreignInRepo.getFields(buildFieldSpec((builder) => builder.isLink()));
    expect(symmetricFields).toHaveLength(1);

    const symmetricField = symmetricFields[0] as LinkField;
    expect(symmetricField.relationship().toString()).toBe('oneMany');
    expect(symmetricField.symmetricFieldId()?.equals(convertFieldId)).toBe(true);
  });

  it('builds view query defaults cleanup spec after number -> text conversion', async () => {
    const context = createContext();
    const repo = new MemoryTableRepository();
    const flow = buildFlow(repo);
    const service = new FieldUpdateSideEffectService(
      flow,
      repo,
      new LinkFieldUpdateSideEffectService(flow),
      new FieldCrossTableUpdateSideEffectService(repo, flow)
    );

    const scenario = buildConversionScenario({ withFilter: true, withStatisticFunc: false });
    await repo.insert(context, scenario.table);

    const result = await service.execute(context, {
      table: scenario.table,
      updatedField: scenario.updatedField,
      updateSpecs: scenario.updateSpecs,
      foreignTables: [],
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const queryDefaultsSpec = result.value.specs.find(
      (spec): spec is TableUpdateViewQueryDefaultsSpec =>
        spec instanceof TableUpdateViewQueryDefaultsSpec
    );
    expect(queryDefaultsSpec).toBeDefined();
    if (!queryDefaultsSpec) return;

    const update = queryDefaultsSpec.updates()[0];
    expect(queryDefaultsSpec.updates()).toHaveLength(1);
    expect(update?.viewId.equals(scenario.viewId)).toBe(true);
    expect(update?.queryDefaults.filter()).toBeNull();

    const columnMetaSpec = result.value.specs.find(
      (spec): spec is TableUpdateViewColumnMetaSpec => spec instanceof TableUpdateViewColumnMetaSpec
    );
    expect(columnMetaSpec).toBeUndefined();
  });

  it('builds view columnMeta cleanup spec after number -> text conversion', async () => {
    const context = createContext();
    const repo = new MemoryTableRepository();
    const flow = buildFlow(repo);
    const service = new FieldUpdateSideEffectService(
      flow,
      repo,
      new LinkFieldUpdateSideEffectService(flow),
      new FieldCrossTableUpdateSideEffectService(repo, flow)
    );

    const scenario = buildConversionScenario({ withFilter: false, withStatisticFunc: true });
    await repo.insert(context, scenario.table);

    const result = await service.execute(context, {
      table: scenario.table,
      updatedField: scenario.updatedField,
      updateSpecs: scenario.updateSpecs,
      foreignTables: [],
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const columnMetaSpec = result.value.specs.find(
      (spec): spec is TableUpdateViewColumnMetaSpec => spec instanceof TableUpdateViewColumnMetaSpec
    );
    expect(columnMetaSpec).toBeDefined();
    if (!columnMetaSpec) return;

    const update = columnMetaSpec.updates()[0];
    const updatedMeta = update?.columnMeta.toDto() ?? {};
    expect(columnMetaSpec.updates()).toHaveLength(1);
    expect(update?.viewId.equals(scenario.viewId)).toBe(true);
    expect(update?.fieldId.equals(scenario.fieldId)).toBe(true);
    expect(updatedMeta[scenario.fieldId.toString()]?.statisticFunc).toBeNull();

    const queryDefaultsSpec = result.value.specs.find(
      (spec): spec is TableUpdateViewQueryDefaultsSpec =>
        spec instanceof TableUpdateViewQueryDefaultsSpec
    );
    expect(queryDefaultsSpec).toBeUndefined();
  });

  it('creates symmetric field on foreign table when converting text -> link (two-way)', async () => {
    const context = createContext();
    const repo = new MemoryTableRepository();
    const flow = buildFlow(repo);
    const service = new FieldUpdateSideEffectService(
      flow,
      repo,
      new LinkFieldUpdateSideEffectService(flow),
      new FieldCrossTableUpdateSideEffectService(repo, flow)
    );

    const baseId = createBaseId('e');
    const hostTableId = createTableId('f');
    const foreignTableId = createTableId('g');
    const hostPrimaryFieldId = createFieldId('h');
    const foreignPrimaryFieldId = createFieldId('i');
    const convertFieldId = createFieldId('j');

    const hostTable = buildTable({
      baseId,
      tableId: hostTableId,
      tableName: 'Host',
      primaryFieldId: hostPrimaryFieldId,
      primaryFieldName: 'Title',
    });

    const foreignTable = buildTable({
      baseId,
      tableId: foreignTableId,
      tableName: 'Foreign',
      primaryFieldId: foreignPrimaryFieldId,
      primaryFieldName: 'Foreign Title',
    });

    // The previous field is a SingleLineTextField
    const previousField = SingleLineTextField.create({
      id: convertFieldId,
      name: FieldName.create('MyField')._unsafeUnwrap(),
    })._unsafeUnwrap();

    // Add the text field to the host table
    const hostWithTextField = hostTable.addField(previousField)._unsafeUnwrap();

    // The updated field is a two-way LinkField (manyOne)
    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryFieldId.toString(),
    })._unsafeUnwrap();

    const linkField = createNewLinkField({
      id: convertFieldId,
      name: FieldName.create('MyField')._unsafeUnwrap(),
      config: linkConfig,
      baseId,
      hostTableId,
    })._unsafeUnwrap();

    const typeSpec = TableUpdateFieldTypeSpec.create(previousField, linkField);
    const convertedTable = typeSpec.mutate(hostWithTextField)._unsafeUnwrap();
    const updatedField = convertedTable
      .getField((f) => f.id().equals(convertFieldId))
      ._unsafeUnwrap();

    // Insert both tables into repo
    await repo.insert(context, convertedTable);
    await repo.insert(context, foreignTable);

    const result = await service.execute(context, {
      table: convertedTable,
      updatedField,
      previousField,
      updateSpecs: [typeSpec],
      foreignTables: [foreignTable],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    // Verify the foreign table in the repo now has a symmetric link field
    const foreignInRepo = repo.tables().find((t) => t.id().equals(foreignTableId));
    expect(foreignInRepo).toBeDefined();
    if (!foreignInRepo) return;

    const symmetricFields = foreignInRepo.getFields(buildFieldSpec((builder) => builder.isLink()));
    expect(symmetricFields).toHaveLength(1);

    const symmetricField = symmetricFields[0] as LinkField;
    expect(symmetricField.relationship().toString()).toBe('oneMany');
    expect(symmetricField.symmetricFieldId()?.equals(convertFieldId)).toBe(true);
  });

  it('deletes symmetric field from foreign table when converting link -> text', async () => {
    const context = createContext();
    const repo = new MemoryTableRepository();
    const flow = buildFlow(repo);
    const service = new FieldUpdateSideEffectService(
      flow,
      repo,
      new LinkFieldUpdateSideEffectService(flow),
      new FieldCrossTableUpdateSideEffectService(repo, flow)
    );

    const baseId = createBaseId('k');
    const hostTableId = createTableId('l');
    const foreignTableId = createTableId('m');
    const hostPrimaryFieldId = createFieldId('n');
    const foreignPrimaryFieldId = createFieldId('o');
    const linkFieldId = createFieldId('p');

    const hostTable = buildTable({
      baseId,
      tableId: hostTableId,
      tableName: 'Host',
      primaryFieldId: hostPrimaryFieldId,
      primaryFieldName: 'Title',
    });

    const foreignTable = buildTable({
      baseId,
      tableId: foreignTableId,
      tableName: 'Foreign',
      primaryFieldId: foreignPrimaryFieldId,
      primaryFieldName: 'Foreign Title',
    });

    // Create a two-way link field on the host table
    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryFieldId.toString(),
    })._unsafeUnwrap();

    const linkField = createNewLinkField({
      id: linkFieldId,
      name: FieldName.create('Link')._unsafeUnwrap(),
      config: linkConfig,
      baseId,
      hostTableId,
    })._unsafeUnwrap() as LinkField;

    // Build symmetric field and add it to the foreign table
    const symmetricField = linkField
      .buildSymmetricField({
        foreignTable: ForeignTable.from(foreignTable),
        hostTable,
      })
      ._unsafeUnwrap();

    const foreignWithSymmetric = foreignTable
      .update((mutator) => mutator.addField(symmetricField, { foreignTables: [hostTable] }))
      ._unsafeUnwrap().table;

    // Add link field to host table
    const hostWithLink = hostTable.addField(linkField)._unsafeUnwrap();

    // Now convert link -> text
    const textField = SingleLineTextField.create({
      id: linkFieldId,
      name: FieldName.create('Link')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const typeSpec = TableUpdateFieldTypeSpec.create(linkField, textField);
    const convertedTable = typeSpec.mutate(hostWithLink)._unsafeUnwrap();
    const updatedField = convertedTable.getField((f) => f.id().equals(linkFieldId))._unsafeUnwrap();

    // Insert both tables into repo
    await repo.insert(context, convertedTable);
    await repo.insert(context, foreignWithSymmetric);

    const result = await service.execute(context, {
      table: convertedTable,
      updatedField,
      previousField: linkField,
      updateSpecs: [typeSpec],
      foreignTables: [foreignWithSymmetric],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    // Verify the foreign table in the repo no longer has the symmetric link field
    const foreignInRepo = repo.tables().find((t) => t.id().equals(foreignTableId));
    expect(foreignInRepo).toBeDefined();
    if (!foreignInRepo) return;

    const linkFields = foreignInRepo.getFields(buildFieldSpec((builder) => builder.isLink()));
    expect(linkFields).toHaveLength(0);
  });

  it('replaces symmetric field when converting two-way link to another foreign table', async () => {
    const context = createContext();
    const repo = new MemoryTableRepository();
    const flow = buildFlow(repo);
    const service = new FieldUpdateSideEffectService(
      flow,
      repo,
      new LinkFieldUpdateSideEffectService(flow),
      new FieldCrossTableUpdateSideEffectService(repo, flow)
    );

    const baseId = createBaseId('r');
    const hostTableId = createTableId('s');
    const oldForeignTableId = createTableId('t');
    const newForeignTableId = createTableId('u');
    const hostPrimaryFieldId = createFieldId('v');
    const oldForeignPrimaryFieldId = createFieldId('w');
    const newForeignPrimaryFieldId = createFieldId('x');
    const linkFieldId = createFieldId('y');

    const hostTable = buildTable({
      baseId,
      tableId: hostTableId,
      tableName: 'Host',
      primaryFieldId: hostPrimaryFieldId,
      primaryFieldName: 'Title',
    });

    const oldForeignTable = buildTable({
      baseId,
      tableId: oldForeignTableId,
      tableName: 'Old Foreign',
      primaryFieldId: oldForeignPrimaryFieldId,
      primaryFieldName: 'Old Foreign Title',
    });

    const newForeignTable = buildTable({
      baseId,
      tableId: newForeignTableId,
      tableName: 'New Foreign',
      primaryFieldId: newForeignPrimaryFieldId,
      primaryFieldName: 'New Foreign Title',
    });

    const oldLinkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: oldForeignTableId.toString(),
      lookupFieldId: oldForeignPrimaryFieldId.toString(),
    })._unsafeUnwrap();

    const oldLinkField = createNewLinkField({
      id: linkFieldId,
      name: FieldName.create('Link')._unsafeUnwrap(),
      config: oldLinkConfig,
      baseId,
      hostTableId,
    })._unsafeUnwrap() as LinkField;

    const oldSymmetricField = oldLinkField
      .buildSymmetricField({
        foreignTable: ForeignTable.from(oldForeignTable),
        hostTable,
      })
      ._unsafeUnwrap();

    const oldForeignWithSymmetric = oldForeignTable
      .update((mutator) => mutator.addField(oldSymmetricField, { foreignTables: [hostTable] }))
      ._unsafeUnwrap().table;

    const hostWithOldLink = hostTable.addField(oldLinkField)._unsafeUnwrap();

    const newLinkConfig = LinkFieldConfig.create({
      relationship: 'oneMany',
      foreignTableId: newForeignTableId.toString(),
      lookupFieldId: newForeignPrimaryFieldId.toString(),
    })._unsafeUnwrap();

    const newLinkField = createNewLinkField({
      id: linkFieldId,
      name: FieldName.create('Link')._unsafeUnwrap(),
      config: newLinkConfig,
      baseId,
      hostTableId,
    })._unsafeUnwrap() as LinkField;

    const typeSpec = TableUpdateFieldTypeSpec.create(oldLinkField, newLinkField);
    const convertedTable = typeSpec.mutate(hostWithOldLink)._unsafeUnwrap();
    const updatedField = convertedTable
      .getField((field) => field.id().equals(linkFieldId))
      ._unsafeUnwrap();

    await repo.insert(context, convertedTable);
    await repo.insert(context, oldForeignWithSymmetric);
    await repo.insert(context, newForeignTable);

    const result = await service.execute(context, {
      table: convertedTable,
      updatedField,
      previousField: oldLinkField,
      updateSpecs: [typeSpec],
      foreignTables: [oldForeignWithSymmetric, newForeignTable],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const oldForeignInRepo = repo.tables().find((table) => table.id().equals(oldForeignTableId));
    expect(oldForeignInRepo).toBeDefined();
    if (!oldForeignInRepo) return;

    const oldForeignLinkFields = oldForeignInRepo.getFields(
      buildFieldSpec((builder) => builder.isLink())
    );
    expect(oldForeignLinkFields).toHaveLength(0);

    const newForeignInRepo = repo.tables().find((table) => table.id().equals(newForeignTableId));
    expect(newForeignInRepo).toBeDefined();
    if (!newForeignInRepo) return;

    const newForeignLinkFields = newForeignInRepo.getFields(
      buildFieldSpec((builder) => builder.isLink())
    );
    expect(newForeignLinkFields).toHaveLength(1);

    const newSymmetricField = newForeignLinkFields[0] as LinkField;
    expect(newSymmetricField.relationship().toString()).toBe('manyOne');
    expect(newSymmetricField.foreignTableId().equals(hostTableId)).toBe(true);
    expect(newSymmetricField.symmetricFieldId()?.equals(linkFieldId)).toBe(true);
  });

  it('skips symmetric side effects for one-way link conversion', async () => {
    const context = createContext();
    const repo = new MemoryTableRepository();
    const flow = buildFlow(repo);
    const service = new FieldUpdateSideEffectService(
      flow,
      repo,
      new LinkFieldUpdateSideEffectService(flow),
      new FieldCrossTableUpdateSideEffectService(repo, flow)
    );

    const baseId = createBaseId('q');
    const hostTableId = createTableId('r');
    const foreignTableId = createTableId('s');
    const hostPrimaryFieldId = createFieldId('t');
    const foreignPrimaryFieldId = createFieldId('u');
    const convertFieldId = createFieldId('v');

    const hostTable = buildTable({
      baseId,
      tableId: hostTableId,
      tableName: 'Host',
      primaryFieldId: hostPrimaryFieldId,
      primaryFieldName: 'Title',
    });

    const foreignTable = buildTable({
      baseId,
      tableId: foreignTableId,
      tableName: 'Foreign',
      primaryFieldId: foreignPrimaryFieldId,
      primaryFieldName: 'Foreign Title',
    });

    // The previous field is a SingleLineTextField
    const previousField = SingleLineTextField.create({
      id: convertFieldId,
      name: FieldName.create('MyField')._unsafeUnwrap(),
    })._unsafeUnwrap();

    const hostWithTextField = hostTable.addField(previousField)._unsafeUnwrap();

    // The updated field is a one-way LinkField
    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: foreignPrimaryFieldId.toString(),
      isOneWay: true,
    })._unsafeUnwrap();

    const linkField = createNewLinkField({
      id: convertFieldId,
      name: FieldName.create('MyField')._unsafeUnwrap(),
      config: linkConfig,
      baseId,
      hostTableId,
    })._unsafeUnwrap();

    const typeSpec = TableUpdateFieldTypeSpec.create(previousField, linkField);
    const convertedTable = typeSpec.mutate(hostWithTextField)._unsafeUnwrap();
    const updatedField = convertedTable
      .getField((f) => f.id().equals(convertFieldId))
      ._unsafeUnwrap();

    // Insert both tables into repo
    await repo.insert(context, convertedTable);
    await repo.insert(context, foreignTable);

    const result = await service.execute(context, {
      table: convertedTable,
      updatedField,
      previousField,
      updateSpecs: [typeSpec],
      foreignTables: [foreignTable],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    // Verify the foreign table has NO symmetric field (one-way link)
    const foreignInRepo = repo.tables().find((t) => t.id().equals(foreignTableId));
    expect(foreignInRepo).toBeDefined();
    if (!foreignInRepo) return;

    const linkFields = foreignInRepo.getFields(buildFieldSpec((builder) => builder.isLink()));
    expect(linkFields).toHaveLength(0);
  });
});
