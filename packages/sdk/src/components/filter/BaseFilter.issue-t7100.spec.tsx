import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../context/__tests__/createAppContext';
import { BaseFilter } from './BaseFilter';
import type { IBaseFilterValue } from './types';
import { baseFilter2ViewFilter, viewFilter2BaseFilter } from './view-filter/utils';

const wrapper = createAppContext();

const nestedOrValue: IBaseFilterValue = {
  conjunction: 'and',
  children: [
    { field: 'fldMatch', operator: 'is', value: { type: 'field', fieldId: 'fldHostMatch' } },
    {
      conjunction: 'or',
      children: [
        { field: 'fldFlagA', operator: 'is', value: true },
        { field: 'fldFlagB', operator: 'is', value: true },
      ],
    },
  ],
};

const classesOf = (element: Element) => element.className.split(/\s+/).filter(Boolean);

describe('BaseFilter nested OR groups T7100', () => {
  it('round-trips MatchKey AND (FlagA OR FlagB) through view-filter serialization', () => {
    const viewFilter = baseFilter2ViewFilter(nestedOrValue);
    expect(viewFilter).toEqual({
      conjunction: 'and',
      filterSet: [
        {
          fieldId: 'fldMatch',
          operator: 'is',
          value: { type: 'field', fieldId: 'fldHostMatch' },
        },
        {
          conjunction: 'or',
          filterSet: [
            { fieldId: 'fldFlagA', operator: 'is', value: true },
            { fieldId: 'fldFlagB', operator: 'is', value: true },
          ],
        },
      ],
    });
    expect(viewFilter2BaseFilter(viewFilter)).toEqual(nestedOrValue);
  });

  it('wraps condition rows outside a drawer so nested-group add stays on screen', () => {
    // Field-setting sheets are ~400px and are not InDrawer. Condition rows used
    // a non-wrapping shrink-0 field+operator+value cluster, so the group card
    // grew past the sheet. Horizontal scroll hid the nested + control and users
    // clicked the always-visible root "Add condition", persisting
    // MatchKey AND (FlagA) AND FlagB.
    render(
      <BaseFilter
        value={nestedOrValue}
        onChange={vi.fn()}
        components={{
          FieldComponent: () => <div />,
          OperatorComponent: () => <div />,
          ValueComponent: () => <div />,
        }}
      />,
      { wrapper }
    );

    const items = document.querySelectorAll('[data-filter-condition-item]');
    expect(items.length).toBeGreaterThanOrEqual(2);
    for (const item of items) {
      const classes = classesOf(item);
      expect(classes).toContain('flex-wrap');
      expect(classes).toContain('min-w-0');
    }

    const controls = document.querySelectorAll('[data-filter-condition-controls]');
    expect(controls.length).toBeGreaterThanOrEqual(2);
    for (const row of controls) {
      const classes = classesOf(row);
      expect(classes).toContain('flex-wrap');
      expect(classes).toContain('min-w-0');
    }
  });
});
