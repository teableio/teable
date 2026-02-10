import type { ILinkCellValue } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { getIdsFromRanges, RangeType, IdReturnType } from '@teable/openapi';
import { Skeleton, sonner } from '@teable/ui-lib';
import { uniqueId } from 'lodash';
import type { ForwardRefRenderFunction } from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useTableId, useViewId } from '../../../hooks';
import type { ICell, ICellItem, IGridColumn, IGridRef, IRectangle, IRange } from '../../grid';

import {
  CombinedSelection,
  Grid,
  CellType,
  RegionType,
  DraggableType,
  SelectableType,
  SelectionRegionType,
  emptySelection,
  RowControlType,
} from '../../grid';
import {
  GridTooltip,
  useGridIcons,
  useGridTheme,
  useGridColumns,
  useGridAsyncRecordsQuery,
  useGridTooltipStore,
} from '../../grid-enhancements';
import { LinkListType } from './interface';

const MAX_SELECT_COUNT = 1000;

const { toast } = sonner;
interface ILinkListProps {
  type?: LinkListType;
  rowCount: number;
  hiddenFieldIds?: string[];
  readonly?: boolean;
  isMultiple?: boolean;
  recordQuery?: IGetRecordsRo;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  onChange?: (value?: ILinkCellValue[]) => void;
  onExpand?: (recordId: string) => void;
}

export interface ILinkListRef {
  onReset: () => void;
  onForceUpdate: () => void;
  setSelection: (selection: CombinedSelection) => void;
  scrollToItem: (position: [columnIndex: number, rowIndex: number]) => void;
}

