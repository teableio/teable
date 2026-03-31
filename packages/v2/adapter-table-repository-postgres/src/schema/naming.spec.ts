import { describe, expect, it } from 'vitest';

import {
  baseRecordColumnNames,
  convertNameToValidCharacter,
  ensureUniqueDbFieldName,
  joinDbTableName,
} from './naming';

describe('schema naming helpers', () => {
  it('keeps reserved base columns stable', () => {
    expect(baseRecordColumnNames).toEqual([
      '__id',
      '__auto_number',
      '__created_time',
      '__last_modified_time',
      '__created_by',
      '__last_modified_by',
      '__version',
    ]);
  });

  it('normalizes invalid names and enforces prefixes and max length', () => {
    expect(convertNameToValidCharacter('')).toBe('unnamed');
    expect(convertNameToValidCharacter('___')).toBe('unnamed');
    expect(convertNameToValidCharacter('123 field name')).toBe('t123_field_name');
    expect(convertNameToValidCharacter('name with spaces', 8)).toBe('name_wit');
  });

  it('joins db table names and increments conflicting field names', () => {
    const reservedNames = new Set(['field', 'field_2', 'field_3']);

    expect(joinDbTableName('public', 'records')).toBe('public.records');
    expect(ensureUniqueDbFieldName('plain', reservedNames)).toBe('plain');
    expect(ensureUniqueDbFieldName('field', reservedNames)).toBe('field_4');
  });
});
