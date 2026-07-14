import { describe, expect, it } from 'vitest';

import { RollupFieldConfig } from './RollupFieldConfig';

const linkFieldId = `fld${'a'.repeat(16)}`;
const foreignTableId = `tbl${'b'.repeat(16)}`;
const lookupFieldId = `fld${'c'.repeat(16)}`;
const statusFieldId = `fld${'d'.repeat(16)}`;

describe('RollupFieldConfig', () => {
  it('creates without condition when filter is omitted', () => {
    const result = RollupFieldConfig.create({
      linkFieldId,
      foreignTableId,
      lookupFieldId,
    });

    expect(result.isOk()).toBe(true);
    const config = result._unsafeUnwrap();
    expect(config.condition()).toBeUndefined();
    expect(config.toDto()).toEqual({
      linkFieldId,
      foreignTableId,
      lookupFieldId,
    });
  });

  it('round-trips filter condition (T6179)', () => {
    const filter = {
      conjunction: 'and' as const,
      filterSet: [{ fieldId: statusFieldId, operator: 'is', value: '待开始' }],
    };

    const result = RollupFieldConfig.create({
      linkFieldId,
      foreignTableId,
      lookupFieldId,
      filter,
    });

    expect(result.isOk()).toBe(true);
    const config = result._unsafeUnwrap();
    expect(config.condition()?.hasFilter()).toBe(true);
    expect(config.toDto()).toEqual({
      linkFieldId,
      foreignTableId,
      lookupFieldId,
      filter,
      sort: undefined,
      limit: undefined,
    });
  });

  it('equals compares condition', () => {
    const filter = {
      conjunction: 'and' as const,
      filterSet: [{ fieldId: statusFieldId, operator: 'is', value: 'Active' }],
    };
    const withFilter = RollupFieldConfig.create({
      linkFieldId,
      foreignTableId,
      lookupFieldId,
      filter,
    })._unsafeUnwrap();
    const withoutFilter = RollupFieldConfig.create({
      linkFieldId,
      foreignTableId,
      lookupFieldId,
    })._unsafeUnwrap();
    const sameFilter = RollupFieldConfig.create({
      linkFieldId,
      foreignTableId,
      lookupFieldId,
      filter,
    })._unsafeUnwrap();

    expect(withFilter.equals(sameFilter)).toBe(true);
    expect(withFilter.equals(withoutFilter)).toBe(false);
  });
});
