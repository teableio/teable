/* eslint-disable jsx-a11y/no-autofocus */
import type { IFieldRo, IUserFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { Input, Label, Switch } from '@teable/ui-lib';
import { useTranslation } from '../../context/app/i18n';

interface IFieldCreatorProps {
  field: IFieldRo;
  setField: React.Dispatch<React.SetStateAction<IFieldRo | undefined>>;
}

export const FieldCreator = (props: IFieldCreatorProps) => {
  const { field, setField } = props;
  const { name, type, options } = field;
  const { t } = useTranslation();

  const onNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setField({ ...field, name: value });
  };

  const onOptionChange = (checked: boolean, key: string) => {
    setField({
      ...field,
      options: { ...(options ?? {}), [key]: checked },
    });
  };

  const getContent = () => {
    switch (type) {
      case FieldType.SingleSelect: {
        return <Input value={name} onChange={onNameChange} autoFocus />;
      }
      case FieldType.User: {
        return (
          <div className="space-y-3">
            <Input value={name} onChange={onNameChange} autoFocus />
            <div className="flex items-center space-x-2">
              <Switch
                id="user-field-options-should-notify"
                checked={Boolean((options as IUserFieldOptions)?.shouldNotify)}
                onCheckedChange={(checked) => onOptionChange(checked, 'shouldNotify')}
              />
              <Label htmlFor="user-field-options-should-notify" className="font-normal">
                {t('editor.user.notify')}
              </Label>
            </div>
          </div>
        );
      }
      default:
        return <Input value={name} onChange={onNameChange} autoFocus />;
    }
  };

  return <div className="py-2">{getContent()}</div>;
};
