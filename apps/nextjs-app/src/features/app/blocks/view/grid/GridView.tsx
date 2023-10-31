import type { GridViewOptions, RatingIcon } from '@teable-group/core';
import { RowHeightLevel } from '@teable-group/core';
import { DraggableHandle, Maximize2, Check } from '@teable-group/icons';
import {
  RATING_ICON_MAP,
  useFields,
  useFieldStaticGetter,
  useIsTouchDevice,
  useRowCount,
  useSSRRecords,
  useTable,
  useTableId,
  useView,
  useViewId,
} from '@teable-group/sdk';
import { Skeleton } from '@teable-group/ui-lib/shadcn';
import { isEqual, keyBy } from 'lodash';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrevious, useMount } from 'react-use';
import type { IExpandRecordContainerRef } from '@/features/app/components/ExpandRecordContainer';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { FIELD_TYPE_ORDER } from '@/features/app/utils/fieldTypeOrder';
import {
  Grid,
  CellType,
  RowControlType,
  SelectionRegionType,
  RegionType,
  DraggableType,
} from '../../grid';
import type { IRectangle, IPosition, IGridRef, ICellItem } from '../../grid';
import { CombinedSelection } from '../../grid/managers';
import { GIRD_ROW_HEIGHT_DEFINITIONS } from './const';
import { DomBox } from './DomBox';
import {
  useAsyncData,
  useColumnOrder,
  useColumnResize,
  useColumnStatistics,
  useColumns,
  useGridTheme,
} from './hooks';
import { useSelectionOperation } from './hooks/useSelectionOperation';
import { useGridViewStore } from './store/gridView';
import { getSpriteMap } from './utils';

interface IGridViewProps {
  expandRecordRef: React.RefObject<IExpandRecordContainerRef>;
}

