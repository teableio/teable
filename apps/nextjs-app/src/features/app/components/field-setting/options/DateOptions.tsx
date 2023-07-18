import type { IDateFieldOptions, IDatetimeFormatting } from '@teable-group/core';
import { Label } from '@teable-group/ui-lib/shadcn/ui/label';
import { Switch } from '@teable-group/ui-lib/shadcn/ui/switch';
import { DatetimeFormatting } from '../formatting/DatetimeFormatting';

export const DateOptions = (props: {
  options: Partial<IDateFieldOptions> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<IDateFieldOptions>) => void;
}) => {
  const { options = {}, isLookup, onChange } = props;
  const { defaultValue } = options;

  const onFormattingChange = (formatting: IDatetimeFormatting) => {
    onChange?.({
      formatting,
    });
  };

  const onDefaultValueChange = (checked: boolean) => {
    onChange?.({
      defaultValue: checked ? 'now' : undefined,
    });
  };

  return (
    <div className="form-control w-full space-y-2">
      <DatetimeFormatting onChange={onFormattingChange} formatting={options.formatting} />
      {!isLookup && (
        <div className="flex items-center space-x-2">
          <Label htmlFor="field-options-auto-fill" className="font-normal">
            Auto Fill
          </Label>
          <Switch
            className="h-6 w-12"
            classNameThumb="w-5 h-5 data-[state=checked]:translate-x-6"
            id="field-options-auto-fill"
            checked={Boolean(defaultValue)}
            onCheckedChange={onDefaultValueChange}
          />
        </div>
      )}
    </div>
  );
};
