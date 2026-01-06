import type { ILastModifiedByFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { FieldSelector } from '@teable/sdk/components';
import { useFields } from '@teable/sdk/hooks';
import { Label, RadioGroup, RadioGroupItem } from '@teable/ui-lib/shadcn';
import { Badge } from '@teable/ui-lib/shadcn/ui/badge';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

interface IProps {
  options?: Partial<ILastModifiedByFieldOptions>;
  onChange?: (options: Partial<ILastModifiedByFieldOptions>) => void;
}

export const LastModifiedByOptions = ({ options = {}, onChange }: IProps) => {
  const { t } = useTranslation(['table']);
  const fields = useFields({ withHidden: true, withDenied: true });
  const trackedFieldIds = options.trackedFieldIds ?? [];
  const trackAll = trackedFieldIds.length === 0;

  const editableFields = useMemo(() => {
    return fields.filter((field) => {
      if (field.type === FieldType.LastModifiedTime || field.type === FieldType.LastModifiedBy) {
        return false;
      }
      if (field.type === FieldType.CreatedTime || field.type === FieldType.CreatedBy) {
        return false;
      }
      return !field.isComputed;
    });
  }, [fields]);

  const handleRadioChange = (value: string) => {
    if (value === 'all') {
      onChange?.({ trackedFieldIds: [] });
      return;
    }
    if (!trackedFieldIds.length && editableFields.length) {
      onChange?.({ trackedFieldIds: [editableFields[0].id] });
    }
  };

  const selectAll = () => {
    onChange?.({ trackedFieldIds: [] });
  };

  const addField = (fieldId: string) => {
    if (trackedFieldIds.includes(fieldId)) return;
    onChange?.({ trackedFieldIds: [...trackedFieldIds, fieldId] });
  };

  const removeField = (fieldId: string) => {
    onChange?.({ trackedFieldIds: trackedFieldIds.filter((id) => id !== fieldId) });
  };

  return (
    <div className="form-control w-full space-y-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t('field.editor.lastModifiedScope')}</Label>
        <RadioGroup value={trackAll ? 'all' : 'specific'} onValueChange={handleRadioChange}>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="all" id="lmb-all" />
            <Label htmlFor="lmb-all" className="font-normal">
              {t('field.editor.lastModifiedAll')}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="specific" id="lmb-specific" />
            <Label htmlFor="lmb-specific" className="font-normal">
              {t('field.editor.lastModifiedSpecific')}
            </Label>
          </div>
        </RadioGroup>
      </div>

      {!trackAll && (
        <div className="space-y-3">
          <FieldSelector
            modal
            fields={editableFields}
            excludedIds={trackedFieldIds}
            onSelect={addField}
            placeholder={t('field.editor.lastModifiedSelect')}
          >
            <Button variant="outline" className="h-9 w-full justify-between px-3">
              <span className="truncate text-sm font-normal">
                {t('field.editor.lastModifiedSelect')}
              </span>
            </Button>
          </FieldSelector>

          {trackedFieldIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {trackedFieldIds.map((fieldId) => {
                const current = fields.find((f) => f.id === fieldId);
                if (!current) return null;
                return (
                  <Badge key={fieldId} variant="default" className="gap-1">
                    <span className="truncate">{current.name}</span>
                    <button
                      aria-label="remove"
                      className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => removeField(fieldId)}
                    >
                      ×
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}

          {!editableFields.length && (
            <span className="text-xs text-muted-foreground">
              {t('field.editor.noEditableFields')}
            </span>
          )}

          {!trackAll && trackedFieldIds.length > 0 && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={selectAll}
            >
              {t('field.editor.lastModifiedAll')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
