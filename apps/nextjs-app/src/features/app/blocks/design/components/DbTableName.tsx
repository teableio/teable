import { useTable, useTablePermission } from '@teable-group/sdk/hooks';
import type { Table } from '@teable-group/sdk/model';
import { Button, Input, Label } from '@teable-group/ui-lib/shadcn';
import { toast } from '@teable-group/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export const DbTableName = () => {
  const table = useTable() as Table;
  const permission = useTablePermission();
  const canUpdate = permission['table|update'];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, dbTableName] = table.dbTableName.split('.');
  const [newDbTableName, setNewDbTableName] = useState(dbTableName);
  const { t } = useTranslation(['common', 'table']);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="DbTableName">{t('table:table.dbTableName')}</Label>
      <div className="flex gap-2">
        <Input
          id="DbTableName"
          className="h-8"
          readOnly={!canUpdate}
          value={newDbTableName}
          onChange={(e) => setNewDbTableName(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!canUpdate}
          onClick={async () => {
            await table.updateDbTableName(newDbTableName);
            toast(t('actions.updateSucceed'));
          }}
        >
          {t('actions.submit')}
        </Button>
      </div>
    </div>
  );
};
