import { getInsertFieldOrder } from './insertFieldOrder';

const fields = [{ id: 'fldA' }, { id: 'fldB' }, { id: 'fldC' }];
const columnMeta = {
  fldA: { order: 0 },
  fldB: { order: 1 },
  fldC: { order: 2 },
};

describe('getInsertFieldOrder', () => {
  it('splits the gap to the next field when inserting after', () => {
    expect(getInsertFieldOrder(fields, columnMeta, 'fldA', true)).toBe(0.5);
  });

  it('splits the gap to the previous field when inserting before', () => {
    expect(getInsertFieldOrder(fields, columnMeta, 'fldC', false)).toBe(1.5);
  });

  it('steps past the edges when there is no neighbour on that side', () => {
    expect(getInsertFieldOrder(fields, columnMeta, 'fldC', true)).toBe(3);
    expect(getInsertFieldOrder(fields, columnMeta, 'fldA', false)).toBe(-1);
  });

  // T6876: field ops and view ops sync independently, so a just-created field
  // sits in the field list with no columnMeta entry yet. It is sorted to the
  // tail by useFields, and reading its order as a neighbour used to throw
  // "undefined is not an object (evaluating 'columnMeta[...].order')".
  it('ignores a neighbour whose columnMeta entry has not arrived yet', () => {
    const withPendingField = [...fields, { id: 'fldNew' }];

    expect(getInsertFieldOrder(withPendingField, columnMeta, 'fldC', true)).toBe(3);
    expect(getInsertFieldOrder(withPendingField, columnMeta, 'fldB', true)).toBe(1.5);
  });

  it('skips the insert when the clicked field has no columnMeta entry yet', () => {
    expect(getInsertFieldOrder([...fields, { id: 'fldNew' }], columnMeta, 'fldNew', true)).toBe(
      undefined
    );
  });

  it('skips the insert when the whole columnMeta is missing', () => {
    expect(getInsertFieldOrder(fields, {}, 'fldA', true)).toBe(undefined);
  });

  it('skips the insert when the field is not in the list', () => {
    expect(getInsertFieldOrder(fields, columnMeta, 'fldGone', true)).toBe(undefined);
  });
});
