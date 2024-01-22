import { useTable, useTablePermission } from '@teable-group/sdk/hooks';
import type { Table } from '@teable-group/sdk/model';
import { Button, Input, Label } from '@teable-group/ui-lib/shadcn';
import { useState } from 'react';

export const TableName = () => {
  const table = useTable() as Table;
  const permission = useTablePermission();
  const canUpdate = permission['table|update'];
  const [newTableName, setNewTableName] = useState(table.name);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="tableName">Name</Label>
      <div className="flex gap-2">
        <Input
          id="tableName"
          className="h-8"
          readOnly={!canUpdate}
          placeholder="Change table name"
          value={newTableName}
          onChange={(e) => setNewTableName(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!canUpdate}
          onClick={() => {
            table.updateName(newTableName);
          }}
        >
          Submit
        </Button>
      </div>
    </div>
  );
};
