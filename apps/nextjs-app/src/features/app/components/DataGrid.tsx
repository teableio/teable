import '@glideapps/glide-data-grid/dist/index.css';

import type { DataEditorProps, GridCell, GridColumn, Item } from '@glideapps/glide-data-grid';
import DataEditor, { GridCellKind } from '@glideapps/glide-data-grid';
import { useColumns } from '@teable-group/sdk/hooks/use-columns';
import { useRowCount } from '@teable-group/sdk/hooks/use-row-count';
import React, { useEffect, useState } from 'react';
import type { ITeable } from '@/backend/features/file-tree/interface';
import { fetchFileContent } from '../api/fetch-file-content-ky.api';

export const defaultProps: Partial<DataEditorProps> = {
  smoothScrollX: true,
  smoothScrollY: true,
  getCellsForSelection: true,
  width: '100%',
};

const transformTeableSchemaIntoGridColumn = (
  data: ITeable | undefined,
  tableId: string,
  viewId?: string
) => {
  if (!data) {
    return [];
  }
  if (!('schema' in data)) {
    return [];
  }
  const fieldMap = data?.schema[tableId].fieldMap;
  if (!fieldMap) {
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const _viewId = viewId || data?.schema[tableId].viewList[0];
  const view = data?.schema[tableId].viewMap[_viewId];
  console.log(view);
  const columns: GridColumn[] = view?.columns.map((fieldItem) => {
    const field = fieldMap[fieldItem.fieldId];
    return {
      id: fieldItem.fieldId,
      title: field.name,
    };
  });
  return columns;
};

export const DataGrid: React.FC<{ path: string }> = ({ path }) => {
  const [data, setData] = useState<ITeable>();
  const [tableId, setTableId] = useState('');
  useEffect(() => {
    console.log(path);
    // special table
    if (path && path.includes('.teable#')) {
      const [realPath, tableId] = path.split('#');
      setTableId(tableId);
      fetchFileContent(realPath).then((res) => {
        setData(JSON.parse(res.content));
      });
    }
  }, [path]);

  const columns = useColumns('table1', 'view1');
  const rowCount = useRowCount('table1', 'view1');
  // const viewData = useView('table1', 'view1');

  const getCellContent = React.useCallback((cell: Item): GridCell => {
    const [col, row] = cell;
    // dumb but simple way to do this
    return {
      kind: GridCellKind.Text,
      allowOverlay: false,
      displayData: '1' + col + row,
      data: '1' + col + row,
    };
  }, []);

  return (
    <DataEditor
      {...defaultProps}
      getCellContent={getCellContent}
      columns={columns}
      rowMarkers={'both'}
      onPaste={true} // we want to allow paste to just call onCellEdited
      // onCellEdited={setCellValue} // Sets the mock cell content
      trailingRowOptions={{
        // How to get the trailing row to look right
        sticky: true,
        tint: true,
        hint: 'New row...',
      }}
      rows={rowCount}
    />
  );
};
