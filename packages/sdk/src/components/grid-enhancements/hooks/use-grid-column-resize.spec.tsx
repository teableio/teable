import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFields } from '../../../hooks/use-fields';
import { useView } from '../../../hooks/use-view';
import { useViewId } from '../../../hooks/use-view-id';
import type { IGridColumn } from '../../grid';
import { useGridColumnResize } from './use-grid-column-resize';

vi.mock('../../../hooks/use-fields', () => ({
  useFields: vi.fn(),
}));

vi.mock('../../../hooks/use-view', () => ({
  useView: vi.fn(),
}));

vi.mock('../../../hooks/use-view-id', () => ({
  useViewId: vi.fn(),
}));

const mockedUseFields = vi.mocked(useFields);
const mockedUseView = vi.mocked(useView);
const mockedUseViewId = vi.mocked(useViewId);

const column = (id: string, width = 120): IGridColumn & { id: string } => ({
  id,
  name: id,
  width,
});

describe('useGridColumnResize', () => {
  const updateColumnMeta = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    mockedUseFields.mockReset();
    mockedUseView.mockReset();
    mockedUseViewId.mockReset();
    updateColumnMeta.mockClear();
    mockedUseView.mockReturnValue({
      id: 'viwTest',
      updateColumnMeta,
    } as unknown as ReturnType<typeof useView>);
    mockedUseViewId.mockReturnValue('viwTest');
  });

  it('does not throw when fields[colIndex] belongs to a different column after a delete', () => {
    // Grid still reports the deleted column at index 1; visible fields have already shifted.
    mockedUseFields.mockReturnValue([{ id: 'fldA' }, { id: 'fldC' }] as unknown as ReturnType<
      typeof useFields
    >);

    const columns = [column('fldA'), column('fldB'), column('fldC')];
    const { result } = renderHook(() => useGridColumnResize(columns));

    expect(() => result.current.onColumnResize(column('fldB'), 180, 1)).not.toThrow();
  });

  it('updates the named column width when the grid index is stale after a reorder', () => {
    mockedUseFields.mockReturnValue([{ id: 'fldC' }, { id: 'fldA' }] as unknown as ReturnType<
      typeof useFields
    >);

    const columns = [column('fldA'), column('fldC')];
    const { result } = renderHook(() => useGridColumnResize(columns));

    act(() => {
      result.current.onColumnResize(column('fldA'), 240, 0);
    });

    expect(result.current.columns.find((item) => item.id === 'fldA')?.width).toBe(240);
    expect(result.current.columns.find((item) => item.id === 'fldC')?.width).toBe(120);
  });

  it('does not change columns when the resized field is gone', () => {
    mockedUseFields.mockReturnValue([{ id: 'fldA' }] as unknown as ReturnType<typeof useFields>);

    const columns = [column('fldA'), column('fldB')];
    const { result } = renderHook(() => useGridColumnResize(columns));

    result.current.onColumnResize(column('fldB'), 180, 1);

    expect(result.current.columns).toEqual(columns);
  });
});
