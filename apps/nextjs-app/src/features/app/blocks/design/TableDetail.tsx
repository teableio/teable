import { useLanDayjs, useTable, useTablePermission } from '@teable/sdk/hooks';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Pencil } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

interface EditableFieldProps {
  label: string;
  value: string | undefined;
  multiline?: boolean;
  editable?: boolean;
  onSave: (value: string | null) => Promise<void>;
}

const EditableField = ({
  label,
  value,
  multiline = false,
  editable = true,
  onSave,
}: EditableFieldProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation(['common']);

  const handleSave = async () => {
    try {
      setIsLoading(true);
      await onSave(editValue || null);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <Popover open={isEditing} onOpenChange={setIsEditing}>
        <label className="relative flex items-center gap-2 text-xs text-muted-foreground">
          {label}
          <PopoverTrigger asChild disabled={!editable}>
            <Pencil className="size-5 cursor-pointer p-1" />
          </PopoverTrigger>
        </label>
        <PopoverContent className="w-80">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              await handleSave();
            }}
          >
            {multiline ? (
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                data-1p-ignore="true"
                autoComplete="off"
                placeholder={label}
              />
            ) : (
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                data-1p-ignore="true"
                autoComplete="off"
                placeholder={label}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(false)}
                disabled={isLoading}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={isLoading}>
                {t('actions.submit')}
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      {value != null ? (
        multiline ? (
          <pre className="text-sm">{value}</pre>
        ) : (
          <p className="text-sm">{value}</p>
        )
      ) : (
        <p className="text-sm opacity-20">-</p>
      )}
    </div>
  );
};

export const TableDetail = () => {
  const table = useTable();
  const { t } = useTranslation(['common', 'table']);
  const dayjs = useLanDayjs();
  const permission = useTablePermission();
  const canUpdate = permission['table|update'];
  if (!table) return null;

  const handleUpdateTableName = async (newName: string | null) => {
    if (newName == null) return;
    await table.updateName(newName);
    toast(t('actions.updateSucceed'));
  };

  const handleUpdateDescription = async (newDescription: string | null) => {
    await table.updateDescription(newDescription);
    toast(t('actions.updateSucceed'));
  };

  const handleUpdateDbTableName = async (newDbTableName: string | null) => {
    if (newDbTableName == null) return;
    await table.updateDbTableName(newDbTableName);
    toast(t('actions.updateSucceed'));
  };

  const dbTableName = table.dbTableName.split('.')[1];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <EditableField
          label={t('table:table.nameForTable')}
          value={table.name}
          editable={canUpdate}
          onSave={handleUpdateTableName}
        />
        <EditableField
          label={t('table:table.dbTableName')}
          value={dbTableName}
          editable={canUpdate}
          onSave={handleUpdateDbTableName}
        />
      </div>
      <div>
        <EditableField
          label={t('table:table.descriptionForTable')}
          value={table.description}
          editable={canUpdate}
          multiline={true}
          onSave={handleUpdateDescription}
        />
        <div>
          <label className="text-xs text-muted-foreground">{t('table:lastModifiedTime')}</label>
          <pre className="max-h-0h-[72px] overflow-y-auto text-sm">
            {dayjs(table?.lastModifiedTime).fromNow()}
          </pre>
        </div>
      </div>
    </div>
  );
};
