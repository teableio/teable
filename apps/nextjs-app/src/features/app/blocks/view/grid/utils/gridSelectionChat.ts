import type { QueryClient } from '@tanstack/react-query';
import type { CombinedSelection } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useChatPanelStore } from '@/features/app/components/sidebar/useChatPanelStore';

export enum GridSelectionType {
  Rows = 'rows',
  Cols = 'cols',
  Cells = 'cells',
}

export interface IGridSelectionCacheColumns {
  columnStart: number;
  columnEnd: number;
  names?: string[];
}

interface IGridSelectionCacheData {
  rows?: [number, number][];
  columns?: IGridSelectionCacheColumns;
  timestamp: number;
  addToChat?: boolean;
}

function setGridSelectionCache(
  queryClient: QueryClient,
  baseId: string,
  data: Omit<IGridSelectionCacheData, 'timestamp'>
) {
  queryClient.setQueryData(ReactQueryKeys.gridSelection(baseId), {
    ...data,
    timestamp: Date.now(),
  });
  if (data.addToChat) {
    useChatPanelStore.getState().open();
  }
}

function getRowRanges(selection: CombinedSelection): [number, number][] | null {
  const { isCellSelection, isRowSelection } = selection;
  if (isCellSelection) {
    const [[, startRow], [, endRow]] = selection.serialize();
    return [[Math.min(startRow, endRow), Math.max(startRow, endRow)]];
  }
  if (isRowSelection) {
    return selection
      .serialize()
      .map(([s, e]) => [Math.min(s, e), Math.max(s, e)] as [number, number]);
  }
  return null;
}

function getColRange(
  selection: CombinedSelection
): { columnStart: number; columnEnd: number } | null {
  if (selection.isCellSelection) {
    const [[c0], [c1]] = selection.serialize();
    return { columnStart: Math.min(c0, c1), columnEnd: Math.max(c0, c1) };
  }
  if (selection.isColumnSelection) {
    const [start, end] = selection.serialize()[0];
    return { columnStart: Math.min(start, end), columnEnd: Math.max(start, end) };
  }
  return null;
}

export function cacheSelectionForChat(
  queryClient: QueryClient,
  baseId: string,
  selection: CombinedSelection,
  addToChat: boolean
) {
  const rows = getRowRanges(selection);
  const cols = getColRange(selection);

  if (selection.isColumnSelection && cols) {
    setGridSelectionCache(queryClient, baseId, { columns: cols, addToChat });
  } else if (selection.isCellSelection && rows && cols) {
    setGridSelectionCache(queryClient, baseId, { rows, columns: cols, addToChat });
  } else if (rows) {
    setGridSelectionCache(queryClient, baseId, { rows, addToChat });
  }
}

export function cacheColumnSelectionForChat(
  queryClient: QueryClient,
  baseId: string,
  columnStart: number,
  columnEnd: number,
  names?: string[]
) {
  setGridSelectionCache(queryClient, baseId, {
    columns: { columnStart, columnEnd, names },
    addToChat: true,
  });
}

export function isSingleCellSelection(selection: CombinedSelection): boolean {
  if (!selection.isCellSelection) return false;
  const [[c0, r0], [c1, r1]] = selection.serialize();
  return c0 === c1 && r0 === r1;
}
