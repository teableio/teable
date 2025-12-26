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
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { FieldStorageTypeVisitor } from './FieldStorageTypeVisitor';

const unwrap = <T>(result: Result<T, string>): T => {
  if (result.isErr()) {
    throw new Error(result.error);
  }
  return result.value;
};

describe('FieldStorageTypeVisitor', () => {
  it('maps field types to v1 storage type strings', () => {
    const baseId = unwrap(BaseId.create(`bse${'a'.repeat(16)}`));
    const tableName = unwrap(TableName.create('Projects'));
    const titleName = unwrap(FieldName.create('Name'));
    const descriptionName = unwrap(FieldName.create('Description'));
    const amountName = unwrap(FieldName.create('Amount'));
    const ratingName = unwrap(FieldName.create('Rating'));
    const scoreName = unwrap(FieldName.create('Score'));
    const statusName = unwrap(FieldName.create('Status'));
    const tagsName = unwrap(FieldName.create('Tags'));
    const doneName = unwrap(FieldName.create('Done'));
    const filesName = unwrap(FieldName.create('Files'));
    const dueDateName = unwrap(FieldName.create('Due Date'));
    const ownerName = unwrap(FieldName.create('Owner'));
    const actionName = unwrap(FieldName.create('Action'));
    const linkName = unwrap(FieldName.create('Related'));
    const todoOption = unwrap(SelectOption.create({ name: 'Todo', color: 'blue' }));
    const doneOption = unwrap(SelectOption.create({ name: 'Done', color: 'red' }));
    const amountId = unwrap(FieldId.create(`fld${'a'.repeat(16)}`));
    const formulaExpression = unwrap(FormulaExpression.create(`{${amountId.toString()}} * 2`));
    const foreignTableId = unwrap(TableId.create(`tbl${'b'.repeat(16)}`));
    const lookupFieldId = unwrap(FieldId.create(`fld${'b'.repeat(16)}`));
    const linkConfig = unwrap(
      LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        fkHostTableName: 'link_relations',
        selfKeyName: '__self_id',
        foreignKeyName: '__foreign_id',
      })
    );

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

    const table = unwrap(builder.build());
    const resolveResult = resolveFormulaFields(table);
    expect(resolveResult.isOk()).toBe(true);
    if (resolveResult.isErr()) return;
    const visitor = new FieldStorageTypeVisitor();
    const applyResult = visitor.apply(table);
    expect(applyResult.isOk()).toBe(true);
    if (applyResult.isErr()) return;

    const typesById = visitor.typesById();
    const storageTypes = table.fields().map((field) => typesById.get(field.id().toString()));

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
