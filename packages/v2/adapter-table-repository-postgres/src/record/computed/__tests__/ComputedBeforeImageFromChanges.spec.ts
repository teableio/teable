import { FieldId, RecordId, TableId } from '@teable/v2-core';
import type { Table } from '@teable/v2-core';
import { ok, err } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { buildBeforeImageRecordsFromStepChanges } from '../ComputedBeforeImageFromChanges';
import type { StepChangeData } from '../ComputedFieldUpdater';

const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
const fieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
const otherFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
const recordId = RecordId.create(`rec${'d'.repeat(16)}`)._unsafeUnwrap();
const otherRecordId = RecordId.create(`rec${'e'.repeat(16)}`)._unsafeUnwrap();

const createTable = (): Table =>
  ({
    getField: (predicate: (field: { id: () => FieldId }) => boolean) => {
      const fields = [
        {
          id: () => fieldId,
          dbFieldName: () => ok({ value: () => ok('col_title') }),
        },
        {
          id: () => otherFieldId,
          dbFieldName: () => ok({ value: () => ok('col_status') }),
        },
      ];
      const field = fields.find(predicate);
      return field ? ok(field) : err(new Error('missing field'));
    },
  }) as unknown as Table;

describe('buildBeforeImageRecordsFromStepChanges', () => {
  it('converts computed old values into before-image records keyed by DB column', () => {
    const changesByStep: StepChangeData[] = [
      {
        tableId: tableId.toString(),
        recordChanges: [
          {
            recordId: recordId.toString(),
            oldVersion: 1,
            changes: [
              {
                fieldId: fieldId.toString(),
                oldValue: 'old title',
                newValue: 'new title',
              },
              {
                fieldId: otherFieldId.toString(),
                oldValue: 'draft',
                newValue: 'published',
              },
            ],
          },
          {
            recordId: otherRecordId.toString(),
            oldVersion: 1,
            changes: [
              {
                fieldId: fieldId.toString(),
                oldValue: 'unrelated',
                newValue: 'unrelated changed',
              },
            ],
          },
        ],
      },
    ];

    const result = buildBeforeImageRecordsFromStepChanges({
      seedTableId: tableId,
      seedRecordIds: [recordId],
      seedFieldIds: [fieldId],
      changesByStep,
      tableById: new Map([[tableId.toString(), createTable()]]),
    });

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().map((record) => ({
        recordId: record.recordId.toString(),
        fieldValuesByDbName: record.fieldValuesByDbName,
      }))
    ).toEqual([
      {
        recordId: recordId.toString(),
        fieldValuesByDbName: {
          col_title: 'old title',
        },
      },
    ]);
  });
});
