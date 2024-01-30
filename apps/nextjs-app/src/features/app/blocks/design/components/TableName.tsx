import { useTable, useTablePermission } from '@teable-group/sdk/hooks';
import type { Table } from '@teable-group/sdk/model';
import { Button, Input, Label } from '@teable-group/ui-lib/shadcn';
import { toast } from '@teable-group/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export const TableName = () => {
  const table = useTable() as Table;
  const permission = useTablePermission();
  const canUpdate = permission['table|update'];
  const [newTableName, setNewTableName] = useState(table.name);
  const { t } = useTranslation(['common', 'table']);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="tableName">{t('name')}</Label>
      <div className="flex gap-2">
        <Input
          id="tableName"
          className="h-8"
          readOnly={!canUpdate}
          placeholder={t('table:table.nameForTable')}
          value={newTableName}
          onChange={(e) => setNewTableName(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!canUpdate}
          onClick={async () => {
            await table.updateName(newTableName);
            toast(t('actions.updateSucceed'));
          }}
        >
          {t('actions.submit')}
        </Button>
      </div>
    </div>
  );
};
