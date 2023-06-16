import type { DateFieldOptions, DateFormatting } from '@teable-group/core';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DATE_FIELD_FORMATTING } from '../../utils/field';

export const DateOptions = (props: {
  options: DateFieldOptions;
  onChange?: (options: DateFieldOptions) => void;
}) => {
  const { options, onChange } = props;
  const { formatting, autoFill } = options;

  const onFormattingChange = (value: DateFormatting) => {
    onChange?.({
      formatting: value,
      autoFill,
    });
  };

  const onAutoFillChange = (checked: boolean) => {
    onChange?.({
      formatting,
      autoFill: checked,
    });
  };

  return (
    <div className="form-control w-full">
      <div>
        <Label htmlFor="airplane-mode" className="font-normal">
          Formatting
        </Label>
        <Select value={formatting} onValueChange={onFormattingChange}>
          <SelectTrigger className="w-full h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_FIELD_FORMATTING.map(({ text, value }) => (
              <SelectItem key={value} value={value}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center space-x-2 mt-4">
        <Label htmlFor="airplane-mode" className="font-normal">
          AutoFill
        </Label>
        <Switch
          className="h-6 w-12"
          classNameThumb="w-5 h-5 data-[state=checked]:translate-x-6"
          id="airplane-mode"
          checked={autoFill}
          onCheckedChange={onAutoFillChange}
        />
      </div>
    </div>
  );
};
