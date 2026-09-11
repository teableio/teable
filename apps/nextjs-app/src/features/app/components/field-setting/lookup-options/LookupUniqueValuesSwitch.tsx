import { Label, Switch } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useId } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

export const LookupUniqueValuesSwitch = ({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const id = useId();

  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <Label htmlFor={id} className="label-text text-sm">
        {t('table:field.editor.removeDuplicateValues')}
      </Label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        data-testid="lookup-unique-values-toggle"
      />
    </div>
  );
};
