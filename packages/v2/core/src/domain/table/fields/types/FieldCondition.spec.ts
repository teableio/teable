import { describe, expect, it } from 'vitest';

import { FieldCondition } from './FieldCondition';

const FLD_MATCH = `fld${'m'.repeat(16)}`;
const FLD_MATCH_2 = `fld${'n'.repeat(16)}`;
const FLD_HOST = `fld${'h'.repeat(16)}`;

describe('FieldCondition.fieldReferenceMatchFieldIds', () => {
  it('returns the filter field of is comparisons against a field reference', () => {
    const condition = FieldCondition.create({
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: FLD_MATCH,
            operator: 'is',
            value: { type: 'field', fieldId: FLD_HOST, tableId: `tbl${'t'.repeat(16)}` },
          },
          { fieldId: FLD_MATCH_2, operator: 'isNotEmpty', value: null },
        ],
      },
    })._unsafeUnwrap();

    expect(condition.fieldReferenceMatchFieldIds().map((id) => id.toString())).toEqual([FLD_MATCH]);
  });

  it('supports the isSymbol field-reference form and nested filter sets', () => {
    const condition = FieldCondition.create({
      filter: {
        conjunction: 'or',
        filterSet: [
          {
            conjunction: 'and',
            filterSet: [{ fieldId: FLD_MATCH, operator: 'is', value: FLD_HOST, isSymbol: true }],
          },
        ],
      },
    })._unsafeUnwrap();

    expect(condition.fieldReferenceMatchFieldIds().map((id) => id.toString())).toEqual([FLD_MATCH]);
  });

  it('ignores literal comparisons and non-equality operators', () => {
    const condition = FieldCondition.create({
      filter: {
        conjunction: 'and',
        filterSet: [
          { fieldId: FLD_MATCH, operator: 'is', value: 'active' },
          {
            fieldId: FLD_MATCH_2,
            operator: 'isNot',
            value: { type: 'field', fieldId: FLD_HOST },
          },
        ],
      },
    })._unsafeUnwrap();

    expect(condition.fieldReferenceMatchFieldIds()).toEqual([]);
  });

  it('dedupes repeated match fields and returns nothing without a filter', () => {
    const condition = FieldCondition.create({
      filter: {
        conjunction: 'or',
        filterSet: [
          { fieldId: FLD_MATCH, operator: 'is', value: { type: 'field', fieldId: FLD_HOST } },
          { fieldId: FLD_MATCH, operator: 'is', value: { type: 'field', fieldId: FLD_MATCH_2 } },
        ],
      },
    })._unsafeUnwrap();

    expect(condition.fieldReferenceMatchFieldIds()).toHaveLength(1);
    expect(FieldCondition.empty().fieldReferenceMatchFieldIds()).toEqual([]);
  });
});
