import DataEditor, { GridCellKind, useCustomCells } from '@glideapps/glide-data-grid';
import type { DataEditorRef, Rectangle, Item } from '@glideapps/glide-data-grid';
import { useConnection, useRowCount, useSSRRecords, useTable, useTableId } from '@teable-group/sdk';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePrevious } from 'react-use';
import '@glideapps/glide-data-grid/dist/index.css';
import { useViewStore } from '../store/view';
import { AddField, BaseCell } from './components';
import { DomBox } from './DomBox';
import { useAsyncData, useColumnResize, useColumns, useGridTheme } from './hooks';
import { useGridViewStore } from './store/gridView';
import { calculateCellPosition, calculateMenuPosition, getHeaderIcons } from './utils';

const headerIcons = getHeaderIcons();

export const GridView: React.FC = () => {
  const ref = useRef<DataEditorRef | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const { connected } = useConnection();
  const tableId = useTableId() as string;
  const table = useTable();
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const { columns: originalColumns, cellValue2GridDisplay } = useColumns();
  const theme = useGridTheme();
  const { columns, onColumnResize } = useColumnResize(originalColumns);
  const customRendererArgs = useCustomCells([BaseCell]);
  const gridViewStore = useGridViewStore();
  const viewStore = useViewStore();

  const { getCellContent, onVisibleRegionChanged, onCellEdited, reset, records } = useAsyncData(
    useCallback(
      (rowData, col) => {
        const fieldId = columns[col]?.id;
        if (!fieldId) {
          return {
            kind: GridCellKind.Loading,
            allowOverlay: false,
          };
        }
        const cellValue = rowData.getCellValue(fieldId);
        return cellValue2GridDisplay(cellValue, col);
      },
      [cellValue2GridDisplay, columns]
    ),
    useCallback(
      (cell, newVal, rowData) => {
        const [col] = cell;
        const fieldId = columns[col].id;
        if (newVal.kind === GridCellKind.Custom) {
          return;
        }
        const newCellValue = newVal.data === '' ? null : newVal.data;
        const oldCellValue = rowData.getCellValue(fieldId) ?? null;
        if (newCellValue == oldCellValue) {
          return;
        }
        console.log('endEdit', newVal.data);
        rowData.updateCell(fieldId, newCellValue);
        return rowData;
      },
      [columns]
    ),
    ref,
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
    (col: number, bounds: Rectangle) => {
      const pos = calculateMenuPosition(container, ref, { col, bounds });
      gridViewStore.openHeaderMenu({ pos, fieldId: columns[col].id });
    },
    [columns, gridViewStore]
  );

  const onRowAppended = () => {
    table?.createRecord({});
  };

  const onCellActivated = (cell: Item) => {
    const [col, row] = cell;
    const rectangle = ref.current?.getBounds(col, row);
    if (!rectangle || cellValue2GridDisplay(undefined, col).kind !== GridCellKind.Custom) {
      return;
    }
    viewStore.activateCell({
      recordId: records[row].id,
      fieldId: columns[col].id,
    });
    gridViewStore.updateEditorPosition({
      pos: calculateCellPosition(container, rectangle),
      cell: {
        width: rectangle.width,
        height: rectangle.height,
      },
    });
  };

  return (
    <div ref={container} className="relative grow w-full overflow-y-auto overflow-x-hidden">
      {connected ? (
        <DataEditor
          {...customRendererArgs}
          ref={ref}
          theme={theme}
          smoothScrollX
          smoothScrollY
          getCellContent={getCellContent}
          onVisibleRegionChanged={onVisibleRegionChanged}
          onCellEdited={onCellEdited}
          onCellActivated={onCellActivated}
          onColumnResize={onColumnResize}
          width={'100%'}
          columns={columns}
          rows={rowCount}
          rowMarkers="both"
          onHeaderMenuClick={onHeaderMenuClick}
          freezeColumns={1}
          headerIcons={headerIcons}
          onRowAppended={onRowAppended}
          trailingRowOptions={{
            tint: true,
            hint: 'New record',
          }}
          rightElement={<AddField />}
          rightElementProps={{
            fill: true,
            sticky: false,
          }}
          isDraggable={false}
        />
      ) : (
        <DataEditor
          {...customRendererArgs}
          ref={ref}
          theme={theme}
          smoothScrollX
          smoothScrollY
          getCellContent={getCellContent}
          onVisibleRegionChanged={onVisibleRegionChanged}
          width={'100%'}
          columns={columns}
          rows={rowCount}
          rowMarkers="both"
          freezeColumns={1}
          headerIcons={headerIcons}
          rightElement={<AddField disabled />}
          rightElementProps={{
            fill: true,
            sticky: false,
          }}
        />
      )}
      <DomBox />
    </div>
  );
};
