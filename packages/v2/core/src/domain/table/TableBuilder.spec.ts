import { describe, expect, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { Field } from './fields/Field';
import { FieldId } from './fields/FieldId';
import { FieldName } from './fields/FieldName';
import { FormulaExpression } from './fields/types/FormulaExpression';
import type { FormulaField } from './fields/types/FormulaField';
import type { LinkField } from './fields/types/LinkField';
import { LinkFieldConfig } from './fields/types/LinkFieldConfig';
import { RatingMax } from './fields/types/RatingMax';
import { RollupExpression } from './fields/types/RollupExpression';
import type { RollupField } from './fields/types/RollupField';
import { RollupFieldConfig } from './fields/types/RollupFieldConfig';
import { SelectOption } from './fields/types/SelectOption';
import { Table } from './Table';
import { TableId } from './TableId';
import { TableName } from './TableName';
import { ViewName } from './views/ViewName';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`);
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);
const buildFieldSpec = (
  build: (builder: ReturnType<typeof Field.specs>) => ReturnType<typeof Field.specs>
) => build(Field.specs()).build()._unsafeUnwrap();

describe('TableBuilder', () => {
  it('builds a table with fields and a view', () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const tableNameResult = TableName.create('My Table');
    [baseIdResult, tableNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();

    const titleNameResult = FieldName.create('Title');
    const amountNameResult = FieldName.create('Amount');
    const starsNameResult = FieldName.create('Stars');
    const statusNameResult = FieldName.create('Status');
    [titleNameResult, amountNameResult, starsNameResult, statusNameResult].forEach((r) =>
      r._unsafeUnwrap()
    );
    titleNameResult._unsafeUnwrap();
    amountNameResult._unsafeUnwrap();
    starsNameResult._unsafeUnwrap();
    statusNameResult._unsafeUnwrap();

    const todoOptionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
    const doneOptionResult = SelectOption.create({ name: 'Done', color: 'red' });
    [todoOptionResult, doneOptionResult].forEach((r) => r._unsafeUnwrap());
    todoOptionResult._unsafeUnwrap();
    doneOptionResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(titleNameResult._unsafeUnwrap()).done();
    builder.field().number().withName(amountNameResult._unsafeUnwrap()).done();
    builder
      .field()
      .rating()
      .withName(starsNameResult._unsafeUnwrap())
      .withMax(RatingMax.five())
      .done();
    builder
      .field()
      .singleSelect()
      .withName(statusNameResult._unsafeUnwrap())
      .withOptions([todoOptionResult._unsafeUnwrap(), doneOptionResult._unsafeUnwrap()])
      .done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();

    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();
    expect(table.getFields().length).toBe(4);
    expect(table.views().length).toBe(1);
    expect(table.views()[0]?.type().toString()).toBe('grid');
    expect(table.primaryFieldId().equals(table.getFields()[0].id())).toBe(true);
  });

  it('builds a table with all base field types', () => {
    const baseIdResult = BaseId.create(`bse${'f'.repeat(16)}`);
    const tableNameResult = TableName.create('All Fields');
    [baseIdResult, tableNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();

    const namesResult = [
      FieldName.create('Title'),
      FieldName.create('Description'),
      FieldName.create('Amount'),
      FieldName.create('Rating'),
      FieldName.create('Status'),
      FieldName.create('Tags'),
      FieldName.create('Done'),
      FieldName.create('Files'),
      FieldName.create('Due Date'),
      FieldName.create('Owner'),
      FieldName.create('Action'),
    ];
    namesResult.forEach((r) => r._unsafeUnwrap());
    namesResult.forEach((r) => r._unsafeUnwrap());

    const [
      titleName,
      descriptionName,
      amountName,
      ratingName,
      statusName,
      tagsName,
      doneName,
      filesName,
      dueDateName,
      ownerName,
      actionName,
    ] = namesResult.map((r) => r._unsafeUnwrap());

    const todoOptionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
    const doneOptionResult = SelectOption.create({ name: 'Done', color: 'red' });
    [todoOptionResult, doneOptionResult].forEach((r) => r._unsafeUnwrap());
    todoOptionResult._unsafeUnwrap();
    doneOptionResult._unsafeUnwrap();

    const todoOption = todoOptionResult._unsafeUnwrap();
    const doneOption = doneOptionResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(titleName).done();
    builder.field().longText().withName(descriptionName).done();
    builder.field().number().withName(amountName).done();
    builder.field().rating().withName(ratingName).withMax(RatingMax.five()).done();
    builder
      .field()
      .singleSelect()
      .withName(statusName)
      .withOptions([todoOption, doneOption])
      .done();
    builder
      .field()
      .multipleSelect()
      .withName(tagsName)
      .withOptions([todoOption, doneOption])
      .done();
    builder.field().checkbox().withName(doneName).done();
    builder.field().attachment().withName(filesName).done();
    builder.field().date().withName(dueDateName).done();
    builder.field().user().withName(ownerName).done();
    builder.field().button().withName(actionName).done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();
    expect(table.getFields().map((f) => f.type().toString())).toEqual([
      'singleLineText',
      'longText',
      'number',
      'rating',
      'singleSelect',
      'multipleSelect',
      'checkbox',
      'attachment',
      'date',
      'user',
      'button',
    ]);
  });

  it('supports multiple view types', () => {
    const baseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
    const tableNameResult = TableName.create('My Table');
    const titleNameResult = FieldName.create('Title');
    [baseIdResult, tableNameResult, titleNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    titleNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(titleNameResult._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    builder.view().kanban().defaultName().done();
    builder.view().calendar().defaultName().done();
    builder.view().gallery().defaultName().done();
    builder.view().form().defaultName().done();
    builder.view().plugin().defaultName().done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    expect(
      buildResult
        ._unsafeUnwrap()
        .views()
        .map((v) => v.type().toString())
    ).toEqual(['grid', 'kanban', 'calendar', 'gallery', 'form', 'plugin']);
  });

  it('builds link fields for all relationships with self references', () => {
    const baseIdResult = createBaseId('g');
    const tableIdResult = createTableId('h');
    const tableNameResult = TableName.create('Link Self');
    const primaryNameResult = FieldName.create('Title');
    const linkNamesResult = [
      FieldName.create('OneOne'),
      FieldName.create('ManyMany'),
      FieldName.create('OneMany'),
      FieldName.create('ManyOne'),
    ];
    const primaryFieldIdResult = createFieldId('i');
    const linkFieldIdsResult = [
      createFieldId('j'),
      createFieldId('k'),
      createFieldId('l'),
      createFieldId('m'),
    ];

    [
      baseIdResult,
      tableIdResult,
      tableNameResult,
      primaryNameResult,
      primaryFieldIdResult,
      ...linkNamesResult,
      ...linkFieldIdsResult,
    ].forEach((r) => r._unsafeUnwrap());

    const baseId = baseIdResult._unsafeUnwrap();
    const tableId = tableIdResult._unsafeUnwrap();
    const primaryFieldId = primaryFieldIdResult._unsafeUnwrap();
    const [oneOneName, manyManyName, oneManyName, manyOneName] = linkNamesResult.map((r) =>
      r._unsafeUnwrap()
    );
    const [oneOneId, manyManyId, oneManyId, manyOneId] = linkFieldIdsResult.map((r) =>
      r._unsafeUnwrap()
    );

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(tableNameResult._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(primaryNameResult._unsafeUnwrap())
      .primary()
      .done();

    const buildConfig = (relationship: string) =>
      LinkFieldConfig.create({
        relationship,
        foreignTableId: tableId.toString(),
        lookupFieldId: primaryFieldId.toString(),
      });

    const oneOneConfig = buildConfig('oneOne');
    const manyManyConfig = buildConfig('manyMany');
    const oneManyConfig = buildConfig('oneMany');
    const manyOneConfig = buildConfig('manyOne');

    builder
      .field()
      .link()
      .withId(oneOneId)
      .withName(oneOneName)
      .withConfig(oneOneConfig._unsafeUnwrap())
      .done();
    builder
      .field()
      .link()
      .withId(manyManyId)
      .withName(manyManyName)
      .withConfig(manyManyConfig._unsafeUnwrap())
      .done();
    builder
      .field()
      .link()
      .withId(oneManyId)
      .withName(oneManyName)
      .withConfig(oneManyConfig._unsafeUnwrap())
      .done();
    builder
      .field()
      .link()
      .withId(manyOneId)
      .withName(manyOneName)
      .withConfig(manyOneConfig._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();
    const linkFields = table.getFields(
      buildFieldSpec((builder) => builder.isLink())
    ) as LinkField[];
    expect(linkFields).toHaveLength(4);

    const fkHost = `${baseId.toString()}.${tableId.toString()}`;
    const linkById = new Map(linkFields.map((field) => [field.id().toString(), field]));
    const oneOne = linkById.get(oneOneId.toString());
    const manyMany = linkById.get(manyManyId.toString());
    const oneMany = linkById.get(oneManyId.toString());
    const manyOne = linkById.get(manyOneId.toString());
    expect(!!(oneOne && manyMany && oneMany && manyOne)).toBe(true);
    if (!oneOne || !manyMany || !oneMany || !manyOne) return;

    expect(oneOne.relationship().toString()).toBe('oneOne');
    expect(oneMany.relationship().toString()).toBe('oneMany');
    expect(manyOne.relationship().toString()).toBe('manyOne');
    expect(manyMany.relationship().toString()).toBe('manyMany');

    const fkOneOne = oneOne.fkHostTableNameString();
    const fkOneMany = oneMany.fkHostTableNameString();
    const fkManyOne = manyOne.fkHostTableNameString();
    expect(fkOneOne._unsafeUnwrap()).toBe(fkHost);
    expect(fkOneMany._unsafeUnwrap()).toBe(fkHost);
    expect(fkManyOne._unsafeUnwrap()).toBe(fkHost);

    const fkManyMany = manyMany.fkHostTableNameString();

    expect(
      fkManyMany
        ._unsafeUnwrap()
        .startsWith(`${baseId.toString()}.junction_${manyManyId.toString()}`)
    ).toBe(true);
    expect(manyMany.symmetricFieldId()).toBeDefined();
  });

  it('initializes column meta for all view types', () => {
    const baseIdResult = BaseId.create(`bse${'e'.repeat(16)}`);
    const tableNameResult = TableName.create('Column Meta');
    const titleNameResult = FieldName.create('Title');
    const amountNameResult = FieldName.create('Amount');
    const scoreNameResult = FieldName.create('Score');
    const actionNameResult = FieldName.create('Action');
    [
      baseIdResult,
      tableNameResult,
      titleNameResult,
      amountNameResult,
      scoreNameResult,
      actionNameResult,
    ].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    titleNameResult._unsafeUnwrap();
    amountNameResult._unsafeUnwrap();
    scoreNameResult._unsafeUnwrap();
    actionNameResult._unsafeUnwrap();

    const primaryIdResult = FieldId.generate();
    primaryIdResult._unsafeUnwrap();

    const primaryId = primaryIdResult._unsafeUnwrap();

    const expressionResult = FormulaExpression.create(`{${primaryId.toString()}} + 1`);
    expressionResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(titleNameResult._unsafeUnwrap()).done();
    builder
      .field()
      .number()
      .withId(primaryId)
      .withName(amountNameResult._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .formula()
      .withName(scoreNameResult._unsafeUnwrap())
      .withExpression(expressionResult._unsafeUnwrap())
      .done();
    builder.field().button().withName(actionNameResult._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    builder.view().kanban().defaultName().done();
    builder.view().gallery().defaultName().done();
    builder.view().calendar().defaultName().done();
    builder.view().form().defaultName().done();
    builder.view().plugin().defaultName().done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();
    const fieldIds = table.getFields().map((field) => field.id().toString());
    const primaryFieldId = table.primaryFieldId().toString();
    const expectedOrder = [
      primaryFieldId,
      ...fieldIds.filter((fieldId) => fieldId !== primaryFieldId),
    ];

    const fieldIdsByName = new Map(
      table.getFields().map((field) => [field.name().toString(), field.id().toString()] as const)
    );
    const viewsByType = new Map(
      table.views().map((view) => [view.type().toString(), view] as const)
    );

    expect(viewsByType.size).toBe(6);

    for (const [type, view] of viewsByType.entries()) {
      const metaResult = view.columnMeta();
      metaResult._unsafeUnwrap();

      const meta = metaResult._unsafeUnwrap().toDto();
      expect(Object.keys(meta).sort()).toEqual([...fieldIds].sort());
      expectedOrder.forEach((fieldId, index) => {
        expect(meta[fieldId]?.order).toBe(index);
      });

      if (type === 'grid' || type === 'plugin') {
        expect(meta[primaryFieldId]?.visible).toBeUndefined();
      }
    }

    const formMetaResult = viewsByType.get('form')?.columnMeta();
    const formMeta = formMetaResult?._unsafeUnwrap();
    if (formMeta) {
      const meta = formMeta.toDto();
      expect(meta[fieldIdsByName.get('Title')!]?.visible).toBe(true);
      expect(meta[fieldIdsByName.get('Amount')!]?.visible).toBe(true);
      expect(meta[fieldIdsByName.get('Score')!]?.visible).toBeUndefined();
      expect(meta[fieldIdsByName.get('Action')!]?.visible).toBeUndefined();
    }

    const primaryVisibleTypes = ['kanban', 'gallery', 'calendar'] as const;
    primaryVisibleTypes.forEach((type) => {
      const metaResult = viewsByType.get(type)?.columnMeta();
      const meta = metaResult?._unsafeUnwrap();
      if (meta) {
        expect(meta.toDto()[primaryFieldId]?.visible).toBe(true);
      }
    });
  });

  it('allows setting a non-first field as primary', () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    const tableNameResult = TableName.create('My Table');
    const titleNameResult = FieldName.create('Title');
    const amountNameResult = FieldName.create('Amount');
    [baseIdResult, tableNameResult, titleNameResult, amountNameResult].forEach((r) =>
      r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    titleNameResult._unsafeUnwrap();
    amountNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(titleNameResult._unsafeUnwrap()).done();
    builder.field().number().withName(amountNameResult._unsafeUnwrap()).primary().done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();
    expect(table.primaryFieldId().equals(table.getFields()[1].id())).toBe(true);
  });

  it('builds even when rollup and formula inputs reference fields declared later', () => {
    const baseIdResult = createBaseId('o');
    const tableNameResult = TableName.create('Out Of Order');
    const titleNameResult = FieldName.create('Title');
    const amountNameResult = FieldName.create('Amount');
    const scoreNameResult = FieldName.create('Score');
    const linkNameResult = FieldName.create('Company');
    const rollupNameResult = FieldName.create('Rollup Total');
    const amountFieldIdResult = createFieldId('p');
    const linkFieldIdResult = createFieldId('q');
    const lookupFieldIdResult = createFieldId('r');
    const foreignTableIdResult = createTableId('s');

    [
      baseIdResult,
      tableNameResult,
      titleNameResult,
      amountNameResult,
      scoreNameResult,
      linkNameResult,
      rollupNameResult,
      amountFieldIdResult,
      linkFieldIdResult,
      lookupFieldIdResult,
      foreignTableIdResult,
    ].forEach((r) => r._unsafeUnwrap());

    const amountFieldId = amountFieldIdResult._unsafeUnwrap();
    const linkFieldId = linkFieldIdResult._unsafeUnwrap();
    const lookupFieldId = lookupFieldIdResult._unsafeUnwrap();
    const foreignTableId = foreignTableIdResult._unsafeUnwrap();

    const formulaExpressionResult = FormulaExpression.create(`{${amountFieldId.toString()}} + 1`);
    const linkConfigResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
    });
    const rollupConfigResult = RollupFieldConfig.create({
      linkFieldId: linkFieldId.toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
    });
    const rollupExpressionResult = RollupExpression.create('counta({values})');

    [formulaExpressionResult, linkConfigResult, rollupConfigResult, rollupExpressionResult].forEach(
      (r) => r._unsafeUnwrap()
    );

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());

    builder.field().singleLineText().withName(titleNameResult._unsafeUnwrap()).primary().done();
    builder
      .field()
      .rollup()
      .withName(rollupNameResult._unsafeUnwrap())
      .withConfig(rollupConfigResult._unsafeUnwrap())
      .withExpression(rollupExpressionResult._unsafeUnwrap())
      .done();
    builder
      .field()
      .formula()
      .withName(scoreNameResult._unsafeUnwrap())
      .withExpression(formulaExpressionResult._unsafeUnwrap())
      .done();
    builder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(linkNameResult._unsafeUnwrap())
      .withConfig(linkConfigResult._unsafeUnwrap())
      .done();
    builder
      .field()
      .number()
      .withId(amountFieldId)
      .withName(amountNameResult._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    const table = buildResult._unsafeUnwrap();
    const formulaField = table.getFields(buildFieldSpec((builder) => builder.isFormula()))[0] as
      | FormulaField
      | undefined;
    const rollupField = table.getFields(buildFieldSpec((builder) => builder.isRollup()))[0] as
      | RollupField
      | undefined;
    expect(formulaField).toBeDefined();
    expect(rollupField).toBeDefined();
    if (!formulaField || !rollupField) return;
    expect(formulaField.dependencies().some((id) => id.equals(amountFieldId))).toBe(true);
    expect(rollupField.configDto()).toEqual({
      linkFieldId: linkFieldId.toString(),
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
    });
  });

  it('rejects multiple primary fields', () => {
    const baseIdResult = BaseId.create(`bse${'d'.repeat(16)}`);
    const tableNameResult = TableName.create('My Table');
    const titleNameResult = FieldName.create('Title');
    const amountNameResult = FieldName.create('Amount');
    [baseIdResult, tableNameResult, titleNameResult, amountNameResult].forEach((r) =>
      r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    titleNameResult._unsafeUnwrap();
    amountNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(titleNameResult._unsafeUnwrap()).primary().done();
    builder.field().number().withName(amountNameResult._unsafeUnwrap()).primary().done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrapErr();

    expect(buildResult._unsafeUnwrapErr().message).toContain('primary');
  });

  it('requires at least one field', () => {
    const baseIdResult = BaseId.create(`bse${'e'.repeat(16)}`);
    const tableNameResult = TableName.create('My Table');
    [baseIdResult, tableNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();

    const buildResult = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap())
      .view()
      .defaultGrid()
      .done()
      .build();
    buildResult._unsafeUnwrapErr();

    expect(buildResult._unsafeUnwrapErr().message).toContain('at least one Field');
  });

  it('requires a base id', () => {
    const tableNameResult = TableName.create('My Table');
    tableNameResult._unsafeUnwrap();

    const buildResult = Table.builder()
      .withName(tableNameResult._unsafeUnwrap())
      .view()
      .defaultGrid()
      .done()
      .build();

    buildResult._unsafeUnwrapErr();

    expect(buildResult._unsafeUnwrapErr().message).toContain('BaseId is required');
  });

  it('requires a table name', () => {
    const baseIdResult = createBaseId('f');
    const fieldNameResult = FieldName.create('Title');
    [baseIdResult, fieldNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();

    const buildResult = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .field()
      .singleLineText()
      .withName(fieldNameResult._unsafeUnwrap())
      .done()
      .view()
      .defaultGrid()
      .done()
      .build();

    buildResult._unsafeUnwrapErr();

    expect(buildResult._unsafeUnwrapErr().message).toContain('TableName is required');
  });

  it('requires at least one view', () => {
    const baseIdResult = createBaseId('g');
    const tableNameResult = TableName.create('No Views');
    const fieldNameResult = FieldName.create('Title');
    [baseIdResult, tableNameResult, fieldNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();

    const buildResult = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap())
      .field()
      .singleLineText()
      .withName(fieldNameResult._unsafeUnwrap())
      .done()
      .build();

    buildResult._unsafeUnwrapErr();

    expect(buildResult._unsafeUnwrapErr().message).toContain('at least one View');
  });

  it('rejects duplicate field names', () => {
    const baseIdResult = createBaseId('h');
    const tableNameResult = TableName.create('Duplicate Fields');
    const fieldNameResult = FieldName.create('Title');
    [baseIdResult, tableNameResult, fieldNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.field().number().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrapErr();

    expect(buildResult._unsafeUnwrapErr().message).toContain('Field names must be unique');
  });

  it('rejects duplicate view names', () => {
    const baseIdResult = createBaseId('i');
    const tableNameResult = TableName.create('Duplicate Views');
    const fieldNameResult = FieldName.create('Title');
    const viewNameResult = ViewName.create('Grid');
    [baseIdResult, tableNameResult, fieldNameResult, viewNameResult].forEach((r) =>
      r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();
    viewNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().grid().withName(viewNameResult._unsafeUnwrap()).done();
    builder.view().kanban().withName(viewNameResult._unsafeUnwrap()).done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrapErr();

    expect(buildResult._unsafeUnwrapErr().message).toContain('View names must be unique');
  });

  it('captures missing field and view names', () => {
    const baseIdResult = createBaseId('j');
    const tableNameResult = TableName.create('Missing Names');
    const fieldNameResult = FieldName.create('Title');
    [baseIdResult, tableNameResult, fieldNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().number().done();
    builder.view().grid().done();
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    const buildError = buildResult._unsafeUnwrapErr();

    expect(buildError.message).toBe('Table builder errors');
    const errors = buildError.details?.errors as string[] | undefined;
    expect(errors).toBeDefined();
    expect(errors).toContain('FieldName is required');
    expect(errors).toContain('ViewName is required');
  });

  it('uses provided table id and validates primary field existence', () => {
    const baseIdResult = createBaseId('k');
    const tableIdResult = createTableId('k');
    const tableNameResult = TableName.create('Explicit Id');
    const fieldNameResult = FieldName.create('Title');
    const missingPrimaryIdResult = createFieldId('x');
    [baseIdResult, tableIdResult, tableNameResult, fieldNameResult, missingPrimaryIdResult].forEach(
      (r) => r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();
    missingPrimaryIdResult._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableIdResult._unsafeUnwrap())
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.markPrimaryFieldId(missingPrimaryIdResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrapErr();

    expect(buildResult._unsafeUnwrapErr().message).toContain('Primary Field must exist');
  });

  it('honors explicit table id on successful build', () => {
    const baseIdResult = createBaseId('l');
    const tableIdResult = createTableId('l');
    const tableNameResult = TableName.create('Explicit Table');
    const fieldNameResult = FieldName.create('Title');
    [baseIdResult, tableIdResult, tableNameResult, fieldNameResult].forEach((r) =>
      r._unsafeUnwrap()
    );
    baseIdResult._unsafeUnwrap();
    tableIdResult._unsafeUnwrap();
    tableNameResult._unsafeUnwrap();
    fieldNameResult._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableIdResult._unsafeUnwrap())
      .withBaseId(baseIdResult._unsafeUnwrap())
      .withName(tableNameResult._unsafeUnwrap());
    builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();

    const buildResult = builder.build();
    buildResult._unsafeUnwrap();

    expect(buildResult._unsafeUnwrap().id().equals(tableIdResult._unsafeUnwrap())).toBe(true);
  });

  describe('link fields', () => {
    it('builds a table with link configs', () => {
      const baseIdResult = createBaseId('h');
      const tableNameResult = TableName.create('Linked');
      const titleNameResult = FieldName.create('Name');
      const linkNameResult = FieldName.create('Company');
      const foreignTableIdResult = createTableId('i');
      const lookupFieldIdResult = createFieldId('j');

      [
        baseIdResult,
        tableNameResult,
        titleNameResult,
        linkNameResult,
        foreignTableIdResult,
        lookupFieldIdResult,
      ].forEach((r) => r._unsafeUnwrap());
      baseIdResult._unsafeUnwrap();
      tableNameResult._unsafeUnwrap();
      titleNameResult._unsafeUnwrap();
      linkNameResult._unsafeUnwrap();
      foreignTableIdResult._unsafeUnwrap();
      lookupFieldIdResult._unsafeUnwrap();

      const linkConfigResult = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableIdResult._unsafeUnwrap().toString(),
        lookupFieldId: lookupFieldIdResult._unsafeUnwrap().toString(),
        fkHostTableName: 'link_relations',
        selfKeyName: '__self_id',
        foreignKeyName: '__foreign_id',
      });
      linkConfigResult._unsafeUnwrap();

      const builder = Table.builder()
        .withBaseId(baseIdResult._unsafeUnwrap())
        .withName(tableNameResult._unsafeUnwrap());
      builder.field().singleLineText().withName(titleNameResult._unsafeUnwrap()).primary().done();
      builder
        .field()
        .link()
        .withName(linkNameResult._unsafeUnwrap())
        .withConfig(linkConfigResult._unsafeUnwrap())
        .done();
      builder.view().defaultGrid().done();

      const buildResult = builder.build();
      buildResult._unsafeUnwrap();

      const linkField = buildResult
        ._unsafeUnwrap()
        .getFields(buildFieldSpec((builder) => builder.isLink()))[0] as LinkField | undefined;
      expect(linkField).toBeDefined();
      if (!linkField) return;
      expect(linkField.foreignTableId().equals(foreignTableIdResult._unsafeUnwrap())).toBe(true);
      expect(linkField.lookupFieldId().equals(lookupFieldIdResult._unsafeUnwrap())).toBe(true);
      expect(linkField.relationship().toString()).toBe('manyOne');
      expect(linkField.hasOrderColumn()).toBe(true);
    });
  });
});
