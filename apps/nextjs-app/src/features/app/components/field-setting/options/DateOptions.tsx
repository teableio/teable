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
          <Switch
            id="field-options-auto-fill"
            checked={Boolean(defaultValue)}
            onCheckedChange={onDefaultValueChange}
          />
          <Label htmlFor="field-options-auto-fill" className="font-normal">
            Auto Fill with current date
          </Label>
        </div>
      )}
    </div>
  );
};
