import { FieldId } from '@teable/v2-core';
import { describe, expect, test } from 'vitest';

import { isNeverNullSystemOrderColumn, uniqueOrderByEntries } from './systemOrderColumns';

describe('systemOrderColumns', () => {
  test('treats identity columns as never-null', () => {
    expect(isNeverNullSystemOrderColumn('__id')).toBe(true);
    expect(isNeverNullSystemOrderColumn('__auto_number')).toBe(true);
    expect(isNeverNullSystemOrderColumn('__version')).toBe(true);
    expect(isNeverNullSystemOrderColumn('__created_time')).toBe(false);
    expect(isNeverNullSystemOrderColumn('__row_viwxxxxxxxxxxxxxxxx')).toBe(false);
  });

  test('keeps the first occurrence of duplicate order keys', () => {
    const fieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();

    expect(
      uniqueOrderByEntries([
        { column: '__auto_number', direction: 'asc' },
        { column: fieldId, direction: 'desc' },
        { column: '__auto_number', direction: 'desc' },
        { column: fieldId, direction: 'asc' },
      ])
    ).toEqual([
      { column: '__auto_number', direction: 'asc' },
      { column: fieldId, direction: 'desc' },
    ]);
  });
});
