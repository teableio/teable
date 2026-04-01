import { describe, expect, it } from 'vitest';

import {
  baseRecordColumnNames,
  convertNameToValidCharacter,
  ensureUniqueDbFieldName,
  joinDbTableName,
} from './naming';

describe('naming helpers', () => {
  it('returns unnamed when the converted name is empty or underscores only', () => {
    expect(convertNameToValidCharacter('')).toBe('unnamed');
    expect(convertNameToValidCharacter('___')).toBe('unnamed');
  });

  it('prefixes names that do not start with a letter and truncates long names', () => {
    expect(convertNameToValidCharacter('123 project')).toBe('t123_project');
    expect(convertNameToValidCharacter('A'.repeat(50), 8)).toBe('AAAAAAAA');
  });

  it('joins schema and table names with a dot', () => {
    expect(joinDbTableName('public', 'tasks')).toBe('public.tasks');
  });

  it('finds the next available field name suffix', () => {
    expect(ensureUniqueDbFieldName('title', new Set())).toBe('title');
    expect(ensureUniqueDbFieldName('title', new Set(['title']))).toBe('title_2');
    expect(ensureUniqueDbFieldName('title', new Set(['title', 'title_2', 'title_3']))).toBe(
      'title_4'
    );
  });

  it('exports the built-in base record columns', () => {
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
});
