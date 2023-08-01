import type { GridViewOptions } from '@teable-group/core';
import { RowHeightLevel } from '@teable-group/core';
import { DraggableHandle, Maximize2, Check } from '@teable-group/icons';
import type { Record } from '@teable-group/sdk';
import {
  useFieldStaticGetter,
  useRowCount,
  useSSRRecords,
  useTable,
  useTableId,
  useView,
  useViewId,
} from '@teable-group/sdk';
import { isEqual } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrevious, useMount, useUpdateEffect } from 'react-use';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { FIELD_TYPE_ORDER } from '@/features/app/utils/fieldTypeOrder';
import { Grid, CellType, RowControlType } from '../../grid';
import type { IRectangle, IPosition, IGridColumn, IGridRef } from '../../grid';
import type { CombinedSelection } from '../../grid/managers';
import { GIRD_ROW_HEIGHT_DEFINITIONS } from './const';
import { DomBox } from './DomBox';
import { useAsyncData, useColumnOrder, useColumnResize, useColumns, useGridTheme } from './hooks';
import { useSelectionOperation } from './hooks/useSelectionOperation';
import { useGridViewStore } from './store/gridView';
import { getSpriteMap } from './utils';

export const GridView: React.FC = () => {
  const container = useRef<HTMLDivElement>(null);
  const tableId = useTableId() as string;
  const table = useTable();
  const activeViewId = useViewId();
  const view = useView(activeViewId);
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const theme = useGridTheme();
  const { columns: originalColumns, cellValue2GridDisplay } = useColumns();
  const { columns, onColumnResize } = useColumnResize(originalColumns);
  const { onColumnOrdered } = useColumnOrder();
  const gridViewStore = useGridViewStore();
  const preTableId = usePrevious(tableId);
  const [isReadyToRender, setReadyToRender] = useState(false);
  const { copy, paste, clear } = useSelectionOperation();

  const { getCellContent, onVisibleRegionChanged, onCellEdited, onRowOrdered, reset, records } =
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

  useMount(() => setReadyToRender(true));

  const onContextMenu = useCallback(
    (selection: CombinedSelection, position: IPosition) => {
      const { isCellSelection, isRowSelection, isColumnSelection, ranges } = selection;

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

  const onColumnHeaderDblClick = useCallback(
    (colIndex: number) => {
      const fieldId = columns[colIndex].id;
      gridViewStore.openSetting({ fieldId, operator: FieldOperator.Edit });
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
  const customIcons = useMemo(() => {
    const columnHeaderIcons = getSpriteMap(
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
    return {
      ...columnHeaderIcons,
      ...rowHeaderIcons,
    };
  }, [getFieldStatic]);

  const rowHeightLevel = useMemo(() => {
    if (view == null) return RowHeightLevel.Short;
    return (view.options as GridViewOptions)?.rowHeight || RowHeightLevel.Short;
  }, [view]);

  const rowControls = useMemo(() => {
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
  }, []);

  const gridRef = useRef<IGridRef>(null);

  useUpdateEffect(() => {
    gridRef.current?.forceUpdate();
  }, [view?.filter]);

  const onDelete = (selection: CombinedSelection) => {
    clear(selection);
  };

  const onCopy = async (selection: CombinedSelection) => {
    copy(selection);
  };
  const onPaste = (selection: CombinedSelection) => {
    // CopyAndPasteApi.paste(tableId, activeViewId);
    paste(selection);
  };

  return (
    <div ref={container} className="relative grow w-full overflow-hidden">
      {isReadyToRender && (
        <Grid
          ref={gridRef}
          theme={theme}
          rowCount={rowCount}
          rowHeight={GIRD_ROW_HEIGHT_DEFINITIONS[rowHeightLevel]}
          freezeColumnCount={1}
          columns={columns}
          smoothScrollX
          smoothScrollY
          customIcons={customIcons}
          rowControls={rowControls}
          style={{
            marginLeft: 8,
            width: 'calc(100% - 8px)',
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
          onVisibleRegionChanged={onVisibleRegionChanged}
          onColumnHeaderDblClick={onColumnHeaderDblClick}
          onColumnHeaderMenuClick={onColumnHeaderMenuClick}
          onCopy={onCopy}
          onPaste={onPaste}
        />
      )}
      <DomBox />
    </div>
  );
};
