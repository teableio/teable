import type { ICheckboxFieldOptions } from '@teable/core';
import { Checkbox } from '@teable/ui-lib/shadcn';
import { DefaultValue } from '../DefaultValue';

export const CheckboxOptions = (props: {
  options: Partial<ICheckboxFieldOptions> | undefined;
  onChange?: (options: Partial<ICheckboxFieldOptions>) => void;
  isLookup?: boolean;
}) => {
  const { isLookup, options, onChange } = props;
  const onDefaultValueChange = (defaultValue: boolean | undefined) => {
    onChange?.({
      defaultValue: defaultValue || undefined,
    });
  };

  return (
    <div className="form-control space-y-4 border-t pt-4">
      {!isLookup && (
        <DefaultValue>
          <Checkbox
            checked={options?.defaultValue || false}
            onCheckedChange={(checked: boolean) => onDefaultValueChange(checked)}
          />
        </DefaultValue>
      )}
    </div>
  );
};
