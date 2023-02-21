import DataEditor, { GridCellKind, GridColumnIcon } from '@glideapps/glide-data-grid';
import type { GridColumn, Item, DataEditorRef } from '@glideapps/glide-data-grid';
import type { IRecordSnapshot } from '@teable-group/core';
import { FieldType, SnapshotQueryType } from '@teable-group/core';
import { useConnection, useFields, useRowCount, useTableId } from '@teable-group/sdk';
import { useCallback, useMemo, useRef } from 'react';
import '@glideapps/glide-data-grid/dist/index.css';
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

  const getRowData = useCallback(
    async (r: Item) => {
      await new Promise((res) => setTimeout(res, 300));
      const [offset, limit] = r;
      const query = connection.createSubscribeQuery<IRecordSnapshot>(tableId, {
        type: SnapshotQueryType.Record,
        offset: offset,
        limit: limit,
      });
      const recordDocs = await new Promise<typeof query['results']>((resolve) => {
        query.on('ready', () => {
          console.log(
            'record:ready:',
            query.results.map((r) => r.data.record)
          );
          resolve(query.results);
        });
      });
      const rowData = recordDocs.map((rd) =>
        columns.map((column) => {
          const fieldId = column.id;
          return String(rd.data.record.fields[fieldId] ?? '');
        })
      );
      console.log('getRowData', columns, rowData);
      return rowData;
    },
    [columns, connection, tableId]
  );

  const { getCellContent, onVisibleRegionChanged, onCellEdited, getCellsForSelection } =
    useAsyncData<string[]>(
      50,
      5,
      getRowData,
      useCallback(
        (rowData, col) => ({
          kind: GridCellKind.Text,
          data: rowData[col] || '',
          allowOverlay: true,
          displayData: rowData[col] || '',
        }),
        []
      ),
      useCallback((cell, newVal, rowData) => {
        const [col] = cell;
        if (newVal.kind !== GridCellKind.Text) return undefined;
        const newRow: string[] = [...rowData];
        newRow[col] = newVal.data;
        return newRow;
      }, []),
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
