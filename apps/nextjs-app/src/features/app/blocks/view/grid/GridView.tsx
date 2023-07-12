import { useRowCount, useSSRRecords, useTable, useTableId } from '@teable-group/sdk';
import { range, isEqual } from 'lodash';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePrevious } from 'react-use';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { useFieldStaticGetter } from '@/features/app/utils';
import { FIELD_TYPE_ORDER } from '@/features/app/utils/fieldTypeOrder';
import type { IRectangle, ISelectionState } from '../../grid';
import { SelectionRegionType, Grid } from '../../grid';
import type { IInnerCell } from '../../grid/renderers';
import { CellType } from '../../grid/renderers';
import { DomBox } from './DomBox';
import { useAsyncData, useColumnOrder, useColumnResize, useColumns } from './hooks';
import { useGridViewStore } from './store/gridView';
import { calculateMenuPosition, getHeaderIcons } from './utils';

export const GridView: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);
  const tableId = useTableId() as string;
  const table = useTable();
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const { columns: originalColumns, cellValue2GridDisplay } = useColumns();
  const { columns, onColumnResize } = useColumnResize(originalColumns);
  const { onColumnOrdered } = useColumnOrder();
  const gridViewStore = useGridViewStore();

  const { getCellContent, onCellEdited, reset } = useAsyncData(
    useCallback(
      (record, col) => {
        const fieldId = columns[col]?.id;
        if (!fieldId) {
          return {
            type: CellType.Text,
            data: '',
            displayData: '',
          };
        }
        const cellValue = record.getCellValue(fieldId);
        return cellValue2GridDisplay(cellValue, col);
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
            newCellValue = data.value;
            break;
          case CellType.Text:
          case CellType.Number:
          default:
            newCellValue = data === '' ? null : data;
        }
        console.log('newCellValue', newCellValue);
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

  const preTableId = usePrevious(tableId);
  useEffect(() => {
    if (preTableId && preTableId !== tableId) {
      reset();
    }
  }, [reset, tableId, preTableId]);

  const onHeaderMenuClick = useCallback(
    (col: number, bounds: IRectangle) => {
      const pos = calculateMenuPosition(container, { col, bounds });
      gridViewStore.openHeaderMenu({ pos, fieldId: columns[col].id });
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
      case SelectionRegionType.Row:
      case SelectionRegionType.Column:
        return null;
    }
  };

  return (
    <div ref={container} className="relative grow w-full overflow-hidden">
      <Grid
        rowCount={rowCount}
        freezeColumnCount={0}
        columns={columns}
        smoothScrollX
        smoothScrollY
        headerIcons={headerIcons}
        // rowControls={[]}
        style={{ marginLeft: -1, marginTop: -1 }}
        getCellContent={getCellContent}
        onDelete={onDelete}
        onRowAppend={onRowAppended}
        // onCellActivated={onCellActivated}
        onCellEdited={onCellEdited}
        onColumnAppend={onColumnAppend}
        onColumnResize={onColumnResize}
        onColumnOrdered={onColumnOrdered}
        onColumnHeaderMenuClick={onHeaderMenuClick}
      />
      <DomBox />
    </div>
  );
};
