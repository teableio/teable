import { FieldType, is } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import { describe, it, expect } from 'vitest';
import { extractDefaultFieldsFromFilters } from '../../../utils';

/**
 * Reproduction for the group pre-fill bug.
 *
 * When a view has an incomplete filter (operator set, value empty),
 * `extractDefaultFieldsFromFilters` returned `{ fieldId: null }`.
 * The useEffect in `useGridPrefillingRow` then merged this into
 * the prefillingFieldValueMap via `{ ...prev, ...filterDefaults }`,
 * overwriting the group pre-fill value with null.
 *
 * Fix: skip incomplete non-checkbox null filters in filterItemHandler.
 * Checkbox "is null" means "unchecked" and is a valid complete filter.
 */
describe('extractDefaultFieldsFromFilters: incomplete filters should be skipped', () => {
  const selectFieldId = 'fldSelectField';
  const checkboxFieldId = 'fldCheckboxField';

  const fieldMap: Record<string, IFieldVo> = {
    [selectFieldId]: {
      id: selectFieldId,
      name: 'Count',
      type: FieldType.SingleSelect,
      options: { choices: [{ name: '100', color: 'blue' }] },
    } as IFieldVo,
    [checkboxFieldId]: {
      id: checkboxFieldId,
      name: 'Done',
      type: FieldType.Checkbox,
      options: {},
    } as IFieldVo,
  };

  it('should skip non-checkbox filter with null value (incomplete filter)', async () => {
    const result = await extractDefaultFieldsFromFilters({
      filter: {
        conjunction: 'and' as const,
        filterSet: [{ fieldId: selectFieldId, operator: is.value, value: null }],
      },
      fieldMap,
      currentUserId: 'usrTest',
    });

    expect(result).toEqual({});
  });

  it('should keep checkbox filter with null value ("is unchecked" is valid)', async () => {
    const result = await extractDefaultFieldsFromFilters({
      filter: {
        conjunction: 'and' as const,
        filterSet: [{ fieldId: checkboxFieldId, operator: is.value, value: null }],
      },
      fieldMap,
      currentUserId: 'usrTest',
    });

    expect(result).toEqual({ [checkboxFieldId]: null });
  });

  it('should still extract defaults from a filter with actual value', async () => {
    const result = await extractDefaultFieldsFromFilters({
      filter: {
        conjunction: 'and' as const,
        filterSet: [{ fieldId: selectFieldId, operator: is.value, value: '100' }],
      },
      fieldMap,
      currentUserId: 'usrTest',
    });

    expect(result).toEqual({ [selectFieldId]: '100' });
  });

  it('group pre-fill value is preserved when filter is incomplete', async () => {
    const groupPreFill: Record<string, unknown> = { [selectFieldId]: '100' };

    const filterDefaults = await extractDefaultFieldsFromFilters({
      filter: {
        conjunction: 'and' as const,
        filterSet: [{ fieldId: selectFieldId, operator: is.value, value: null }],
      },
      fieldMap,
      currentUserId: 'usrTest',
    });

    const result = { ...groupPreFill, ...filterDefaults };
    expect(result[selectFieldId]).toBe('100');
  });
});
