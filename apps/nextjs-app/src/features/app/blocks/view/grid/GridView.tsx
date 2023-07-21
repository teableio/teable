import type { Record } from '@teable-group/sdk';
import { useRowCount, useSSRRecords, useTable, useTableId } from '@teable-group/sdk';
import { range, isEqual } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrevious, useMount } from 'react-use';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { useFieldStaticGetter } from '@/features/app/utils';
import { FIELD_TYPE_ORDER } from '@/features/app/utils/fieldTypeOrder';
import { SelectionRegionType, Grid, CellType, RowControlType } from '../../grid';
import type {
  IRectangle,
  ISelectionState,
  IInnerCell,
  IPosition,
  ISelectionBase,
  IGridColumn,
} from '../../grid';
import { DomBox } from './DomBox';
import { useAsyncData, useColumnOrder, useColumnResize, useColumns, useGridTheme } from './hooks';
import { useGridViewStore } from './store/gridView';
import { getHeaderIcons } from './utils';

export const GridView: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);
  const tableId = useTableId() as string;
  const table = useTable();
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const theme = useGridTheme();
  const { columns: originalColumns, cellValue2GridDisplay } = useColumns();
  const { columns, onColumnResize } = useColumnResize(originalColumns);
  const { onColumnOrdered } = useColumnOrder();
  const gridViewStore = useGridViewStore();
  const preTableId = usePrevious(tableId);
  const [isReadyToRender, setReadyToRender] = useState(false);

  const { getCellContent, onVisibleRegionChanged, onCellEdited, reset, records } = useAsyncData(
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
    useMemo(() => {
      return ssrRecords?.map((record) => {
        return { record };
      });
    }, [ssrRecords])
  );

  useEffect(() => {
    if (preTableId && preTableId !== tableId) {
      reset();
    }
  }, [reset, tableId, preTableId]);

  useMount(() => setReadyToRender(true));

  const onContextMenu = useCallback(
    (selection: ISelectionBase, position: IPosition) => {
      const { type, ranges } = selection;
      const isRowSelection = type === SelectionRegionType.Rows;
      const isCellSelection = type === SelectionRegionType.Cells;
      const isColumnSelection = type === SelectionRegionType.Columns;

      const extractIds = (start: number, end: number, source: (Record | IGridColumn)[]) => {
        return Array.from({ length: end - start + 1 })
          .map((_, index) => {
            const item = source[start + index];
            return item?.id;
          })
          .filter(Boolean) as string[];
      };

      if (isCellSelection || isRowSelection) {
        const start = isCellSelection ? ranges[0][1] : ranges[0][0];
        const end = isCellSelection ? ranges[1][1] : ranges[0][1];
        const recordIds = extractIds(start, end, records);
        gridViewStore.openRecordMenu({ position, recordIds });
      }
      if (isColumnSelection) {
        const [start, end] = ranges[0];
        const fieldIds = extractIds(start, end, columns);
        gridViewStore.openHeaderMenu({ position, fieldIds });
      }
    },
    [gridViewStore, records, columns]
  );

  const onColumnHeaderMenuClick = useCallback(
    (colIndex: number, bounds: IRectangle) => {
      const fieldId = columns[colIndex].id;
      const { x, height } = bounds;
      gridViewStore.openHeaderMenu({ fieldIds: [fieldId], position: { x, y: height } });
    },
    [columns, gridViewStore]
  );

  const onRowAppended = () => {
    table?.createRecord({});
  };

  const onColumnAppend = () => {
    gridViewStore.openSetting({
      operator: FieldOperator.Add,
    });
  };

  const getFieldStatic = useFieldStaticGetter();
  const headerIcons = useMemo(
    () =>
      getHeaderIcons(
        FIELD_TYPE_ORDER.reduce<
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { type: string; IconComponent: React.JSXElementConstructor<any> }[]
        >((pre, type) => {
          const IconComponent = getFieldStatic(type, false)?.Icon;
          const LookupIconComponent = getFieldStatic(type, true)?.Icon;
          if (IconComponent) {
            pre.push({ type: type, IconComponent });
          }
          if (LookupIconComponent) {
            pre.push({ type: `${type}_lookup`, IconComponent: LookupIconComponent });
          }
          return pre;
        }, [])
      ),
    [getFieldStatic]
  );

  const onDelete = (selection: ISelectionState) => {
    const { type, ranges } = selection;

    switch (type) {
      case SelectionRegionType.Cells: {
        const [startRange, endRange] = ranges;
        const minColIndex = Math.min(startRange[0], endRange[0]);
        const maxColIndex = Math.max(startRange[0], endRange[0]);
        const minRowIndex = Math.min(startRange[1], endRange[1]);
        const maxRowIndex = Math.max(startRange[1], endRange[1]);
        range(minColIndex, maxColIndex + 1).forEach((colIndex) => {
          range(minRowIndex, maxRowIndex + 1).forEach((rowIndex) => {
            onCellEdited([colIndex, rowIndex], {
              ...getCellContent([colIndex, rowIndex]),
              data: null,
            } as IInnerCell);
          });
        });
        break;
      }
      case SelectionRegionType.Rows:
      case SelectionRegionType.Columns:
        return null;
    }
  };

  return (
    <div ref={container} className="relative grow w-full overflow-hidden">
      {isReadyToRender && (
        <Grid
          theme={theme}
          rowCount={rowCount}
          freezeColumnCount={0}
          columns={columns}
          smoothScrollX
          smoothScrollY
          headerIcons={headerIcons}
          rowControls={[RowControlType.Drag, RowControlType.Checkbox, RowControlType.Expand]}
          style={{ marginLeft: -1, marginTop: -1 }}
          getCellContent={getCellContent}
          onDelete={onDelete}
          onRowAppend={onRowAppended}
          onCellEdited={onCellEdited}
          onColumnAppend={onColumnAppend}
          onColumnResize={onColumnResize}
          onColumnOrdered={onColumnOrdered}
          onContextMenu={onContextMenu}
          onVisibleRegionChanged={onVisibleRegionChanged}
          onColumnHeaderMenuClick={onColumnHeaderMenuClick}
        />
      )}
      <DomBox />
    </div>
  );
};
