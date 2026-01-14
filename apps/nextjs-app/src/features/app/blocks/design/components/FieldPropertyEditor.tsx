import { Edit } from '@teable/icons';
import { useField, useFieldPermission } from '@teable/sdk/hooks';
import { Button, Input } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (isEditing) {
        inputRef.current?.select();
        inputRef.current?.focus();
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [isEditing]);

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      // Check if focus is moving to another element within the container
      const relatedTarget = e.relatedTarget as Node | null;
      if (containerRef.current?.contains(relatedTarget)) {
        return;
      }
      // Exit editing mode and reset value to original
      setNewValue(field?.[propKey]);
      setIsEditing(false);
    },
    [field, propKey]
  );

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
        <div ref={containerRef} className="flex gap-2" onBlur={handleBlur}>
          <Input
            ref={inputRef}
            className="h-7 w-40"
            readOnly={!canUpdate}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <Button
            size="xs"
            disabled={!canUpdate}
            onClick={async () => {
              if (newValue === field?.[propKey]) {
                setIsEditing(false);
                return;
              }
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
