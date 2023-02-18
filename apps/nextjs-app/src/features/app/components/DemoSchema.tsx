import { GridCellKind, GridColumnIcon } from '@glideapps/glide-data-grid';
import type { GridColumn } from '@glideapps/glide-data-grid';
import type { IFieldSnapshot } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk';
import { createFieldInstance } from '@teable-group/sdk';
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
  const [fields, setFields] = useState<IFieldInstance[]>([]);

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
      setFields(fieldsQuery.results.map((r) => createFieldInstance(r, r.data.field)));
    });

    fieldsQuery.on('changed', () => {
      console.log('table:changed:', fieldsQuery.results);
      setFields(fieldsQuery.results.map((r) => createFieldInstance(r, r.data.field)));
    });

    return () => {
      fieldsQuery.destroy();
    };
  }, [connection, tableId]);

  const columns: (GridColumn & {
    id: string;
  })[] = fields.map((field) => {
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

  return (
    <div className="h-full">
      {tableId && columns.length ? children(tableId, columns, connection) : <h1>input tableId </h1>}
    </div>
  );
};
