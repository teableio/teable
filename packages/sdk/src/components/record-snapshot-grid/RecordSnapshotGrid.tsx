import type { IRecord } from '@teable/core';
import { stringifyClipboardText } from '@teable/core';
import { Skeleton, sonner } from '@teable/ui-lib';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useIsHydrated } from '../../hooks/use-is-hydrated';
import type { IFieldInstance } from '../../model';
import { createRecordInstance } from '../../model';
import type {
  CombinedSelection,
  ICell,
  ICellItem,
  IGridColumn,
  IGridRef,
  IRowControlItem,
} from '../grid';
import {
  CellType,
  DraggableType,
  Grid,
  RowControlType,
  SelectableType,
  SelectionRegionType,
} from '../grid';
import { GRID_DEFAULT } from '../grid/configs';
import { useCreateCellValue2GridDisplay } from '../grid-enhancements/hooks/use-grid-columns';
import { useGridIcons } from '../grid-enhancements/hooks/use-grid-icons';
import { useGridTheme } from '../grid-enhancements/hooks/use-grid-theme';

const { toast } = sonner;

const CLIPBOARD_TEXT_TYPE = 'text/plain';
const DEFAULT_COLUMN_WIDTH = 150;
const LOAD_MORE_THRESHOLD = 30;
const DEFAULT_ROW_CONTROLS: IRowControlItem[] = [{ type: RowControlType.Expand }];

export interface IRecordSnapshotSystemColumn<TItem> {
  id: string;
  name: string;
  width?: number;
  getCellText: (item: TItem) => string;
}

export interface IRecordSnapshotGridProps<TItem extends object> {
  // Already filtered by the caller (e.g. canReadFieldRecord).
  fields: IFieldInstance[];
  rowCount: number;
  // undefined → not loaded yet (loading cell); null → the row is permanently absent
  // (e.g. a restored record), rendered as a blank row.
  getItem: (rowIndex: number) => TItem | null | undefined;
  getRecord: (item: TItem) => IRecord;
  // Frozen leading columns; freeze count equals its length.
  systemColumns: IRecordSnapshotSystemColumn<TItem>[];
  isLoading?: boolean;
  // Accumulate-mode driver: called when the loaded tail approaches the viewport.
  // The caller guards hasNextPage/isFetching before actually fetching.
  onLoadMore?: () => void;
  // Window-mode driver: reports the visible row range so the caller can fetch/evict
  // pages around it.
  onVisibleRangeChanged?: (range: { y: number; height: number }) => void;
  emptyText: string;
  copySuccessText?: string;
  selectable?: SelectableType;
  rowControls?: IRowControlItem[];
  onSelectionChanged?: (selection: CombinedSelection) => void;
  onRowExpand?: (item: TItem) => void;
  gridRef?: MutableRefObject<IGridRef | null>;
}

