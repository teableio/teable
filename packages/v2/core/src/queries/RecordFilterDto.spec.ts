import { describe, expect, it } from 'vitest';

import {
  isRecordFilterCondition,
  isRecordFilterDateValue,
  isRecordFilterFieldReferenceValue,
  isRecordFilterGroup,
  isRecordFilterNot,
  recordFilterConditionSchema,
  recordFilterNodeSchema,
  recordFilterSchema,
} from './RecordFilterDto';
import type { RecordFilterCondition, RecordFilterGroup, RecordFilterNot } from './RecordFilterDto';

describe('RecordFilterDto', () => {
  it('validates condition operators and values', () => {
    const validEmpty = recordFilterConditionSchema.safeParse({
      fieldId: 'fld123',
      operator: 'isEmpty',
      value: null,
    });
    expect(validEmpty.success).toBe(true);

    const invalidEmpty = recordFilterConditionSchema.safeParse({
      fieldId: 'fld123',
      operator: 'isEmpty',
      value: 'nope',
    });
    expect(invalidEmpty.success).toBe(false);

    const invalidNull = recordFilterConditionSchema.safeParse({
      fieldId: 'fld123',
      operator: 'is',
      value: null,
    });
    expect(invalidNull.success).toBe(false);

    const invalidArray = recordFilterConditionSchema.safeParse({
      fieldId: 'fld123',
      operator: 'is',
      value: ['a'],
    });
    expect(invalidArray.success).toBe(false);

    const validArray = recordFilterConditionSchema.safeParse({
      fieldId: 'fld123',
      operator: 'isAnyOf',
      value: ['a', 'b'],
    });
    expect(validArray.success).toBe(true);

    const validFieldRef = recordFilterConditionSchema.safeParse({
      fieldId: 'fld123',
      operator: 'hasAnyOf',
      value: { type: 'field', fieldId: 'fld456' },
    });
    expect(validFieldRef.success).toBe(true);

    const invalidScalarForArray = recordFilterConditionSchema.safeParse({
      fieldId: 'fld123',
      operator: 'hasAnyOf',
      value: 'a',
    });
    expect(invalidScalarForArray.success).toBe(false);
  });

  it('validates groups, nodes, and nullable filters', () => {
    const condition = {
      fieldId: 'fld123',
      operator: 'contains',
      value: 'hello',
    };
    const validGroup = recordFilterNodeSchema.safeParse({
      conjunction: 'and',
      items: [condition],
    });
    expect(validGroup.success).toBe(true);

    const invalidGroup = recordFilterNodeSchema.safeParse({
      conjunction: 'or',
      items: [],
    });
    expect(invalidGroup.success).toBe(false);

    const nullable = recordFilterSchema.safeParse(null);
    expect(nullable.success).toBe(true);
  });

  it('detects node shapes', () => {
    const condition: RecordFilterCondition = { fieldId: 'fld123', operator: 'is', value: 'a' };
    const group: RecordFilterGroup = { conjunction: 'and', items: [condition] };
    const notNode: RecordFilterNot = { not: condition };

    expect(isRecordFilterCondition(condition)).toBe(true);
    expect(isRecordFilterGroup(condition)).toBe(false);
    expect(isRecordFilterNot(condition)).toBe(false);

    expect(isRecordFilterCondition(group)).toBe(false);
    expect(isRecordFilterGroup(group)).toBe(true);
    expect(isRecordFilterNot(group)).toBe(false);

    expect(isRecordFilterCondition(notNode)).toBe(false);
    expect(isRecordFilterGroup(notNode)).toBe(false);
    expect(isRecordFilterNot(notNode)).toBe(true);
  });

  it('detects field references and date values', () => {
    expect(isRecordFilterFieldReferenceValue({ type: 'field', fieldId: 'fld123' })).toBe(true);
    expect(isRecordFilterFieldReferenceValue({ type: 'x', fieldId: 'fld123' })).toBe(false);
    expect(isRecordFilterFieldReferenceValue({ fieldId: 'fld123' })).toBe(false);

    expect(isRecordFilterDateValue({ mode: 'today' })).toBe(true);
    expect(isRecordFilterDateValue({})).toBe(false);
  });
});
