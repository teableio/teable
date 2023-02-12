import { GridCellKind, GridColumnIcon } from '@glideapps/glide-data-grid';
import type { GridColumn } from '@glideapps/glide-data-grid';
import type { IFieldSnapshot } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { useEffect, useState } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { Connection } from 'sharedb/lib/client';
import '@glideapps/glide-data-grid/dist/index.css';
export interface IDemoGridProps {
  tableId: string;
  children: (
    tableId: string,
    columns: (GridColumn & { id: string })[],
    connection: Connection
  ) => React.ReactNode;
}

export const DemoGridSchema: React.FC<IDemoGridProps> = ({ tableId, children }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [fields, setFields] = useState<IFieldSnapshot[]>([]);

  const [connection] = useState(() => {
    const socket = new ReconnectingWebSocket('ws://' + window.location.host);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Connection(socket as any);
  });

  useEffect(() => {
    if (!tableId) {
      return;
    }
    const fieldsQuery = connection.createSubscribeQuery<IFieldSnapshot>(tableId, { type: 'field' });

    fieldsQuery.on('ready', () => {
      console.log('table:ready:', fieldsQuery.results);
      setFields(fieldsQuery.results.map((r) => r.data));
    });
    fieldsQuery.on('changed', () => {
      console.log('table:changed:', fieldsQuery.results);
      setFields(fieldsQuery.results.map((r) => r.data));
    });

    return () => {
      fieldsQuery.destroy();
    };
  }, [connection, tableId]);

  const columns: (GridColumn & {
    id: string;
  })[] = fields.map((fieldSnapshot) => {
    const field = fieldSnapshot.field;
    switch (field.type) {
      case FieldType.SingleLineText:
        return {
          id: field.id,
          title: field.name,
          width: 150,
          icon: GridColumnIcon.HeaderString,
          kind: GridCellKind.Text,
        };
      case FieldType.SingleSelect:
        return {
          id: field.id,
          title: field.name,
          width: 150,
          icon: GridColumnIcon.HeaderArray,
          kind: GridCellKind.Text,
        };
      case FieldType.Number:
        return {
          id: field.id,
          title: field.name,
          width: 150,
          icon: GridColumnIcon.HeaderNumber,
          kind: GridCellKind.Text,
        };
    }
    return {
      id: field.id,
      title: field.name,
      width: 150,
      icon: GridColumnIcon.HeaderString,
      kind: GridCellKind.Text,
    };
  });

  return (
    <div className="h-full">
      {tableId && columns.length ? children(tableId, columns, connection) : <h1>input tableId </h1>}
    </div>
  );
};
