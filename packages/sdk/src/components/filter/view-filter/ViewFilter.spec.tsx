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

const twoConditionFilter: IFilter = {
  conjunction: 'and',
  filterSet: [
    { fieldId: field.id, operator: 'is', value: '111' },
    { fieldId: field.id, operator: 'is', value: '222' },
  ],
};

const remoteFilter: IFilter = {
  conjunction: 'and',
  filterSet: [{ fieldId: field.id, operator: 'is', value: 'remote' }],
};

const viewIdRef = { current: 'viwTest00000000001' };

vi.mock('../../../hooks', () => ({
  useFields: () => [field],
  useTableId: () => 'tblTest00000000001',
  useViewId: () => viewIdRef.current,
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
  BaseViewFilter: ({
    value,
    onChange,
  }: {
    value: IFilter;
    onChange: (filter: IFilter) => void;
  }) => (
    <>
      <span data-testid="filter-value">{JSON.stringify(value)}</span>
      <button type="button" onClick={() => onChange(textFilter)}>
        add filter
      </button>
      <button type="button" onClick={() => onChange(twoConditionFilter)}>
        add second filter
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
    viewIdRef.current = 'viwTest00000000001';
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

  it('keeps a newer local edit when the echo of an earlier save arrives late', async () => {
    const saves: Array<() => void> = [];
    const onChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          saves.push(resolve);
        })
    );
    const view = renderViewFilter(null, onChange);

    fireEvent.click(screen.getByRole('button', { name: 'add filter' }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByRole('button', { name: 'add second filter' }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenLastCalledWith(twoConditionFilter);

    // The first save's echo arrives while the second save is still in flight.
    view.rerender(
      <ViewFilter filters={textFilter} onChange={onChange}>
        {(text) => <span data-testid="filter-label">{text}</span>}
      </ViewFilter>
    );

    expect(screen.getByTestId('filter-value')).toHaveTextContent(
      JSON.stringify(twoConditionFilter)
    );
  });

  it('saves an edit that returns to the parent value while an earlier save is in flight', async () => {
    const onChange = vi.fn(() => new Promise<void>(() => undefined));
    renderViewFilter(null, onChange);

    fireEvent.click(screen.getByRole('button', { name: 'add filter' }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByRole('button', { name: 'clear filter' }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('shows the next view filters when switching views while a save is in flight', async () => {
    const onChange = vi.fn(() => new Promise<void>(() => undefined));
    const view = renderViewFilter(null, onChange);

    fireEvent.click(screen.getByRole('button', { name: 'add filter' }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    viewIdRef.current = 'viwTest00000000002';
    view.rerender(
      <ViewFilter filters={remoteFilter} onChange={onChange}>
        {(text) => <span data-testid="filter-label">{text}</span>}
      </ViewFilter>
    );

    expect(screen.getByTestId('filter-value')).toHaveTextContent(JSON.stringify(remoteFilter));
  });

  it('applies a collaborator update that arrived during a save once the save settles', async () => {
    const saves: Array<() => void> = [];
    const onChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          saves.push(resolve);
        })
    );
    const view = renderViewFilter(null, onChange);

    fireEvent.click(screen.getByRole('button', { name: 'add filter' }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    view.rerender(
      <ViewFilter filters={remoteFilter} onChange={onChange}>
        {(text) => <span data-testid="filter-label">{text}</span>}
      </ViewFilter>
    );
    expect(screen.getByTestId('filter-value')).toHaveTextContent(JSON.stringify(textFilter));

    await act(async () => {
      saves[0]();
    });

    expect(screen.getByTestId('filter-value')).toHaveTextContent(JSON.stringify(remoteFilter));
  });

  it('keeps the local filter when only the echo of its own save arrived during the save', async () => {
    const saves: Array<() => void> = [];
    const onChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          saves.push(resolve);
        })
    );
    const view = renderViewFilter(null, onChange);

    fireEvent.click(screen.getByRole('button', { name: 'add filter' }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByRole('button', { name: 'add second filter' }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // Echo of the first save, then both saves settle before the second echo arrives.
    view.rerender(
      <ViewFilter filters={textFilter} onChange={onChange}>
        {(text) => <span data-testid="filter-label">{text}</span>}
      </ViewFilter>
    );
    await act(async () => {
      saves[0]();
      saves[1]();
    });

    expect(screen.getByTestId('filter-value')).toHaveTextContent(
      JSON.stringify(twoConditionFilter)
    );
  });

  it('saves an edit made just before a view switch to the view it was made in', async () => {
    const saveToFirstView = vi.fn();
    const saveToSecondView = vi.fn();
    const view = renderViewFilter(null, saveToFirstView);

    fireEvent.click(screen.getByRole('button', { name: 'add filter' }));
    viewIdRef.current = 'viwTest00000000002';
    view.rerender(
      <ViewFilter filters={remoteFilter} onChange={saveToSecondView}>
        {(text) => <span data-testid="filter-label">{text}</span>}
      </ViewFilter>
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(saveToFirstView).toHaveBeenCalledWith(textFilter);
    expect(saveToSecondView).not.toHaveBeenCalled();
    expect(screen.getByTestId('filter-value')).toHaveTextContent(JSON.stringify(remoteFilter));
  });
});
