import { FieldType } from '@teable/core';
import { Plus, Trash2 } from '@teable/icons';
import { FieldSelector } from '@teable/sdk/components';
import { useFields } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib';
import { keyBy } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface IAttachmentSelectProps {
  value?: string[];
  onChange: (value: string[]) => void;
}

export const AttachmentSelect = (props: IAttachmentSelectProps) => {
  const { value = [], onChange } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const fields = useFields({ withHidden: true, withDenied: true });

  const excludedIds = useMemo(() => {
    const otherFieldIds = fields
      .filter((field) => field.type !== FieldType.Attachment)
      .map((field) => field.id);
    return [...otherFieldIds, ...value];
  }, [value, fields]);

  const fieldMap = useMemo(() => keyBy(fields, 'id'), [fields]);

  const deleteItem = (index: number) => {
    const newValue = [...value];
    newValue.splice(index, 1);
    onChange(newValue);
  };

  return (
    <div className="flex w-full flex-col gap-y-2">
      {value.map((fieldId, index) => (
        <div className="flex items-center" key={index}>
          <Button size="sm" variant="outline">
            {fieldMap[fieldId]?.name}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => deleteItem(index)}>
            <Trash2 />
          </Button>
        </div>
      ))}

      <FieldSelector
        excludedIds={excludedIds}
        onSelect={(fieldId) => onChange([...value, fieldId])}
      >
        <Button size="sm" variant="outline">
          <Plus />
          {t('table:field.aiConfig.action.addAttachment')}
        </Button>
      </FieldSelector>
    </div>
  );
};
