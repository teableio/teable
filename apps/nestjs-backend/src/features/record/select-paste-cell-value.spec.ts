import { describe, expect, it } from 'vitest';

import { selectPasteCellValue } from './select-paste-cell-value';

describe('selectPasteCellValue', () => {
  it('keeps a string multi-select clipboard value for CSV parsing', () => {
    expect(selectPasteCellValue('Tag A, Tag B', true)).toBe('Tag A, Tag B');
  });

  it('preserves an already parsed multi-select array, including comma names', () => {
    expect(selectPasteCellValue(['Tag A, Tag B', 'Tag C'], true)).toEqual([
      'Tag A, Tag B',
      'Tag C',
    ]);
  });

  it('takes the first structured value when the target is single select', () => {
    expect(selectPasteCellValue(['Alpha', 'Beta'], false)).toBe('Alpha');
    expect(selectPasteCellValue('Alpha', false)).toBe('Alpha');
  });
});