export function RecordSnapshotGrid<TItem extends object>(props: IRecordSnapshotGridProps<TItem>) {
  const {
    fields,
    rowCount,
    getItem,
    getRecord,
    systemColumns,
    isLoading,
    onLoadMore,
    onVisibleRangeChanged,
    emptyText,
    copySuccessText,
    selectable = SelectableType.Cell,
    rowControls = DEFAULT_ROW_CONTROLS,
    onSelectionChanged,
    onRowExpand,
    gridRef,
  } = props;
  const isHydrated = useIsHydrated();
  const theme = useGridTheme();
  const customIcons = useGridIcons();
  const systemColumnCount = systemColumns.length;

  // Fetched items keep their identity across window updates, so cached record instances
  // survive scrolling instead of re-instantiating every visible row.
  const recordCacheRef = useRef(new WeakMap<TItem, ReturnType<typeof createRecordInstance>>());
  const getRecordInstance = useCallback(
    (item: TItem) => {
      const cached = recordCacheRef.current.get(item);
      if (cached) {
        return cached;
      }
      const record = createRecordInstance(getRecord(item));
      recordCacheRef.current.set(item, record);
      return record;
    },
    [getRecord]
  );

  const columns = useMemo<IGridColumn[]>(
    () => [
      ...systemColumns.map(({ id, name, width }) => ({
        id,
        name,
        width: width ?? DEFAULT_COLUMN_WIDTH,
      })),
      ...fields.map((field) => ({
        id: field.id,
        name: field.name,
        width: DEFAULT_COLUMN_WIDTH,
      })),
    ],
    [systemColumns, fields]
  );

  const createCellValue2GridDisplay = useCreateCellValue2GridDisplay();
  const cellValue2GridDisplay = useMemo(
    () => createCellValue2GridDisplay(fields),
    [createCellValue2GridDisplay, fields]
  );

  const getCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell) => {
      const [colIndex, rowIndex] = cell;
      const item = getItem(rowIndex);
      if (item === undefined) return { type: CellType.Loading };

      const systemColumn = systemColumns[colIndex];
      const cellId = `${rowIndex}-${columns[colIndex]?.id}`;
      if (item === null) {
        return { id: cellId, type: CellType.Text, data: '', displayData: '', readonly: true };
      }
      if (systemColumn) {
        const text = systemColumn.getCellText(item);
        return { id: cellId, type: CellType.Text, data: text, displayData: text, readonly: true };
      }
      return cellValue2GridDisplay(getRecordInstance(item), colIndex - systemColumnCount);
    },
    [getItem, getRecordInstance, systemColumns, systemColumnCount, columns, cellValue2GridDisplay]
  );

  // The grid only reports its visible region on scroll, never on initial render, so an
  // under-filled first page would stall accumulate-mode loading (no scrollbar → no scroll
  // events). Fall back to estimating the viewport from the container height until a real
  // region arrives, and re-check after every page append.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastVisibleRegionRef = useRef<{ y: number; height: number } | null>(null);

  const checkLoadMore = useCallback(() => {
    if (!onLoadMore) return;
    const rect = lastVisibleRegionRef.current ?? {
      y: 0,
      height: Math.ceil((containerRef.current?.clientHeight ?? 0) / GRID_DEFAULT.rowHeight),
    };
    if (rect.y + rect.height >= rowCount - LOAD_MORE_THRESHOLD) {
      onLoadMore();
    }
  }, [onLoadMore, rowCount]);

  const onVisibleRegionChanged = useCallback(
    (rect: { y: number; height: number }) => {
      lastVisibleRegionRef.current = { y: rect.y, height: rect.height };
      checkLoadMore();
      onVisibleRangeChanged?.({ y: rect.y, height: rect.height });
    },
    [checkLoadMore, onVisibleRangeChanged]
  );

  useEffect(() => {
    checkLoadMore();
  }, [checkLoadMore]);

  // Read-only grid: copy resolves locally from the loaded snapshots, in the visible
  // column order (system columns first, then fields).
  const copyCellText = useCallback(
    (colIndex: number, rowIndex: number): string => {
      const item = getItem(rowIndex);
      if (item == null) return '';
      const systemColumn = systemColumns[colIndex];
      if (systemColumn) return systemColumn.getCellText(item);
      const field = fields[colIndex - systemColumnCount];
      if (!field) return '';
      const record = getRecordInstance(item);
      return field.cellValue2String(record.fields[field.id] as never);
    },
    [getItem, getRecordInstance, systemColumns, systemColumnCount, fields]
  );

  const onCopy = useCallback(
    // eslint-disable-next-line sonarjs/cognitive-complexity
    (selection: CombinedSelection, e: React.ClipboardEvent) => {
      const columnCount = systemColumnCount + fields.length;
      const content: string[][] = [];
      if (selection.type === SelectionRegionType.Cells) {
        const [[startCol, startRow], [endCol, endRow]] = selection.serialize();
        for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
          const row: string[] = [];
          for (let colIndex = startCol; colIndex <= endCol; colIndex++) {
            row.push(copyCellText(colIndex, rowIndex));
          }
          content.push(row);
        }
      } else if (selection.type === SelectionRegionType.Rows) {
        for (const [start, end] of selection.serialize()) {
          for (let rowIndex = start; rowIndex <= end; rowIndex++) {
            const row: string[] = [];
            for (let colIndex = 0; colIndex < columnCount; colIndex++) {
              row.push(copyCellText(colIndex, rowIndex));
            }
            content.push(row);
          }
        }
      } else if (selection.type === SelectionRegionType.Columns) {
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
          const row: string[] = [];
          for (const [start, end] of selection.serialize()) {
            for (let colIndex = start; colIndex <= end; colIndex++) {
              row.push(copyCellText(colIndex, rowIndex));
            }
          }
          content.push(row);
        }
      } else {
        return;
      }
      if (content.length === 0) return;
      e.clipboardData.setData(CLIPBOARD_TEXT_TYPE, stringifyClipboardText(content));
      e.preventDefault();
      if (copySuccessText) {
        toast.success(copySuccessText);
      }
    },
    [systemColumnCount, fields.length, rowCount, copyCellText, copySuccessText]
  );

  const handleRowExpand = useCallback(
    (rowIndex: number) => {
      const item = getItem(rowIndex);
      if (item != null && onRowExpand) {
        onRowExpand(item);
      }
    },
    [getItem, onRowExpand]
  );

  return (
    <div ref={containerRef} className="relative min-h-0 w-full flex-1 overflow-hidden">
      {isHydrated && (
        <Grid
          ref={gridRef}
          style={{ width: '100%', height: '100%' }}
          scrollBufferX={0}
          scrollBufferY={0}
          theme={theme}
          columns={columns}
          freezeColumnCount={systemColumnCount}
          rowCount={rowCount}
          customIcons={customIcons}
          draggable={DraggableType.None}
          selectable={selectable}
          rowControls={rowControls}
          onRowExpand={onRowExpand ? handleRowExpand : undefined}
          onSelectionChanged={onSelectionChanged}
          onVisibleRegionChanged={onVisibleRegionChanged}
          onCopy={onCopy}
          getCellContent={getCellContent}
        />
      )}
      {isLoading && (
        <div className="absolute inset-x-0 bottom-0 top-8 overflow-hidden bg-background">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex h-8 items-center gap-6 px-4">
              <Skeleton className="h-4 w-28 shrink-0" />
              <Skeleton className="h-4 w-20 shrink-0" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 flex-[2]" />
            </div>
          ))}
        </div>
      )}
      {!isLoading && rowCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      )}
    </div>
  );
}
