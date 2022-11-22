import '@glideapps/glide-data-grid/dist/index.css';

import DataEditor from '@glideapps/glide-data-grid';
import React from 'react';
import { clearCell, defaultProps, useMockDataGenerator } from './utils';

export const DataGrid: React.VFC = () => {
  const { cols, getCellContent, setCellValueRaw, setCellValue } =
    useMockDataGenerator(60, false);
  const [numRows, setNumRows] = React.useState(50);
  const onRowAppended = React.useCallback(() => {
    const newRow = numRows;
    // our data source is a mock source that pre-fills data, so we are just clearing this here. You should not
    // need to do this.
    for (let c = 0; c < cols.length; c++) {
      const cell = getCellContent([c, newRow]);
      setCellValueRaw([c, newRow], clearCell(cell));
    }
    // Tell the data grid there is another row
    setNumRows((cv) => cv + 1);
  }, [cols.length, getCellContent, numRows, setCellValueRaw]);
  return (
    <DataEditor
      {...defaultProps}
      getCellContent={getCellContent}
      columns={cols}
      rowMarkers={'both'}
      onPaste={true} // we want to allow paste to just call onCellEdited
      onCellEdited={setCellValue} // Sets the mock cell content
      trailingRowOptions={{
        // How to get the trailing row to look right
        sticky: true,
        tint: true,
        hint: 'New row...',
      }}
      rows={numRows}
      onRowAppended={onRowAppended}
    />
  );
};
