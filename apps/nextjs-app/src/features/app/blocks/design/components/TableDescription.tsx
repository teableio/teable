import { useTable, useTablePermission } from '@teable-group/sdk/hooks';
import type { Table } from '@teable-group/sdk/model';
import { Button, Label, Textarea } from '@teable-group/ui-lib/shadcn';
import { useState } from 'react';

export const TableDescription = () => {
  const table = useTable() as Table;
  const permission = useTablePermission();
  const canUpdate = permission['table|update'];
  const [newTableDescription, setNewTableDescription] = useState(table.name);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="description">Description</Label>
      <Textarea
        id="description"
        readOnly={!canUpdate}
        placeholder="Add description for this table"
        value={table.description}
        onChange={(e) => setNewTableDescription(e.target.value)}
      />
      <Button
        size="sm"
        disabled={!canUpdate}
        onClick={() => {
          table.updateDescription(newTableDescription);
        }}
      >
        Submit
      </Button>
    </div>
  );
};
