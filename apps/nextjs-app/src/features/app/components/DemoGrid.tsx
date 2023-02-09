import DataEditor, { GridCellKind, GridColumnIcon } from '@glideapps/glide-data-grid';
import type { GridColumn, GridCell, Item } from '@glideapps/glide-data-grid';
import { useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { useDidMount } from 'rooks';
import { Connection } from 'sharedb/lib/client';
import '@glideapps/glide-data-grid/dist/index.css';

const columns: GridColumn[] = [
  { title: 'Name', width: 100, icon: GridColumnIcon.HeaderString },
  { title: 'Time', width: 300, icon: GridColumnIcon.HeaderTime },
  { title: 'Numerical', width: 100, icon: GridColumnIcon.HeaderNumber },
];
const colMap: { [key: number]: string } = {
  0: 'fldVQMs7wFD6NOkiUVg',
  1: 'fldzatgEI3Pc5GuLrnI',
  2: 'fld7eivXvAQ1YqAoyvm',
};

export const DemoGrid: React.FC = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [records, setRecords] = useState<any[]>([]);

  function getData([col, row]: Item): GridCell {
    const value = records[row].fields[colMap[col]] ?? undefined;
    switch (col) {
      case 0: {
        return {
          kind: GridCellKind.Text,
          data: value,
          allowOverlay: false,
          displayData: value ?? '',
        };
      }
      // eslint-disable-next-line sonarjs/no-duplicated-branches
      case 1: {
        return {
          kind: GridCellKind.Text,
          data: value,
          allowOverlay: false,
          displayData: value ?? '',
        };
      }
      case 2: {
        return {
          kind: GridCellKind.Number,
          data: value,
          allowOverlay: false,
          displayData: String(value) ?? '',
        };
      }
      default: {
        throw new Error('Unknown column');
      }
    }
  }

  useDidMount(() => {
    const socket = new ReconnectingWebSocket('ws://' + window.location.host);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection = new Connection(socket as any);
    const query = connection.createSubscribeQuery('tbllCUQirwoKN2hdOUO', { limit: 1000 });
    query.on('ready', () => {
      console.log('table:ready:', query.results);
      setRecords(query.results.map((r) => r.data.record));
    });
    query.on('changed', () => {
      console.log('table:changed:', query.results);
      setRecords(query.results.map((r) => r.data.record));
    });
  });

  return (
    <div>
      <h1>Teable Technical Preview</h1>
      <div style={{ height: 700 }}>
        <DataEditor
          smoothScrollX
          smoothScrollY
          getCellsForSelection
          width={'100%'}
          getCellContent={getData}
          columns={columns}
          rows={records.length}
          rowMarkers="both"
        />
      </div>
    </div>
  );
};
