import '@glideapps/glide-data-grid/dist/index.css';

import type { GridCell, GridColumn, Item } from '@glideapps/glide-data-grid';
import DataEditor, { GridCellKind } from '@glideapps/glide-data-grid';
import React, { useEffect, useState } from 'react';
import { fetchFileContent } from '../api/fetch-file-content-ky.api';
import { defaultProps } from './utils';

const transformTeableSchemaIntoGridColumn = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  tableId: string,
  viewId?: string
) => {
  if (!('schema' in data)) {
    return [];
  }
  const fieldMap = data?.schema[tableId].fieldMap;
  if (!fieldMap) {
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const _viewId = viewId || data?.schema[tableId].view.list[0];
  const view = data?.schema[tableId].view.viewMap[_viewId];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: GridColumn[] = view?.fields.map((fieldItem: any) => {
    const field = fieldMap[fieldItem.fieldId];
    return {
      id: fieldItem.fieldId,
      title: field.title,
    };
  });
  return columns;
};

export const DataGrid: React.FC<{ path: string }> = ({ path }) => {
  const [data, setData] = useState({});
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

  const cols = transformTeableSchemaIntoGridColumn(data, tableId);
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
      columns={cols}
      rowMarkers={'both'}
      onPaste={true} // we want to allow paste to just call onCellEdited
      // onCellEdited={setCellValue} // Sets the mock cell content
      trailingRowOptions={{
        // How to get the trailing row to look right
        sticky: true,
        tint: true,
        hint: 'New row...',
      }}
      rows={20}
    />
  );
};
