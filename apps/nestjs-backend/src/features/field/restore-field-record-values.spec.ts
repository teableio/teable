import { FieldKeyType } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { restoreFieldRecordValues } from './restore-field-record-values';

describe('restoreFieldRecordValues', () => {
  it('restores only non-empty values in chunks', async () => {
    const updater = {
      updateRecords: vi.fn().mockResolvedValue([]),
    };
    const nonEmptyRecords = Array.from({ length: 501 }, (_, index) => ({
      id: `rec${index}`,
      fields: {
        fldText: `value-${index}`,
      },
    }));
    const emptyRecords = Array.from({ length: 130 }, (_, index) => ({
      id: `rec-empty-${index}`,
      fields: {
        fldNull: null,
        fldUndefined: undefined,
        fldEmptyLink: [],
      },
    }));

    await restoreFieldRecordValues('tblxxx', [...nonEmptyRecords, ...emptyRecords], updater);

    expect(updater.updateRecords).toHaveBeenCalledTimes(2);
    expect(updater.updateRecords.mock.calls.map(([, ro]) => ro.records?.length)).toEqual([500, 1]);
    expect(updater.updateRecords.mock.calls[0][1].fieldKeyType).toBe(FieldKeyType.Id);
    expect(
      updater.updateRecords.mock.calls.flatMap(([, ro]) =>
        (ro.records ?? []).flatMap((record) => Object.values(record.fields ?? {}))
      )
    ).toEqual(nonEmptyRecords.map((record) => record.fields.fldText));
  });

  it('keeps falsy cell values that are not empty defaults', async () => {
    const updater = {
      updateRecords: vi.fn().mockResolvedValue([]),
    };

    await restoreFieldRecordValues(
      'tblxxx',
      [
        {
          id: 'recxxx',
          fields: {
            fldZero: 0,
            fldFalse: false,
            fldEmptyText: '',
          },
        },
      ],
      updater
    );

    expect(updater.updateRecords).toHaveBeenCalledWith('tblxxx', {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          id: 'recxxx',
          fields: {
            fldZero: 0,
            fldFalse: false,
            fldEmptyText: '',
          },
        },
      ],
    });
  });
});
