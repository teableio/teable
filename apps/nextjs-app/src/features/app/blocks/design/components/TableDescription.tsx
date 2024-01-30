import { useTable, useTablePermission } from '@teable-group/sdk/hooks';
import type { Table } from '@teable-group/sdk/model';
import { Button, Label, Textarea } from '@teable-group/ui-lib/shadcn';
import { toast } from '@teable-group/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export const TableDescription = () => {
  const table = useTable() as Table;
  const permission = useTablePermission();
  const canUpdate = permission['table|update'];
  const [newTableDescription, setNewTableDescription] = useState(table.description);
  const { t } = useTranslation(['common', 'table']);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="description">{t('description')}</Label>
      <Textarea
        id="description"
        readOnly={!canUpdate}
        placeholder={t('table:table.descriptionForTable')}
        value={newTableDescription}
        onChange={(e) => setNewTableDescription(e.target.value)}
      />
      <Button
        size="sm"
        disabled={!canUpdate}
        onClick={async () => {
          await table.updateDescription(newTableDescription || null);
          toast(t('actions.updateSucceed'));
        }}
      >
        {t('actions.submit')}
      </Button>
    </div>
  );
};
