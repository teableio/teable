import DataEditor, { GridCellKind, GridColumnIcon } from '@glideapps/glide-data-grid';
import type { GridColumn, DataEditorRef } from '@glideapps/glide-data-grid';
import type { IRecordSnapshot } from '@teable-group/core';
import { OpBuilder, FieldType, SnapshotQueryType } from '@teable-group/core';
import { useConnection, useFields, useRowCount, useTableId } from '@teable-group/sdk';
import { useCallback, useMemo, useRef } from 'react';
import '@glideapps/glide-data-grid/dist/index.css';
import type { Doc } from 'sharedb/lib/client';
import { useAsyncData } from './useAsyncData';

export const DemoGrid: React.FC = () => {
  const ref = useRef<DataEditorRef | null>(null);
  const connection = useConnection();
  const rowCount = useRowCount();
  const fields = useFields();
  const tableId = useTableId();

  const columns: (GridColumn & {
    id: string;
  })[] = useMemo(() => {
    return fields.map((field) => {
      console.log('fieldInstance', field);
      switch (field.type) {
        case FieldType.SingleLineText:
          return {
            id: field.id,
            title: field.name,
            width: 400,
            icon: GridColumnIcon.HeaderString,
            kind: GridCellKind.Text,
          };
        case FieldType.SingleSelect:
          return {
            id: field.id,
            title: field.name,
            width: 100,
            icon: GridColumnIcon.HeaderArray,
            kind: GridCellKind.Text,
          };
        case FieldType.Number:
          return {
            id: field.id,
            title: field.name,
            width: 100,
            icon: GridColumnIcon.HeaderNumber,
            kind: GridCellKind.Text,
          };
      }
    });
  }, [fields]);

  const { getCellContent, onVisibleRegionChanged, onCellEdited, getCellsForSelection } =
    useAsyncData<Doc<IRecordSnapshot>>(
      50,
      5,
      useCallback(
        async (updateRowRef, updateRow, [offset, limit]) => {
          await new Promise((res) => setTimeout(res, 300));
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
          return {
            kind: GridCellKind.Text,
            data: String(rowData.data.record.fields[fieldId]) || '',
            allowOverlay: true,
            displayData: String(rowData.data.record.fields[fieldId]) || '',
          };
        },
        [columns]
      ),
      useCallback(
        (cell, newVal, rowData) => {
          const [col] = cell;
          const fieldId = columns[col].id;
          console.log('endEdit', newVal.data);
          const operation = OpBuilder.editor.setRecord.build({
            fieldId,
            newCellValue: newVal.data,
            oldCellValue: rowData.data.record.fields[fieldId],
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
      ref
    );

  return (
    <DataEditor
      ref={ref}
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
  );
};
