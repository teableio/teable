import { Edit } from '@teable/icons';
import { useField, useFieldPermission } from '@teable/sdk/hooks';
import { Button, Input } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

export const FieldPropertyEditor = ({
  fieldId,
  propKey,
}: {
  fieldId: string;
  propKey: 'name' | 'dbFieldName';
}) => {
  const field = useField(fieldId);
  const permission = useFieldPermission();
  const canUpdate = permission['field|update'];
  const [newValue, setNewValue] = useState(field?.[propKey]);
  const [isEditing, setIsEditing] = useState(false);
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  if (!field) {
    return <></>;
  }

  return (
    <div className="flex flex-col gap-2">
      {!isEditing ? (
        <div className="flex gap-2 text-nowrap">
          {newValue}
          {canUpdate && <Edit className="size-4" onClick={() => setIsEditing(true)} />}
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            className="h-7 w-40"
            readOnly={!canUpdate}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <Button
            size="xs"
            disabled={!canUpdate}
            onClick={async () => {
              await field.update({ [propKey]: newValue });
              setIsEditing(false);
              toast(t('common:actions.updateSucceed'));
            }}
          >
            {t('actions.submit')}
          </Button>
        </div>
      )}
    </div>
  );
};