const LinkListBase: ForwardRefRenderFunction<ILinkListRef, ILinkListProps> = (
  props,
  forwardRef
) => {
  const {
    readonly,
    type = LinkListType.All,
    rowCount,
    cellValue,
    recordQuery,
    isMultiple,
    hiddenFieldIds,
    onChange,
    onExpand,
  } = props;

  useImperativeHandle(forwardRef, () => ({
    onReset,
    onForceUpdate,
    setSelection: (selection: CombinedSelection) => {
      gridRef.current?.setSelection(selection);
    },
    scrollToItem: (position: [columnIndex: number, rowIndex: number]) => {
      gridRef.current?.scrollToItem(position);
    },
  }));

  const [columnWidths, setColumnWidths] = useState<Map<string, number>>(new Map());
  const [isTabSwitchTransitioning, setIsTabSwitchTransitioning] = useState(false);
  const [hasTabSwitchStartedQuerying, setHasTabSwitchStartedQuerying] = useState(false);

  const theme = useGridTheme();
  const customIcons = useGridIcons();
  const { openTooltip, closeTooltip } = useGridTooltipStore();
  const { columns: baseColumns, cellValue2GridDisplay } = useGridColumns(false, hiddenFieldIds);

  const gridRef = useRef<IGridRef>(null);
  const prevListTypeRef = useRef(type);
  const rowCountRef = useRef<number>(rowCount);
  rowCountRef.current = rowCount;
  const isSelectedType = type === LinkListType.Selected;
  const isAllType = type === LinkListType.All;
  const isExpandEnable = Boolean(onExpand);
  const { t } = useTranslation();

  // Get tableId and viewId for API calls
  const tableId = useTableId();
  const viewId = useViewId();

  // Selected records ref - maintains the source of truth for selected records (id -> title)
  const selectedRecordsRef = useRef<Map<string, string | undefined>>(new Map());

  const { recordMap, isQuerying, onReset, onForceUpdate, onVisibleRegionChanged } =
    useGridAsyncRecordsQuery(recordQuery);

  const columns = useMemo(() => {
    if (columnWidths.size === 0) return baseColumns;

    return baseColumns.map((col) => {
      const width = columnWidths.get(col.id);
      return width !== undefined ? { ...col, width } : col;
    });
  }, [baseColumns, columnWidths]);
  const hasLoadedRecords = useMemo(() => {
    return Object.values(recordMap).some((record) => record != null);
  }, [recordMap]);
  const shouldShowSkeleton = useMemo(() => {
    if (isTabSwitchTransitioning) return true;
    if (!isQuerying) return false;
    if (columns.length === 0) return true;
    if (rowCount <= 0) return true;
    return !hasLoadedRecords;
  }, [columns.length, hasLoadedRecords, isQuerying, isTabSwitchTransitioning, rowCount]);
  const shouldRenderGrid = !shouldShowSkeleton;

  useEffect(() => {
    if (prevListTypeRef.current === type) return;
    prevListTypeRef.current = type;
    setIsTabSwitchTransitioning(true);
    setHasTabSwitchStartedQuerying(false);
  }, [type]);

  useEffect(() => {
    if (!isTabSwitchTransitioning) return;

    if (isQuerying) {
      if (!hasTabSwitchStartedQuerying) {
        setHasTabSwitchStartedQuerying(true);
      }
      return;
    }

    if (hasTabSwitchStartedQuerying || hasLoadedRecords || rowCount <= 0) {
      setIsTabSwitchTransitioning(false);
      setHasTabSwitchStartedQuerying(false);
    }
  }, [
    hasLoadedRecords,
    hasTabSwitchStartedQuerying,
    isQuerying,
    isTabSwitchTransitioning,
    rowCount,
  ]);

  const componentId = useMemo(() => uniqueId('link-editor-'), []);

  const rowControls = useMemo(() => {
    const controls = [];

    if (!readonly) {
      controls.push({
        type: RowControlType.Checkbox,
        icon: RowControlType.Checkbox,
      });
    }

    if (isExpandEnable) {
      controls.push({
        type: RowControlType.Expand,
        icon: RowControlType.Expand,
      });
    }
    return controls;
  }, [isExpandEnable, readonly]);

  // Compute selected IDs from cellValue
  const selectedIdSet = useMemo(() => {
    if (!cellValue) return new Set<string>();
    const values = Array.isArray(cellValue) ? cellValue : [cellValue];
    return new Set(values.map((value) => value.id));
  }, [cellValue]);

  // Sync selectedRecordsRef with cellValue changes
  useEffect(() => {
    const newMap = new Map<string, string | undefined>();
    if (cellValue) {
      const values = Array.isArray(cellValue) ? cellValue : [cellValue];
      values.forEach((v) => newMap.set(v.id, v.title));
    }
    selectedRecordsRef.current = newMap;
  }, [cellValue]);

  const setRowSelection = useCallback((rowIndexes: number[]) => {
    if (!gridRef.current) return;
    if (!rowIndexes.length) {
      gridRef.current.setSelection(emptySelection);
      return;
    }
    const sortedIndexes = [...rowIndexes].sort((a, b) => a - b);
    const ranges: [number, number][] = [];
    let rangeStart = sortedIndexes[0];
    let prev = sortedIndexes[0];
    for (let i = 1; i < sortedIndexes.length; i++) {
      const cur = sortedIndexes[i];
      if (cur === prev + 1) {
        prev = cur;
        continue;
      }
      ranges.push([rangeStart, prev]);
      rangeStart = cur;
      prev = cur;
    }
    ranges.push([rangeStart, prev]);
    gridRef.current.setSelection(new CombinedSelection(SelectionRegionType.Rows, ranges));
  }, []);

  // Sync UI selection with selectedIdSet (for highlighting)
  useEffect(() => {
    if (isSelectedType) {
      if (!rowCount) return;
      gridRef.current?.setSelection(
        new CombinedSelection(SelectionRegionType.Rows, [[0, rowCount - 1]])
      );
      return;
    }
    if (!isAllType) {
      gridRef.current?.setSelection(emptySelection);
      return;
    }
    const rowIndexes: number[] = [];
    Object.entries(recordMap).forEach(([rowIndex, record]) => {
      if (record && selectedIdSet.has(record.id)) {
        rowIndexes.push(Number(rowIndex));
      }
    });
    setRowSelection(rowIndexes);
  }, [isSelectedType, isAllType, rowCount, recordMap, selectedIdSet, setRowSelection]);

  const onItemHovered = (type: RegionType, bounds: IRectangle, cellItem: ICellItem) => {
    const [columnIndex] = cellItem;
    const { description } = columns[columnIndex] ?? {};

    closeTooltip();

    if (type === RegionType.ColumnDescription && description) {
      openTooltip({
        id: componentId,
        text: description,
        position: bounds,
      });
    }

    if (type === RegionType.ColumnPrimaryIcon) {
      openTooltip({
        id: componentId,
        text: t('hidden.primaryKey'),
        position: bounds,
      });
    }
  };

  const getCellContent = useCallback<(cell: ICellItem) => ICell>(
    (cell) => {
      const [colIndex, rowIndex] = cell;
      const record = recordMap[rowIndex];
      if (record !== undefined) {
        const fieldId = columns[colIndex]?.id;
        if (!fieldId) return { type: CellType.Loading };
        return cellValue2GridDisplay(record, colIndex);
      }
      return { type: CellType.Loading };
    },
    [recordMap, columns, cellValue2GridDisplay]
  );

  const emitChange = useCallback(() => {
    const entries = Array.from(selectedRecordsRef.current.entries());
    if (entries.length === 0) {
      onChange?.(undefined);
    } else if (!isMultiple) {
      const [id, title] = entries[0];
      onChange?.([{ id, title }]);
    } else {
      onChange?.(entries.map(([id, title]) => ({ id, title })));
    }
  }, [isMultiple, onChange]);

  const onRowControlClick = useCallback(
    (rowIndex: number, controlType: RowControlType, checked: boolean) => {
      if (controlType !== RowControlType.Checkbox) return;

      const record = recordMap[rowIndex];
      if (!record) return;

      if (checked) {
        if (!isMultiple) {
          selectedRecordsRef.current.clear();
          selectedRecordsRef.current.set(record.id, record.name);
          setRowSelection([rowIndex]);
          emitChange();
          return;
        }
        if (selectedRecordsRef.current.size >= MAX_SELECT_COUNT) {
          toast.warning(t('editor.link.selectTooManyRecords', { maxCount: MAX_SELECT_COUNT }));
          return;
        }
        selectedRecordsRef.current.set(record.id, record.name);
      } else {
        selectedRecordsRef.current.delete(record.id);
        if (!isMultiple) {
          setRowSelection([]);
        }
      }

      emitChange();
    },
    [recordMap, isMultiple, emitChange, setRowSelection, t]
  );

  const onRowRangeSelected = useCallback(
    async (ranges: IRange[]) => {
      if (!tableId) return;
      if (!isMultiple) return;

      const totalRows = ranges.reduce((acc, range) => acc + range[1] - range[0] + 1, 0);

      if (selectedRecordsRef.current.size + totalRows > MAX_SELECT_COUNT) {
        toast.warning(t('editor.link.selectTooManyRecords', { maxCount: MAX_SELECT_COUNT }));
        return;
      }

      try {
        const { data } = await getIdsFromRanges(tableId, {
          ranges,
          type: RangeType.Rows,
          returnType: IdReturnType.RecordId,
          viewId: viewId ?? undefined,
        });

        if (data.recordIds) {
          const idToTitleMap = new Map<string, string | undefined>();
          Object.values(recordMap).forEach((record) => {
            if (record) {
              idToTitleMap.set(record.id, record.name);
            }
          });
          data.recordIds.forEach((id) => {
            selectedRecordsRef.current.set(id, idToTitleMap.get(id));
          });
          emitChange();
        }
      } catch {
        // Reset UI selection to match actual selected records
        const rowIndexes: number[] = [];
        Object.entries(recordMap).forEach(([rowIndex, record]) => {
          if (record && selectedRecordsRef.current.has(record.id)) {
            rowIndexes.push(Number(rowIndex));
          }
        });
        setRowSelection(rowIndexes);
        toast.error(t('editor.link.rangeSelectFailed'));
      }
    },
    [tableId, viewId, recordMap, emitChange, setRowSelection, t, isMultiple]
  );

  const onExpandInner = (rowIndex: number) => {
    const record = recordMap[rowIndex];
    if (record == null) return;
    onExpand?.(record.id);
  };

  const onColumnResize = useCallback((column: IGridColumn, newSize: number) => {
    const columnId = column.id;
    if (!columnId) return;
    setColumnWidths((prev) => {
      const next = new Map(prev);
      next.set(columnId, newSize);
      return next;
    });
  }, []);

  return (
    <>
      {shouldShowSkeleton && (
        <div className="absolute inset-0 z-10 space-y-2 bg-background p-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      )}
      {shouldRenderGrid && (
        <>
          <Grid
            ref={gridRef}
            style={{
              width: '100%',
              height: '100%',
            }}
            scrollBufferX={0}
            scrollBufferY={0}
            theme={theme}
            columns={columns}
            freezeColumnCount={0}
            rowCount={isSelectedType && !cellValue ? 0 : rowCount ?? 0}
            rowIndexVisible={false}
            customIcons={customIcons}
            rowControls={rowControls}
            draggable={DraggableType.None}
            selectable={readonly ? SelectableType.None : SelectableType.Row}
            isMultiSelectionEnable={isMultiple}
            onItemHovered={onItemHovered}
            getCellContent={getCellContent}
            onVisibleRegionChanged={onVisibleRegionChanged}
            onRowExpand={isExpandEnable ? onExpandInner : undefined}
            onColumnResize={onColumnResize}
            onRowControlClick={onRowControlClick}
            onRowRangeSelected={onRowRangeSelected}
          />
          <GridTooltip id={componentId} />
        </>
      )}
    </>
  );
};

export const LinkList = forwardRef(LinkListBase);
