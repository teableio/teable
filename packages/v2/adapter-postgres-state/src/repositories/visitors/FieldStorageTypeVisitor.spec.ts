import { BaseId, FieldName, RatingMax, SelectOption, Table, TableName } from '@teable/v2-core';
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
    const statusName = unwrap(FieldName.create('Status'));
    const tagsName = unwrap(FieldName.create('Tags'));
    const doneName = unwrap(FieldName.create('Done'));
    const filesName = unwrap(FieldName.create('Files'));
    const dueDateName = unwrap(FieldName.create('Due Date'));
    const ownerName = unwrap(FieldName.create('Owner'));
    const actionName = unwrap(FieldName.create('Action'));
    const todoOption = unwrap(SelectOption.create({ name: 'Todo', color: 'blue' }));
    const doneOption = unwrap(SelectOption.create({ name: 'Done', color: 'red' }));

    const builder = Table.builder().withBaseId(baseId).withName(tableName);
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

    const table = unwrap(builder.build());
    const visitor = new FieldStorageTypeVisitor();
    const applyResult = visitor.apply(table);
    expect(applyResult.isOk()).toBe(true);
    if (applyResult.isErr()) return;

    const typesById = visitor.typesById();
    const storageTypes = table.fields().map((field) => typesById.get(field.id().toString()));

    expect(storageTypes).toEqual([
      { cellValueType: 'string', dbFieldType: 'TEXT' },
      { cellValueType: 'string', dbFieldType: 'TEXT' },
      { cellValueType: 'number', dbFieldType: 'REAL' },
      { cellValueType: 'number', dbFieldType: 'REAL' },
      { cellValueType: 'string', dbFieldType: 'TEXT' },
      { cellValueType: 'string', dbFieldType: 'JSON' },
      { cellValueType: 'boolean', dbFieldType: 'INTEGER' },
      { cellValueType: 'string', dbFieldType: 'JSON' },
      { cellValueType: 'dateTime', dbFieldType: 'DATETIME' },
      { cellValueType: 'string', dbFieldType: 'JSON' },
      { cellValueType: 'string', dbFieldType: 'JSON' },
    ]);
  });
});
