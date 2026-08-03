import type { ISelectFieldOptions } from '@teable/core';
import { useTheme } from '@teable/next-themes';
import { SelectEditor, transformSelectOptions } from '@teable/sdk/components';
import { DefaultValue } from '../../DefaultValue';

interface ISelectDefaultValue {
  isMultiple: boolean;
  onChange: (value: string | string[] | undefined) => void;
  options: Partial<ISelectFieldOptions> | undefined;
}

export const SelectDefaultValue = ({ isMultiple, onChange, options }: ISelectDefaultValue) => {
  const { resolvedTheme } = useTheme();

  return (
    <DefaultValue onReset={() => onChange(undefined)}>
      <SelectEditor
        value={options?.defaultValue}
        options={transformSelectOptions(options?.choices ?? [], resolvedTheme)}
        onChange={onChange}
        isMultiple={isMultiple}
      />
    </DefaultValue>
  );
};
