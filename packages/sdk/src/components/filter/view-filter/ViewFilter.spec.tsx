import type { IFilter } from '@teable/core';
import { CellValueType, FieldType } from '@teable/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../../context/__tests__/createAppContext';
import type { IFieldInstance } from '../../../model';
import type * as ViewFilterHooks from './hooks';
import { ViewFilter } from './ViewFilter';

const field = {
  id: 'fldText00000000001',
  name: 'Single line text',
  type: FieldType.SingleLineText,
  cellValueType: CellValueType.String,
  isMultipleCellValue: false,
} as IFieldInstance;

const textFilter: IFilter = {
  conjunction: 'and',
  filterSet: [{ fieldId: field.id, operator: 'is', value: '111' }],
};

const remoteFilter: IFilter = {
  conjunction: 'and',
  filterSet: [{ fieldId: field.id, operator: 'is', value: 'remote' }],
};

vi.mock('../../../hooks', () => ({
  useFields: () => [field],
  useTableId: () => 'tblTest00000000001',
  useViewId: () => 'viwTest00000000001',
}));

vi.mock('@teable/ui-lib', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The responsive shell has its own coverage; here it is flattened so these
// tests stay about ViewFilter's debounce/rollback behaviour.
vi.mock('../../adaptive-panel', () => ({
  AdaptivePanel: ({
    children,
    overlay,
    content,
    footer,
  }: {
    children: ReactNode;
    overlay?: ReactNode;
    content: ReactNode;
    footer?: ReactNode;
  }) => (
    <>
      {children}
      {overlay}
      {content}
      {footer}
    </>
  ),
  useIsDrawerPanel: () => false,
}));

vi.mock('../../ReadOnlyTip', () => ({ ReadOnlyTip: () => null }));

vi.mock('./BaseViewFilter', () => ({
  BaseViewFilter: ({ onChange }: { onChange: (filter: IFilter) => void }) => (
    <>
      <button type="button" onClick={() => onChange(textFilter)}>
        add filter
      </button>
      <button type="button" onClick={() => onChange(null)}>
        clear filter
      </button>
    </>
  ),
}));

vi.mock('./hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof ViewFilterHooks>();
  return {
    ...actual,
    useViewFilterLinkContext: () => ({}),
  };
});

const wrapper = createAppContext();

const renderViewFilter = (filters: IFilter, onChange: (filter: IFilter) => void | Promise<void>) =>
  render(
    <ViewFilter filters={filters} onChange={onChange}>
      {(text) => <span data-testid="filter-label">{text}</span>}
    </ViewFilter>,
    { wrapper }
  );

describe('ViewFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates the toolbar summary before the parent filter prop changes', () => {
    renderViewFilter(null, vi.fn());

    fireEvent.click(screen.getByRole('button', { name: 'add filter' }));

    expect(screen.getByTestId('filter-label')).toHaveTextContent('Filter by Single line text');
  });

  it('accepts a remote filter after a local edit returns to the parent value', async () => {
    const onChange = vi.fn();
    const view = renderViewFilter(null, onChange);

    fireEvent.click(screen.getByRole('button', { name: 'add filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'clear filter' }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    view.rerender(
      <ViewFilter filters={remoteFilter} onChange={onChange}>
        {(text) => <span data-testid="filter-label">{text}</span>}
      </ViewFilter>
    );

    expect(screen.getByTestId('filter-label')).toHaveTextContent('Filter by Single line text');
  });

  it('restores the synchronized toolbar summary when saving fails', async () => {
    const onChange = vi.fn().mockRejectedValue(new Error('save failed'));
    renderViewFilter(textFilter, onChange);

    fireEvent.click(screen.getByRole('button', { name: 'clear filter' }));
    expect(screen.getByTestId('filter-label')).toHaveTextContent('Filter');

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(screen.getByTestId('filter-label')).toHaveTextContent('Filter by Single line text');
  });
});
