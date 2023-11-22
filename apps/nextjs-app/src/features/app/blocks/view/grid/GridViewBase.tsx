import type { GridViewOptions, PermissionAction } from '@teable-group/core';
import { RowHeightLevel } from '@teable-group/core';
import type {
  IRectangle,
  IPosition,
  IGridRef,
  ICellItem,
  ICell,
  IInnerCell,
} from '@teable-group/sdk';
import {
  Grid,
  CellType,
  RowControlType,
  SelectionRegionType,
  RegionType,
  DraggableType,
  CombinedSelection,
  useGridTheme,
  useGridColumnResize,
  useGridColumns,
  useGridColumnStatistics,
  useGridColumnOrder,
  useGridAsyncRecords,
  useGridIcons,
  useGridTooltipStore,
  hexToRGBA,
} from '@teable-group/sdk';
import {
  useFields,
  useIsTouchDevice,
  useRowCount,
  useSSRRecord,
  useSSRRecords,
  useTable,
  useTableId,
  useTablePermission,
  useView,
  useViewId,
} from '@teable-group/sdk/hooks';
import { Skeleton, useToast } from '@teable-group/ui-lib';
import { isEqual, keyBy, uniqueId, groupBy } from 'lodash';
import { useRouter } from 'next/router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrevious, useMount, useClickAway } from 'react-use';
import { ExpandRecordContainer } from '@/features/app/components/ExpandRecordContainer';
import type { IExpandRecordContainerRef } from '@/features/app/components/ExpandRecordContainer/types';
import { FieldOperator } from '../../../components/field-setting';
import { GIRD_ROW_HEIGHT_DEFINITIONS } from './const';
import { DomBox } from './DomBox';
import { useCollaborate, useSelectionOperation } from './hooks';
import { useGridViewStore } from './store/gridView';

interface IGridViewProps {
  onRowExpand?: (recordId: string) => void;
}

