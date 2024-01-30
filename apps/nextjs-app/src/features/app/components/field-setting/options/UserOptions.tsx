import type { CellValueType, IUserFieldOptions } from '@teable/core';
import { Label, Switch } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

export const UserOptions = (props: {
  options: Partial<IUserFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  onChange?: (options: Partial<IUserFieldOptions>) => void;
}) => {
  const { options = {}, isLookup, onChange } = props;
  const { isMultiple, shouldNotify } = options;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const onIsMultipleChange = (checked: boolean) => {
    onChange?.({
      isMultiple: checked,
    });
  };

  const onShouldNotifyChange = (checked: boolean) => {
    onChange?.({
      shouldNotify: checked,
    });
  };

  return (
    <div className="form-control space-y-2">
      {!isLookup && (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Switch
              id="field-options-is-multiple"
              checked={Boolean(isMultiple)}
              onCheckedChange={onIsMultipleChange}
            />
            <Label htmlFor="field-options-is-multiple" className="font-normal">
              {t('table:field.editor.allowMultiUsers')}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Switch
              id="field-options-should-notify"
              checked={Boolean(shouldNotify)}
              onCheckedChange={onShouldNotifyChange}
            />
            <Label htmlFor="field-options-should-notify" className="font-normal">
              {t('table:field.editor.notifyUsers')}
            </Label>
          </div>
        </div>
      )}
    </div>
  );
};
