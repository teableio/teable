import DataEditor from '@glideapps/glide-data-grid';
import type { DataEditorRef } from '@glideapps/glide-data-grid';
import type { IRecordSnapshot } from '@teable-group/core';
import { IdPrefix, OpBuilder } from '@teable-group/core';
import { useConnection, useRowCount, useSSRRecords, useTableId } from '@teable-group/sdk';
import type { Doc } from '@teable/sharedb/lib/client';
import { useCallback, useEffect, useRef } from 'react';
import { usePrevious } from 'react-use';
import '@glideapps/glide-data-grid/dist/index.css';
import { useAsyncData } from './useAsyncData';
import { useColumnResize } from './useColumnResize';
import { useColumns } from './useColumns';
import { useGridTheme } from './useGridTheme';

export const GridView: React.FC = () => {
  const ref = useRef<DataEditorRef | null>(null);
  const { connected, connection } = useConnection();
  const tableId = useTableId() as string;
  const rowCount = useRowCount();
  const ssrRecords = useSSRRecords();
  const { columns, setColumns, cellValue2GridDisplay } = useColumns();
  const theme = useGridTheme();
  const onColumnResize = useColumnResize(columns, setColumns);

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
          const fieldId = columns[col].id;
          const cellValue = rowData.data.record.fields[fieldId];
          return cellValue2GridDisplay(cellValue, col);
        },
        [cellValue2GridDisplay, columns]
      ),
      useCallback(
        (cell, newVal, rowData) => {
          const [col] = cell;
          const fieldId = columns[col].id;
          const newCellValue = newVal.data;
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
      ssrRecords?.map((record) => {
        return { data: { record } } as Doc;
      })
    );

  const preTableId = usePrevious(tableId);
  useEffect(() => {
    if (preTableId && preTableId !== tableId) {
      reset();
    }
  }, [reset, tableId, preTableId]);

  return (
    <div className="grow w-full overflow-y-auto">
      {connected ? (
        <DataEditor
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
        />
      ) : (
        <DataEditor
          ref={ref}
          theme={theme}
          smoothScrollX
          smoothScrollY
          getCellContent={getCellContent}
          width={'100%'}
          columns={columns}
          rows={rowCount}
          rowMarkers="both"
        />
      )}
    </div>
  );
};