export const GridViewBase: React.FC<IGridViewProps> = (props: IGridViewProps) => {
  const { onRowExpand } = props;
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const expandRecordRef = useRef<IExpandRecordContainerRef>(null);
  const tableId = useTableId() as string;
  const table = useTable();
  const activeViewId = useViewId();
  const view = useView(activeViewId);
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const ssrRecord = useSSRRecord();
  const theme = useGridTheme();
  const fields = useFields();
  const { columns: originalColumns, cellValue2GridDisplay } = useGridColumns();
  const { columns, onColumnResize } = useGridColumnResize(originalColumns);
  const { columnStatistics } = useGridColumnStatistics(columns);
  const { onColumnOrdered } = useGridColumnOrder();
  const {
    selection,
    openRecordMenu,
    openHeaderMenu,
    openSetting,
    openStatisticMenu,
    setSelection,
  } = useGridViewStore();
  const { openTooltip, closeTooltip } = useGridTooltipStore();
  const preTableId = usePrevious(tableId);
  const [isReadyToRender, setReadyToRender] = useState(false);
  const { copy, paste, clear } = useSelectionOperation();
  const isManualSort = view?.sort?.manualSort;
  const isTouchDevice = useIsTouchDevice();
  const isLoading = !view;
  const permission = useTablePermission();
  const { toast } = useToast();

  const { onVisibleRegionChanged, onRowOrdered, onReset, recordMap } =
    useGridAsyncRecords(ssrRecords);

  useEffect(() => {
    if (preTableId && preTableId !== tableId) {
      onReset();
    }
  }, [onReset, tableId, preTableId]);

  useEffect(() => {
    const recordIds = Object.keys(recordMap)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => recordMap[key]?.id)
      .filter(Boolean);
    expandRecordRef.current?.updateRecordIds?.(recordIds);
  }, [expandRecordRef, recordMap]);

  // The recordId on the route changes, and the activeCell needs to change with it
  useEffect(() => {
    const recordId = router.query.recordId as string;
    if (recordId && isReadyToRender) {
      const recordIndex = Number(
        Object.keys(recordMap).find((key) => recordMap[key]?.id === recordId)
      );

      recordIndex > 0 &&
        gridRef.current?.setSelection(
          new CombinedSelection(SelectionRegionType.Cells, [
            [0, recordIndex],
            [0, recordIndex],
          ])
        );
    }
  }, [router.query.recordId, recordMap, isReadyToRender]);

  useMount(() => setReadyToRender(true));

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

  const onCellEdited = useCallback(
    (cell: ICellItem, newVal: IInnerCell) => {
      const [, row] = cell;
      const record = recordMap[row];
      if (record === undefined) return;

      const [col] = cell;
      const fieldId = columns[col].id;
      const { type, data } = newVal;
      let newCellValue: unknown = null;

      switch (type) {
        case CellType.Select:
          newCellValue = data?.length ? data : null;
          break;
        case CellType.Text:
        case CellType.Number:
        case CellType.Boolean:
        default:
          newCellValue = data === '' ? null : data;
      }
      const oldCellValue = record.getCellValue(fieldId) ?? null;
      if (isEqual(newCellValue, oldCellValue)) return;
      record.updateCell(fieldId, newCellValue);
      return record;
    },
    [recordMap, columns]
  );

  const onContextMenu = useCallback(
    (selection: CombinedSelection, position: IPosition) => {
      const { isCellSelection, isRowSelection, isColumnSelection, ranges } = selection;

      function extract<T>(start: number, end: number, source: T[] | { [key: number]: T }): T[] {
        return Array.from({ length: end - start + 1 })
          .map((_, index) => {
            return source[start + index];
          })
          .filter(Boolean);
      }

      if (isCellSelection || isRowSelection) {
        const rowStart = isCellSelection ? ranges[0][1] : ranges[0][0];
        const rowEnd = isCellSelection ? ranges[1][1] : ranges[0][1];
        const colStart = isCellSelection ? ranges[0][0] : 0;
        const colEnd = isCellSelection ? ranges[1][0] : columns.length - 1;
        const records = extract(rowStart, rowEnd, recordMap);
        const selectColumns = extract(colStart, colEnd, columns);
        const indexedColumns = keyBy(selectColumns, 'id');
        const selectFields = fields.filter((field) => indexedColumns[field.id]);
        openRecordMenu({ position, records, fields: selectFields });
      }
      if (isColumnSelection) {
        const [start, end] = ranges[0];
        const selectColumns = extract(start, end, columns);
        const indexedColumns = keyBy(selectColumns, 'id');
        const selectFields = fields.filter((field) => indexedColumns[field.id]);
        openHeaderMenu({ position, fields: selectFields });
      }
    },
    [columns, recordMap, fields, openRecordMenu, openHeaderMenu]
  );

  const onColumnHeaderMenuClick = useCallback(
    (colIndex: number, bounds: IRectangle) => {
      const fieldId = columns[colIndex].id;
      const { x, height } = bounds;
      const selectedFields = fields.filter((field) => field.id === fieldId);
      openHeaderMenu({ fields: selectedFields, position: { x, y: height } });
    },
    [columns, fields, openHeaderMenu]
  );

  const onColumnHeaderDblClick = useCallback(
    (colIndex: number) => {
      const fieldId = columns[colIndex].id;
      openSetting({ fieldId, operator: FieldOperator.Edit });
    },
    [columns, openSetting]
  );

  const onColumnHeaderClick = useCallback(
    (colIndex: number, bounds: IRectangle) => {
      if (!isTouchDevice) return;
      const fieldId = columns[colIndex].id;
      const { x, height } = bounds;
      const selectedFields = fields.filter((field) => field.id === fieldId);
      openHeaderMenu({ fields: selectedFields, position: { x, y: height } });
    },
    [isTouchDevice, columns, fields, openHeaderMenu]
  );

  const onColumnStatisticClick = useCallback(
    (colIndex: number, bounds: IRectangle) => {
      const { x, y, width, height } = bounds;
      const fieldId = columns[colIndex].id;
      openStatisticMenu({ fieldId, position: { x, y, width, height } });
    },
    [columns, openStatisticMenu]
  );

  const onRowAppended = () => {
    table?.createRecord({});
  };

  const onColumnAppend = () => {
    openSetting({
      operator: FieldOperator.Add,
    });
  };

  const customIcons = useGridIcons();

  const rowHeightLevel = useMemo(() => {
    if (view == null) return RowHeightLevel.Short;
    return (view.options as GridViewOptions)?.rowHeight || RowHeightLevel.Short;
  }, [view]);

  const rowControls = useMemo(() => {
    if (isTouchDevice) return [];
    const drag = permission['view|update']
      ? [
          {
            type: RowControlType.Drag,
            icon: RowControlType.Drag,
          },
        ]
      : [];
    return [
      ...drag,
      {
        type: RowControlType.Checkbox,
        icon: RowControlType.Checkbox,
      },
      {
        type: RowControlType.Expand,
        icon: RowControlType.Expand,
      },
    ];
  }, [isTouchDevice, permission]);

  const gridRef = useRef<IGridRef>(null);

  const onDelete = (selection: CombinedSelection) => {
    clear(selection);
  };

  const onCopy = async (selection: CombinedSelection) => {
    copy(selection);
  };
  const onPaste = (selection: CombinedSelection) => {
    if (!permission['record|update']) {
      toast({ title: 'Unable to paste' });
    }
    paste(selection);
  };

  const onSelectionChanged = useCallback(
    (selection: CombinedSelection) => {
      setSelection(selection);
    },
    [setSelection]
  );

  const [collaborators] = useCollaborate(selection);

  const onRowExpandInner = (rowIndex: number) => {
    const recordId = recordMap[rowIndex]?.id;
    if (!recordId) {
      return;
    }
    if (onRowExpand) {
      onRowExpand(recordId);
      return;
    }
    router.push(
      {
        pathname: `${router.pathname}/[recordId]`,
        query: { ...router.query, recordId },
      },
      undefined,
      {
        shallow: true,
      }
    );
  };

  const onItemClick = (type: RegionType, bounds: IRectangle, cellItem: ICellItem) => {
    const [columnIndex] = cellItem;
    const { id: fieldId } = columns[columnIndex] ?? {};

    if (type === RegionType.ColumnDescription) {
      openSetting({ fieldId, operator: FieldOperator.Edit });
    }
  };

  const componentId = useMemo(() => uniqueId('grid-view-'), []);

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

    if (type === RegionType.RowHeaderDragHandler && !isManualSort) {
      openTooltip({
        id: componentId,
        text: 'Automatic sorting is turned on, manual sorting is not available',
        position: bounds,
      });
    }

    if (type === RegionType.Cell && collaborators.length) {
      const { x, y, width, height } = bounds;
      const [rowIndex, columnIndex] = cellItem;
      const groupedCollaborators = groupBy(collaborators, 'activeCell');
      const hoverCollaborators = groupedCollaborators?.[`${rowIndex},${columnIndex}`];
      const collaboratorText = hoverCollaborators?.map((cur) => cur.user.name).join('、');
      const hoverHeight = 24;

      collaboratorText &&
        openTooltip?.({
          id: componentId,
          text: collaboratorText,
          position: {
            x: x,
            y: y + 8,
            width: width,
            height: height,
          },
          contentClassName: 'items-center py-0 px-2 absolute truncate',
          contentStyle: {
            right: `-${width / 2}px`,
            top: `-${hoverHeight}px`,
            maxWidth: width - 1,
            height: `${hoverHeight}px`,
            direction: 'rtl',
            lineHeight: `${hoverHeight}px`,
            backgroundColor: hexToRGBA(hoverCollaborators?.[0].borderColor, 0.5),
          },
        });
    }
  };

  const draggable = useMemo(() => {
    if (!isManualSort) return DraggableType.Column;
    return DraggableType.All;
  }, [isManualSort]);

  const getAuthorizedFunction = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <T extends (...args: any[]) => any>(
      fn: T,
      permissionAction: PermissionAction
    ): T | undefined => {
      return permission[permissionAction] ? fn : undefined;
    },
    [permission]
  );

  useClickAway(container, () => {
    gridRef.current?.resetState();
  });

  return (
    <div ref={container} className="relative h-full w-full overflow-hidden">
      {isReadyToRender && !isLoading ? (
        <Grid
          ref={gridRef}
          theme={theme}
          draggable={draggable}
          isTouchDevice={isTouchDevice}
          rowCount={rowCount ?? ssrRecords?.length ?? 0}
          rowHeight={GIRD_ROW_HEIGHT_DEFINITIONS[rowHeightLevel]}
          columnStatistics={columnStatistics}
          freezeColumnCount={isTouchDevice ? 0 : 1}
          columns={columns}
          smoothScrollX
          smoothScrollY
          rowCounterVisible
          customIcons={customIcons}
          rowControls={rowControls}
          collaborators={collaborators}
          style={{
            width: '100%',
            height: '100%',
          }}
          getCellContent={getCellContent}
          onDelete={getAuthorizedFunction(onDelete, 'record|update')}
          onRowAppend={getAuthorizedFunction(onRowAppended, 'record|create')}
          onCellEdited={getAuthorizedFunction(onCellEdited, 'record|update')}
          onRowOrdered={onRowOrdered}
          onColumnAppend={getAuthorizedFunction(onColumnAppend, 'field|create')}
          onColumnResize={getAuthorizedFunction(onColumnResize, 'field|update')}
          onColumnOrdered={getAuthorizedFunction(onColumnOrdered, 'field|update')}
          onContextMenu={onContextMenu}
          onColumnHeaderClick={onColumnHeaderClick}
          onColumnStatisticClick={getAuthorizedFunction(onColumnStatisticClick, 'view|update')}
          onVisibleRegionChanged={onVisibleRegionChanged}
          onSelectionChanged={onSelectionChanged}
          onColumnHeaderDblClick={onColumnHeaderDblClick}
          onColumnHeaderMenuClick={onColumnHeaderMenuClick}
          onCopy={onCopy}
          onPaste={onPaste}
          onRowExpand={onRowExpandInner}
          onItemClick={onItemClick}
          onItemHovered={onItemHovered}
        />
      ) : (
        <div className="flex w-full items-center space-x-4">
          <div className="w-full space-y-3 px-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        </div>
      )}
      <DomBox id={componentId} />
      {!onRowExpand && <ExpandRecordContainer ref={expandRecordRef} recordServerData={ssrRecord} />}
    </div>
  );
};
