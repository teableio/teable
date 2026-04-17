import { describe, expect, it } from 'vitest';

import { areRecordFieldValuesEqual } from './RecordFieldValueEquality';

describe('areRecordFieldValuesEqual', () => {
  it('treats null and undefined as equivalent empty cell values', () => {
    expect(areRecordFieldValuesEqual(null, undefined)).toBe(true);
  });

  it('compares object values without depending on key insertion order', () => {
    expect(
      areRecordFieldValuesEqual(
        { id: 'usr1', title: 'Alice', email: 'alice@example.com' },
        { email: 'alice@example.com', title: 'Alice', id: 'usr1' }
      )
    ).toBe(true);
  });

  it('compares array values in order', () => {
    expect(
      areRecordFieldValuesEqual([{ id: 'rec1' }, { id: 'rec2' }], [{ id: 'rec2' }, { id: 'rec1' }])
    ).toBe(false);
  });
});
