import {
  BaseId,
  FieldId,
  FieldName,
  FormulaExpression,
  LinkFieldConfig,
  RatingMax,
  SelectOption,
  Table,
  TableId,
  TableName,
  resolveFormulaFields,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { FieldStorageTypeVisitor } from './FieldStorageTypeVisitor';

describe('FieldStorageTypeVisitor', () => {
  it('maps field types to v1 storage type strings', () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const tableName = TableName.create('Projects')._unsafeUnwrap();
    const titleName = FieldName.create('Name')._unsafeUnwrap();
    const descriptionName = FieldName.create('Description')._unsafeUnwrap();
    const amountName = FieldName.create('Amount')._unsafeUnwrap();
    const ratingName = FieldName.create('Rating')._unsafeUnwrap();
    const scoreName = FieldName.create('Score')._unsafeUnwrap();
    const statusName = FieldName.create('Status')._unsafeUnwrap();
    const tagsName = FieldName.create('Tags')._unsafeUnwrap();
    const doneName = FieldName.create('Done')._unsafeUnwrap();
    const filesName = FieldName.create('Files')._unsafeUnwrap();
    const dueDateName = FieldName.create('Due Date')._unsafeUnwrap();
    const ownerName = FieldName.create('Owner')._unsafeUnwrap();
    const actionName = FieldName.create('Action')._unsafeUnwrap();
    const linkName = FieldName.create('Related')._unsafeUnwrap();
    const todoOption = SelectOption.create({ name: 'Todo', color: 'blue' })._unsafeUnwrap();
    const doneOption = SelectOption.create({ name: 'Done', color: 'red' })._unsafeUnwrap();
    const amountId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const formulaExpression = FormulaExpression.create(
      `{${amountId.toString()}} * 2`
    )._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      fkHostTableName: 'link_relations',
      selfKeyName: '__self_id',
      foreignKeyName: '__foreign_id',
    })._unsafeUnwrap();

    const builder = Table.builder().withBaseId(baseId).withName(tableName);
    builder.field().singleLineText().withName(titleName).done();
    builder.field().longText().withName(descriptionName).done();
    builder.field().number().withName(amountName).withId(amountId).done();
    builder.field().formula().withName(scoreName).withExpression(formulaExpression).done();
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
    builder.field().link().withName(linkName).withConfig(linkConfig).done();
    builder.view().defaultGrid().done();

    const table = builder.build()._unsafeUnwrap();
    const resolveResult = resolveFormulaFields(table);
    resolveResult._unsafeUnwrap();

    const visitor = new FieldStorageTypeVisitor();
    const applyResult = visitor.apply(table);
    applyResult._unsafeUnwrap();

    const typesById = visitor.typesById();
    const storageTypes = table.getFields().map((field) => typesById.get(field.id().toString()));

    expect(storageTypes).toEqual([
      { cellValueType: 'string', dbFieldType: 'TEXT', isMultipleCellValue: false },
      { cellValueType: 'string', dbFieldType: 'TEXT', isMultipleCellValue: false },
      { cellValueType: 'number', dbFieldType: 'REAL', isMultipleCellValue: false },
      { cellValueType: 'number', dbFieldType: 'REAL', isMultipleCellValue: false },
      { cellValueType: 'number', dbFieldType: 'REAL', isMultipleCellValue: false },
      { cellValueType: 'string', dbFieldType: 'TEXT', isMultipleCellValue: false },
      { cellValueType: 'string', dbFieldType: 'JSON', isMultipleCellValue: true },
      { cellValueType: 'boolean', dbFieldType: 'BOOLEAN', isMultipleCellValue: false },
      { cellValueType: 'string', dbFieldType: 'JSON', isMultipleCellValue: true },
      { cellValueType: 'dateTime', dbFieldType: 'DATETIME', isMultipleCellValue: false },
      { cellValueType: 'string', dbFieldType: 'JSON', isMultipleCellValue: false },
      { cellValueType: 'string', dbFieldType: 'JSON', isMultipleCellValue: false },
      { cellValueType: 'string', dbFieldType: 'JSON', isMultipleCellValue: false },
    ]);
  });
});
