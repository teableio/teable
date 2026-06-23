import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { FieldId } from '../../fields/FieldId';
import { FieldName } from '../../fields/FieldName';
import { RecordId } from '../../records/RecordId';
import { Table } from '../../Table';
import { TableId } from '../../TableId';
import { TableName } from '../../TableName';

const buildTable = (fieldCount: number) => {
  const builder = Table.builder()
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Batch Update Table')._unsafeUnwrap());

  for (let index = 0; index < fieldCount; index++) {
    const fieldId = FieldId.create(
      `fld${String.fromCharCode(97 + index).repeat(16)}`
    )._unsafeUnwrap();
    const fieldBuilder = builder
      .field()
      .singleLineText()
      .withId(fieldId)
      .withName(FieldName.create(`Field ${index}`)._unsafeUnwrap());
    if (index === 0) {
      fieldBuilder.primary();
    }
    fieldBuilder.done();
  }
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

const buildUpdates = (count: number, fieldId: string) =>
  Array.from({ length: count }, (_, index) => ({
    recordId: RecordId.create(`rec${String(index).padStart(16, '0')}`)._unsafeUnwrap(),
    fieldValues: new Map([[fieldId, `value-${index}`]]),
  }));

describe('updateRecordsStream', () => {
  it('keeps the default 500-row stream batch cap', () => {
    const table = buildTable(20);
    const fieldId = table.getFields()[0]!.id().toString();
    const updates = buildUpdates(1000, fieldId);

    const batchSizes = [...table.updateRecordsStream(updates)].map((result) => {
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return result._unsafeUnwrap().length;
    });

    expect(batchSizes).toEqual([500, 500]);
  });

  it('supports a 1k-row cap for narrow explicit bulk updates', () => {
    const table = buildTable(20);
    const fieldId = table.getFields()[0]!.id().toString();
    const updates = buildUpdates(1000, fieldId);

    const batchSizes = [...table.updateRecordsStream(updates, { maxBatchSize: 1000 })].map(
      (result) => {
        if (result.isErr()) {
          throw new Error(result.error.message);
        }
        return result._unsafeUnwrap().length;
      }
    );

    expect(batchSizes).toEqual([1000]);
  });

  it('supports mixing field ids and field names across a stream', () => {
    const table = buildTable(2);
    const [titleField, notesField] = table.getFields();
    const titleFieldId = titleField!.id().toString();
    const notesFieldId = notesField!.id().toString();
    const updates = [
      {
        recordId: RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap(),
        fieldValues: new Map([[titleFieldId, 'title-by-id']]),
      },
      {
        recordId: RecordId.create(`rec${'b'.repeat(16)}`)._unsafeUnwrap(),
        fieldValues: new Map([[notesField!.name().toString(), 'notes-by-name']]),
      },
    ];

    const [batchResult] = [...table.updateRecordsStream(updates)];
    const batch = batchResult!._unsafeUnwrap();

    expect(batch[0]!.record.fields().get(titleField!.id())?.toValue()).toBe('title-by-id');
    expect(batch[0]!.fieldKeyMapping.get(titleFieldId)).toBe(titleFieldId);
    expect(batch[1]!.record.fields().get(notesField!.id())?.toValue()).toBe('notes-by-name');
    expect(batch[1]!.fieldKeyMapping.get(notesFieldId)).toBe(notesField!.name().toString());
  });
});
