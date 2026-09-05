import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../context/__tests__/createAppContext';
import { BaseFilter } from './BaseFilter';
import type { IBaseFilterValue } from './types';
import { baseFilter2ViewFilter, viewFilter2BaseFilter } from './view-filter/utils';

const wrapper = createAppContext();

const nestedValue: IBaseFilterValue = {
  conjunction: 'and',
  children: [
    { field: 'fldMatch', operator: 'is', value: { type: 'field', fieldId: 'fldHostMatch' } },
    {
      conjunction: 'or',
      children: [{ field: 'fldFlagA', operator: 'is', value: true }],
    },
  ],
};

const classesOf = (element: Element) => element.className.split(/\s+/).filter(Boolean);

describe('BaseFilter nested groups T7084', () => {
  it('round-trips a nested OR group through view-filter serialization', () => {
    const viewFilter = baseFilter2ViewFilter(nestedValue);
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
          filterSet: [{ fieldId: 'fldFlagA', operator: 'is', value: true }],
        },
      ],
    });
    expect(viewFilter2BaseFilter(viewFilter)).toEqual(nestedValue);
  });

  it('keeps nested-group add actions shrinkable outside a drawer', () => {
    // Field-setting sheets are ~400px and are not InDrawer. The group header is
    // still a row: without horizontal shrink the +/delete controls overflow and
    // users add FlagB via the root footer, flattening AND (FlagA OR FlagB).
    render(
      <BaseFilter
        value={nestedValue}
        onChange={vi.fn()}
        components={{
          FieldComponent: () => <div />,
          OperatorComponent: () => <div />,
          ValueComponent: () => <div />,
        }}
      />,
      { wrapper }
    );

    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes.length).toBeGreaterThanOrEqual(2);
    const nestedGroupConjunction = comboboxes[1];
    const classes = classesOf(nestedGroupConjunction);
    expect(classes).toContain('shrink');
    expect(classes).not.toContain('shrink-0');
  });
});
