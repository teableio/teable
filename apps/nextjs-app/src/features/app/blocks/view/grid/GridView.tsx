import DataEditor, { GridCellKind, useCustomCells } from '@glideapps/glide-data-grid';
import type { DataEditorRef, Rectangle } from '@glideapps/glide-data-grid';
import type { IRecordSnapshot } from '@teable-group/core';
import { IdPrefix, OpBuilder } from '@teable-group/core';
import { useConnection, useRowCount, useSSRRecords, useTable, useTableId } from '@teable-group/sdk';
import type { Doc } from '@teable/sharedb/lib/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrevious } from 'react-use';
import '@glideapps/glide-data-grid/dist/index.css';
import { SelectCell } from '@/features/app/components/gird-cells';
import type { IGridCell } from '@/features/app/components/gird-cells/type';
import { girdCellToCellValue } from '@/features/app/components/gird-cells/utils';
import { AddField } from './AddField';
import { FieldMenu } from './FieldMenu';
import { getHeaderIcons } from './getHeaderIcons';
import { useAsyncData } from './useAsyncData';
import { useColumnResize } from './useColumnResize';
import { useColumns } from './useColumns';
import { useFieldMenuPosition } from './useFieldMenu';
import { useGridTheme } from './useGridTheme';

const headerIcons = getHeaderIcons();

export const GridView: React.FC = () => {
  const ref = useRef<DataEditorRef | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const { connected, connection } = useConnection();
  const tableId = useTableId() as string;
  const table = useTable();
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const { columns: originalColumns, cellValue2GridDisplay } = useColumns();
  const theme = useGridTheme();
  const { columns, onColumnResize } = useColumnResize(originalColumns);
  const customRendererArgs = useCustomCells([SelectCell]);
  const [menu, setMenu] = useState<{ col: number; bounds: Rectangle }>();

  const fieldMenuPosition = useFieldMenuPosition(container, ref, menu);

  const { getCellContent, onVisibleRegionChanged, onCellEdited, getCellsForSelection, reset } =
    useAsyncData<Doc<IRecordSnapshot>>(
      50,
      5,
      useCallback(
        async (updateRowRef, updateRow, [offset, limit]) => {
          const query = connection.createSubscribeQuery<IRecordSnapshot>(
            `${IdPrefix.Record}_${tableId}`,
            {
              offset,
              limit,
            }
          );
          const recordDocs = await new Promise<typeof query['results']>((resolve) => {
            function subscribeUpdate(doc: Doc) {
              doc.on('op', (op) => {
                console.log('doc on op:', op);
                updateRow(doc);
              });
            }

            query.on('ready', () => {
              console.log(
                'record:ready:',
                query.results.map((r) => r.data.record)
              );
              query.results.forEach((doc) => {
                subscribeUpdate(doc);
              });
              resolve(query.results);
            });
            query.on('changed', () => {
              updateRowRef(query.results, offset);
            });
            query.on('insert', (docs) => {
              docs.forEach((doc) => {
                subscribeUpdate(doc);
              });
            });
            query.on('remove', (docs) => {
              docs.forEach((doc) => {
                doc.removeAllListeners('op');
              });
            });
          });
          const rowData = recordDocs.map((rd) =>
            columns.map((column) => {
              const fieldId = column.id;
              return String(rd.data.record.fields[fieldId] ?? '');
            })
          );
          console.log('getRowData', columns, rowData);
          return recordDocs;
        },
        [columns, connection, tableId]
      ),
      useCallback(
        (rowData, col) => {
          const fieldId = columns[col]?.id;
          if (!fieldId) {
            return {
              kind: GridCellKind.Loading,
              allowOverlay: false,
            };
          }
          const cellValue = rowData.data.record.fields[fieldId];
          return cellValue2GridDisplay(cellValue, col);
        },
        [cellValue2GridDisplay, columns]
      ),
      useCallback(
        (cell, newVal, rowData) => {
          const [col] = cell;
          const fieldId = columns[col].id;
          let newCellValue = newVal.data;
          // custom cell value format
          if (newVal.kind === GridCellKind.Custom) {
            newCellValue = girdCellToCellValue(newVal.data as IGridCell);
          }
          const oldCellValue = rowData.data.record.fields[fieldId] ?? null;
          if (newCellValue == oldCellValue) {
            return;
          }
          console.log('endEdit', newVal.data);
          const operation = OpBuilder.editor.setRecord.build({
            fieldId,
            newCellValue,
            oldCellValue,
          });

          rowData.submitOp([operation], { undoable: true }, (error) => {
            if (error) {
              console.error('row data submit error: ', error);
            }
          });
          return rowData;
        },
        [columns]
      ),
      ref,
      useMemo(
        () =>
          ssrRecords?.map((record) => {
            return { data: { record } } as Doc;
          }),
        [ssrRecords]
      )
    );

  const preTableId = usePrevious(tableId);
  useEffect(() => {
    if (preTableId && preTableId !== tableId) {
      reset();
    }
  }, [reset, tableId, preTableId]);

  const onHeaderMenuClick = useCallback((col: number, bounds: Rectangle) => {
    setMenu({ col, bounds });
  }, []);

  const onFinishedEditing = () => {
    setMenu(undefined);
  };

  const onRowAppended = () => {
    table?.createRecord({});
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
          onColumnResize={onColumnResize}
          getCellsForSelection={getCellsForSelection}
          width={'100%'}
          columns={columns}
          rows={rowCount}
          rowMarkers="both"
          onHeaderMenuClick={onHeaderMenuClick}
          freezeColumns={1}
          onFinishedEditing={onFinishedEditing}
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
        />
      ) : (
        <DataEditor
          {...customRendererArgs}
          ref={ref}
          theme={theme}
          smoothScrollX
          smoothScrollY
          getCellContent={getCellContent}
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
      {
        <FieldMenu
          style={{
            left: fieldMenuPosition.x,
            top: fieldMenuPosition.y,
          }}
          visible={Boolean(menu)}
          fieldId={menu?.col != undefined ? columns[menu.col]?.id : undefined}
          onClose={() => setMenu(undefined)}
        />
      }
    </div>
  );
};
