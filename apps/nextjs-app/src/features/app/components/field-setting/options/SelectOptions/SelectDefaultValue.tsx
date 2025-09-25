import type { ISelectFieldOptions } from '@teable/core';
import { SelectEditor, transformSelectOptions } from '@teable/sdk/components';
import { DefaultValue } from '../../DefaultValue';

interface ISelectDefaultValue {
  isMultiple: boolean;
  onChange: (value: string | string[] | undefined) => void;
  options: Partial<ISelectFieldOptions> | undefined;
}

export const SelectDefaultValue = ({ isMultiple, onChange, options }: ISelectDefaultValue) => {
  return (
    <DefaultValue onReset={() => onChange(undefined)}>
      <SelectEditor
        className="h-9"
        value={options?.defaultValue}
        options={transformSelectOptions(options?.choices ?? [])}
        onChange={onChange}
        isMultiple={isMultiple}
      />
    </DefaultValue>
  );
};
