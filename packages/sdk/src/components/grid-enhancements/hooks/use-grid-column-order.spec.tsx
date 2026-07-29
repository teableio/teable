import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewColumnOrderStore } from '../../../context/view/store/useViewColumnOrderStore';
import { useFields } from '../../../hooks/use-fields';
import { useView } from '../../../hooks/use-view';
import { useGridColumnOrder } from './use-grid-column-order';

vi.mock('../../../hooks/use-fields', () => ({
  useFields: vi.fn(),
}));

vi.mock('../../../hooks/use-view', () => ({
  useView: vi.fn(),
}));

const mockedUseFields = vi.mocked(useFields);
const mockedUseView = vi.mocked(useView);

const buildView = (columnMeta: Record<string, { order: number }>, updateColumnMeta = vi.fn()) =>
  ({
    id: 'viwTest',
    columnMeta,
    updateColumnMeta,
  }) as unknown as NonNullable<ReturnType<typeof useView>>;

describe('useGridColumnOrder', () => {
  beforeEach(() => {
    mockedUseFields.mockReset();
    mockedUseView.mockReset();
    useViewColumnOrderStore.setState({ pendingOrderMap: {} });

    mockedUseFields.mockReturnValue([
      { id: 'fld1' },
      { id: 'fld2' },
      { id: 'fld3' },
    ] as unknown as ReturnType<typeof useFields>);
  });

  it('applies the new order optimistically before the request settles', async () => {
    const updateColumnMeta = vi.fn().mockReturnValue(new Promise(() => undefined));
    mockedUseView.mockReturnValue(
      buildView({ fld1: { order: 0 }, fld2: { order: 1 }, fld3: { order: 2 } }, updateColumnMeta)
    );

    const { result } = renderHook(() => useGridColumnOrder());
    result.current.onColumnOrdered([2], 0);

    // the optimistic order lands synchronously, before the request is issued
    expect(useViewColumnOrderStore.getState().pendingOrderMap.viwTest).toEqual({ fld3: -1 });
    await waitFor(() => {
      expect(updateColumnMeta).toHaveBeenCalledWith([
        { fieldId: 'fld3', columnMeta: { order: -1 } },
      ]);
    });
  });

  it('rolls back the optimistic order when the request fails', async () => {
    const updateColumnMeta = vi.fn().mockRejectedValue(new Error('save failed'));
    mockedUseView.mockReturnValue(
      buildView({ fld1: { order: 0 }, fld2: { order: 1 }, fld3: { order: 2 } }, updateColumnMeta)
    );

    const { result } = renderHook(() => useGridColumnOrder());
    result.current.onColumnOrdered([2], 0);

    expect(useViewColumnOrderStore.getState().pendingOrderMap.viwTest).toEqual({ fld3: -1 });

    await waitFor(() => {
      expect(useViewColumnOrderStore.getState().pendingOrderMap.viwTest).toBeUndefined();
    });
  });

  it('prunes the optimistic order once the server-confirmed columnMeta matches', async () => {
    mockedUseView.mockReturnValue(
      buildView({ fld1: { order: 0 }, fld2: { order: 1 }, fld3: { order: 2 } })
    );

    const { rerender } = renderHook(() => useGridColumnOrder());
    useViewColumnOrderStore.getState().setPendingOrder('viwTest', { fld3: -1 });

    // server op arrives: view now carries the confirmed order
    mockedUseView.mockReturnValue(
      buildView({ fld1: { order: 0 }, fld2: { order: 1 }, fld3: { order: -1 } })
    );
    rerender();

    await waitFor(() => {
      expect(useViewColumnOrderStore.getState().pendingOrderMap.viwTest).toBeUndefined();
    });
  });

  it('bails out silently when a neighbor column meta is missing (no crash, no request)', () => {
    const updateColumnMeta = vi.fn();
    // fld3 has no columnMeta entry yet (e.g. just created)
    mockedUseView.mockReturnValue(
      buildView({ fld1: { order: 0 }, fld2: { order: 1 } }, updateColumnMeta)
    );

    const { result } = renderHook(() => useGridColumnOrder());
    // dropping past the last column reads the missing fld3 meta
    expect(() => result.current.onColumnOrdered([0], 3)).not.toThrow();

    expect(updateColumnMeta).not.toHaveBeenCalled();
    expect(useViewColumnOrderStore.getState().pendingOrderMap.viwTest).toBeUndefined();
  });

  it('rolls back instead of crashing when updateColumnMeta throws synchronously', async () => {
    const updateColumnMeta = vi.fn(() => {
      throw new Error('sync boom');
    });
    mockedUseView.mockReturnValue(
      buildView({ fld1: { order: 0 }, fld2: { order: 1 }, fld3: { order: 2 } }, updateColumnMeta)
    );

    const { result } = renderHook(() => useGridColumnOrder());
    expect(() => result.current.onColumnOrdered([2], 0)).not.toThrow();

    await waitFor(() => {
      expect(useViewColumnOrderStore.getState().pendingOrderMap.viwTest).toBeUndefined();
    });
  });

  it('hands back to server data when the grid unmounts (view/table switch)', () => {
    const updateColumnMeta = vi.fn().mockReturnValue(new Promise(() => undefined));
    mockedUseView.mockReturnValue(
      buildView({ fld1: { order: 0 }, fld2: { order: 1 }, fld3: { order: 2 } }, updateColumnMeta)
    );

    const { result, unmount } = renderHook(() => useGridColumnOrder());
    result.current.onColumnOrdered([2], 0);
    expect(useViewColumnOrderStore.getState().pendingOrderMap.viwTest).toEqual({ fld3: -1 });

    unmount();

    expect(useViewColumnOrderStore.getState().pendingOrderMap.viwTest).toBeUndefined();
  });

  it('computes neighbor orders from the pending order during consecutive drags', async () => {
    const updateColumnMeta = vi.fn().mockReturnValue(new Promise(() => undefined));
    // first drag already moved fld3 to the front: fields are sorted by the
    // effective order while columnMeta still holds the stale server values
    useViewColumnOrderStore.getState().setPendingOrder('viwTest', { fld3: -1 });
    mockedUseFields.mockReturnValue([
      { id: 'fld3' },
      { id: 'fld1' },
      { id: 'fld2' },
    ] as unknown as ReturnType<typeof useFields>);
    mockedUseView.mockReturnValue(
      buildView({ fld1: { order: 0 }, fld2: { order: 1 }, fld3: { order: 2 } }, updateColumnMeta)
    );

    const { result } = renderHook(() => useGridColumnOrder());
    // drag fld2 (index 2) to the very front
    result.current.onColumnOrdered([2], 0);

    // neighbor order must be the pending -1, not the stale server order 2
    await waitFor(() => {
      expect(updateColumnMeta).toHaveBeenCalledWith([
        { fieldId: 'fld2', columnMeta: { order: -2 } },
      ]);
    });
  });
});
