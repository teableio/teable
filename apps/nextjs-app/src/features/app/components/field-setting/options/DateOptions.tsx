import type { IDateFieldOptions, IDatetimeFormatting } from '@teable-group/core';
import { Label } from '@teable-group/ui-lib/shadcn/ui/label';
import { Switch } from '@teable-group/ui-lib/shadcn/ui/switch';
import { DatetimeFormatting } from '../formatting/DatetimeFormatting';

export const DateOptions = (props: {
  options: IDateFieldOptions;
  isLookup?: boolean;
  onChange?: (options: IDateFieldOptions) => void;
}) => {
  const { options, isLookup, onChange } = props;
  const { autoFill } = options;

  const onFormattingChange = (formatting: IDatetimeFormatting) => {
    onChange?.({
      ...options,
      formatting,
    });
  };

  const onAutoFillChange = (checked: boolean) => {
    onChange?.({
      ...options,
      autoFill: checked,
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
            checked={autoFill}
            onCheckedChange={onAutoFillChange}
          />
        </div>
      )}
    </div>
  );
};
