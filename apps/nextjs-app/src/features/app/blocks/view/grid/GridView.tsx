import DataEditor from '@glideapps/glide-data-grid';
import type { DataEditorRef } from '@glideapps/glide-data-grid';
import type { IRecordSnapshot } from '@teable-group/core';
import { OpBuilder, SnapshotQueryType } from '@teable-group/core';
import {
  useConnection,
  useFields,
  useRowCount,
  useSSRRecords,
  useTableId,
} from '@teable-group/sdk';
import { useCallback, useRef } from 'react';
import '@glideapps/glide-data-grid/dist/index.css';
import type { Doc } from 'sharedb/lib/client';
import { useAsyncData } from './useAsyncData';
import { useColumns } from './useColumns';
import { useTheme } from './useTheme';

export const GridView: React.FC = () => {
  const ref = useRef<DataEditorRef | null>(null);
  const connection = useConnection();
  const tableId = useTableId();
  const rowCount = useRowCount();
  const fields = useFields();
  const ssrRecords = useSSRRecords();
  const { columns, cellValue2GridDisplay } = useColumns(fields);
  const [theme] = useTheme();

  const { getCellContent, onVisibleRegionChanged, onCellEdited, getCellsForSelection } =
    useAsyncData<Doc<IRecordSnapshot>>(
      50,
      5,
      useCallback(
        async (updateRowRef, updateRow, [offset, limit]) => {
          const query = connection.createSubscribeQuery<IRecordSnapshot>(tableId, {
            type: SnapshotQueryType.Record,
            offset,
            limit,
          });
          const recordDocs = await new Promise<typeof query['results']>((resolve) => {
            query.on('ready', () => {
              console.log(
                'record:ready:',
                query.results.map((r) => r.data.record)
              );
              query.results.forEach((doc) => {
                doc.on('op', (op) => {
                  console.log('doc on op:', op);
                  updateRow(doc);
                });
              });
              resolve(query.results);
            });
            query.on('changed', () => {
              updateRowRef(query.results, offset);
            });
            query.on('insert', (docs) => {
              docs.forEach((doc) => {
                doc.on('op', (op) => {
                  console.log('doc on op:', op);
                  updateRow(doc);
                });
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
          if (newCellValue === oldCellValue) {
            return;
          }
          console.log('endEdit', newVal.data);
          const operation = OpBuilder.editor.setRecord.build({
            fieldId,
            newCellValue,
            oldCellValue,
          });

          rowData.submitOp([operation], undefined, (error) => {
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

  return (
    <div className="grow w-full overflow-y-auto">
      <DataEditor
        ref={ref}
        theme={theme}
        smoothScrollX
        smoothScrollY
        getCellContent={getCellContent}
        onVisibleRegionChanged={onVisibleRegionChanged}
        onCellEdited={onCellEdited}
        getCellsForSelection={getCellsForSelection}
        width={'100%'}
        columns={columns}
        rows={rowCount}
        rowMarkers="both"
      />
    </div>
  );
};