export const GridView: React.FC<IGridViewProps> = (props) => {
  const { expandRecordRef } = props;
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const tableId = useTableId() as string;
  const table = useTable();
  const activeViewId = useViewId();
  const view = useView(activeViewId);
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const theme = useGridTheme();
  const fields = useFields();
  const { columns: originalColumns, cellValue2GridDisplay } = useColumns();
  const { columns, onColumnResize } = useColumnResize(originalColumns);
  const { columnStatistics } = useColumnStatistics(columns);
  const { onColumnOrdered } = useColumnOrder();
  const {
    openRecordMenu,
    openHeaderMenu,
    openSetting,
    openStatisticMenu,
    setSelection,
    openTooltip,
    closeTooltip,
  } = useGridViewStore();
  const preTableId = usePrevious(tableId);
  const [isReadyToRender, setReadyToRender] = useState(false);
  const { copy, paste, clear } = useSelectionOperation();
  const isAutoSort = view?.sort?.shouldAutoSort;
  const isTouchDevice = useIsTouchDevice();
  const isLoading = !view;

  const { getCellContent, onVisibleRegionChanged, onCellEdited, onRowOrdered, reset, recordMap } =
    useAsyncData(
      useCallback(
        (record, col) => {
          const fieldId = columns[col]?.id;
          if (!fieldId) {
            return {
              type: CellType.Loading,
            };
          }
          return cellValue2GridDisplay(record, col);
        },
        [cellValue2GridDisplay, columns]
      ),
      useCallback(
        (cell, newVal, record) => {
          const [col] = cell;
          const fieldId = columns[col].id;
          const { type, data } = newVal;
          let newCellValue = null;

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
        [columns]
      ),
      ssrRecords
    );

  useEffect(() => {
    if (preTableId && preTableId !== tableId) {
      reset();
    }
  }, [reset, tableId, preTableId]);

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

  const getFieldStatic = useFieldStaticGetter();
  const customIcons = useMemo(() => {
    const columnHeaderIcons = getSpriteMap(
      FIELD_TYPE_ORDER.reduce<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: string; IconComponent: React.JSXElementConstructor<any> }[]
      >((pre, type) => {
        const IconComponent = getFieldStatic(type, false)?.Icon;
        const LookupIconComponent = getFieldStatic(type, true)?.Icon;
        pre.push({ type: type, IconComponent });
        if (LookupIconComponent) {
          pre.push({ type: `${type}_lookup`, IconComponent: LookupIconComponent });
        }
        return pre;
      }, [])
    );
    const rowHeaderIcons = getSpriteMap([
      {
        type: RowControlType.Drag,
        IconComponent: DraggableHandle,
      },
      {
        type: RowControlType.Expand,
        IconComponent: Maximize2,
      },
      {
        type: RowControlType.Checkbox,
        IconComponent: Check,
      },
    ]);
    const ratingIcons = getSpriteMap(
      (Object.keys(RATING_ICON_MAP) as RatingIcon[]).map((iconKey) => ({
        type: iconKey,
        IconComponent: RATING_ICON_MAP[iconKey],
      }))
    );
    return {
      ...columnHeaderIcons,
      ...rowHeaderIcons,
      ...ratingIcons,
    };
  }, [getFieldStatic]);

  const rowHeightLevel = useMemo(() => {
    if (view == null) return RowHeightLevel.Short;
    return (view.options as GridViewOptions)?.rowHeight || RowHeightLevel.Short;
  }, [view]);

  const rowControls = useMemo(() => {
    if (isTouchDevice) return [];
    return [
      {
        type: RowControlType.Drag,
        icon: RowControlType.Drag,
      },
      {
        type: RowControlType.Checkbox,
        icon: RowControlType.Checkbox,
      },
      {
        type: RowControlType.Expand,
        icon: RowControlType.Expand,
      },
    ];
  }, [isTouchDevice]);

  const gridRef = useRef<IGridRef>(null);

  const onDelete = (selection: CombinedSelection) => {
    clear(selection);
  };

  const onCopy = async (selection: CombinedSelection) => {
    copy(selection);
  };
  const onPaste = (selection: CombinedSelection) => {
    paste(selection);
  };

  const onSelectionChanged = useCallback(
    (selection: CombinedSelection) => {
      setSelection(selection);
    },
    [setSelection]
  );

  const onRowExpand = (rowIndex: number) => {
    const { baseId, nodeId, viewId } = router.query;
    const recordId = recordMap[rowIndex]?.id;
    if (!recordId) {
      return;
    }
    router.push(
      {
        pathname: '/base/[baseId]/[nodeId]/[viewId]/[recordId]',
        query: { baseId, nodeId, viewId, recordId },
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

  const onItemHovered = (type: RegionType, bounds: IRectangle, cellItem: ICellItem) => {
    const [columnIndex] = cellItem;
    const { description } = columns[columnIndex] ?? {};

    closeTooltip();

    if (type === RegionType.ColumnDescription && description) {
      openTooltip({
        text: description,
        position: bounds,
      });
    }

    if (type === RegionType.RowHeaderDragHandler) {
      openTooltip({
        text: 'Automatic sorting is turned on, manual sorting is not available',
        position: bounds,
      });
    }
  };

  const draggable = useMemo(() => {
    if (isAutoSort) return DraggableType.Column;
    return DraggableType.All;
  }, [isAutoSort]);

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
          customIcons={customIcons}
          rowControls={rowControls}
          style={{
            width: '100%',
            height: '100%',
          }}
          getCellContent={getCellContent}
          onDelete={onDelete}
          onRowAppend={onRowAppended}
          onCellEdited={onCellEdited}
          onRowOrdered={onRowOrdered}
          onColumnAppend={onColumnAppend}
          onColumnResize={onColumnResize}
          onColumnOrdered={onColumnOrdered}
          onContextMenu={onContextMenu}
          onColumnHeaderClick={onColumnHeaderClick}
          onColumnStatisticClick={onColumnStatisticClick}
          onVisibleRegionChanged={onVisibleRegionChanged}
          onSelectionChanged={onSelectionChanged}
          onColumnHeaderDblClick={onColumnHeaderDblClick}
          onColumnHeaderMenuClick={onColumnHeaderMenuClick}
          onCopy={onCopy}
          onPaste={onPaste}
          onRowExpand={onRowExpand}
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
      <DomBox />
    </div>
  );
};
