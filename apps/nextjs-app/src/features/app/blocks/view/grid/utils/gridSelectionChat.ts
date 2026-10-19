import type { QueryClient } from '@tanstack/react-query';
import { CombinedSelection, SelectionRegionType } from '@teable/sdk';
import type { Field, IRecordIndexMap } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useChatPanelStore } from '@/features/app/components/sidebar/useChatPanelStore';

export enum GridSelectionType {
  Rows = 'rows',
  Cols = 'cols',
  Cells = 'cells',
}

/** Action-time identities only; labels and previews resolve authorized current data. */
export interface IGridSelectionCacheData {
  selectionType: GridSelectionType;
  tableId: string;
  viewId?: string;
  tableName?: string;
  recordIds: string[];
  fieldIds?: string[];
  timestamp: number;
  addToChat?: boolean;
}
export type IGridSelectionCaptureData = Omit<IGridSelectionCacheData, 'timestamp' | 'addToChat'>;
const captureIntents = new WeakMap<QueryClient, Map<string, symbol>>();

/** Paste invalidates pending captures, not already captured clipboard references. */
export function cancelGridSelectionCapture(queryClient: QueryClient, baseId: string) {
  captureIntents.get(queryClient)?.delete(baseId);
}

export function cacheSelectionForChat(
  queryClient: QueryClient,
  baseId: string,
  data: IGridSelectionCaptureData | Promise<IGridSelectionCaptureData>,
  addToChat: boolean
): Promise<void> | void {
  const intents = captureIntents.get(queryClient) ?? new Map<string, symbol>();
  captureIntents.set(queryClient, intents);
  const intent = Symbol();
  intents.set(baseId, intent);
  queryClient.removeQueries({ queryKey: ReactQueryKeys.gridSelection(baseId), exact: true });
  const commit = (selection: IGridSelectionCaptureData) => {
    if (intents.get(baseId) !== intent) return;
    intents.delete(baseId);
    queryClient.setQueryData<IGridSelectionCacheData>(ReactQueryKeys.gridSelection(baseId), {
      ...selection,
      timestamp: Date.now(),
      addToChat,
    });
    if (addToChat) {
      const panel = useChatPanelStore.getState();
      panel.open();
      panel.requestMobileOpen();
    }
  };
  if (!(data instanceof Promise)) return commit(data);
  return data.then(commit, (error: unknown) => {
    if (intents.get(baseId) !== intent) return;
    intents.delete(baseId);
    throw error;
  });
}

export function cacheRecordForChat(
  queryClient: QueryClient,
  baseId: string,
  resource: { tableId: string; viewId?: string; recordId: string }
) {
  const { recordId, ...source } = resource;
  cacheSelectionForChat(
    queryClient,
    baseId,
    { ...source, selectionType: GridSelectionType.Rows, recordIds: [recordId] },
    true
  );
}

function boundRanges(ranges: [number, number][], count?: number | null) {
  const normalized = ranges
    .map(([a, b]): [number, number] => [
      Math.max(0, Math.min(a, b)),
      Math.min(Math.max(a, b), count == null ? Infinity : count - 1),
    ])
    .filter(([a, b]) => a <= b);
  if (normalized.some(([a, b]) => !Number.isInteger(a) || !Number.isInteger(b))) {
    throw new Error('Selected record ids are not loaded yet');
  }
  return new CombinedSelection(SelectionRegionType.Rows, normalized).serialize();
}

function selectionGeometry(
  selection: CombinedSelection,
  rowCount: number | null | undefined,
  fields: Pick<Field, 'id'>[]
) {
  const ranges = selection.ranges;
  const rowRanges = boundRanges(
    selection.isRowSelection
      ? ranges
      : selection.isColumnSelection
        ? [[0, (rowCount ?? 0) - 1]]
        : [[ranges[0][1], ranges[1][1]]],
    rowCount
  );
  const selectedFields = selection.isRowSelection
    ? undefined
    : boundRanges(
        selection.isColumnSelection ? ranges : [[ranges[0][0], ranges[1][0]]],
        fields.length
      ).flatMap(([start, end]) => fields.slice(start, end + 1));
  return { rowRanges, selectedFields };
}

/** Materialize the entire selection once, using the ordinary selection-operation query. */
export function resolveGridSelectionForChat(
  selection: CombinedSelection,
  options: {
    tableId: string;
    viewId?: string;
    tableName?: string;
    rowCount?: number | null;
    fields: Pick<Field, 'id'>[];
    recordMap: { [index: number]: Pick<IRecordIndexMap[number], 'id'> };
    loadRecordIds: (rowRanges: [number, number][]) => Promise<string[]>;
  }
): IGridSelectionCaptureData | Promise<IGridSelectionCaptureData> {
  const { tableId, viewId, tableName, rowCount, fields, recordMap, loadRecordIds } = options;
  if (selection.isNoneSelection || (selection.isColumnSelection && rowCount == null)) {
    throw new Error('Selected record ids are not loaded yet');
  }
  const { rowRanges, selectedFields } = selectionGeometry(selection, rowCount, fields);
  if (selectedFields && !selectedFields.length) throw new Error('Selection contains no fields');
  // Snapshot loaded anchors before awaiting; record models are mutable.
  const loadedIds: (string | undefined)[] = [];
  for (const [start, end] of rowRanges) {
    for (let index = start; index <= end; index++) loadedIds.push(recordMap[index]?.id);
  }
  if (!loadedIds.length && !selection.isColumnSelection)
    throw new Error('Selection contains no records');
  const captured = {
    tableId,
    viewId,
    tableName,
    selectionType: selection.isRowSelection
      ? GridSelectionType.Rows
      : selection.isColumnSelection
        ? GridSelectionType.Cols
        : GridSelectionType.Cells,
    ...(selectedFields ? { fieldIds: selectedFields.map(({ id }) => id) } : {}),
  };
  const complete = (recordIds: string[]): IGridSelectionCaptureData => {
    if (
      new Set(recordIds).size !== loadedIds.length ||
      recordIds.length !== loadedIds.length ||
      loadedIds.some((id, index) => id != null && id !== recordIds[index])
    ) {
      throw new Error('Selection changed or could not be completely loaded. Select it again.');
    }
    return { ...captured, recordIds };
  };
  return loadedIds.every((id): id is string => id != null)
    ? complete(loadedIds)
    : loadRecordIds(rowRanges).then(complete);
}

export function isSingleCellSelection(selection: CombinedSelection): boolean {
  if (!selection.isCellSelection) return false;
  const [[c0, r0], [c1, r1]] = selection.serialize();
  return c0 === c1 && r0 === r1;
}
