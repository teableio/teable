import type { DateFieldOptions } from '@teable-group/core';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DATE_FORMATTING_OF_DATE_FIELD, TIME_FORMATTING_OF_DATE_FIELD } from '../../utils/field';

const SelectInfoMap: {
  key: 'dateFormatting' | 'timeFormatting';
  label: string;
  list: { text: string; value: string }[];
}[] = [
  {
    key: 'dateFormatting',
    label: 'Date Formatting',
    list: DATE_FORMATTING_OF_DATE_FIELD,
  },
  {
    key: 'timeFormatting',
    label: 'Time Formatting',
    list: TIME_FORMATTING_OF_DATE_FIELD,
  },
];

export const DateOptions = (props: {
  options: DateFieldOptions;
  onChange?: (options: DateFieldOptions) => void;
}) => {
  const { options, onChange } = props;
  const { autoFill } = options;

  const onFormattingChange = (value: string, key: string) => {
    onChange?.({
      ...options,
      [key]: value,
    });
  };

  const onAutoFillChange = (checked: boolean) => {
    onChange?.({
      ...options,
      autoFill: checked,
    });
  };

  return (
    <div className="form-control w-full">
      {SelectInfoMap.map((item) => {
        const { key, label, list } = item;
        return (
          <div key={key} className="mb-4">
            <Label htmlFor="airplane-mode" className="font-normal">
              {label}
            </Label>
            <Select
              value={options[key] as string}
              onValueChange={(value) => onFormattingChange(value, key)}
            >
              <SelectTrigger className="w-full h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {list.map(({ text, value }) => (
                  <SelectItem key={value} value={value}>
                    {text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}

      <div className="flex items-center space-x-2">
        <Label htmlFor="airplane-mode" className="font-normal">
          Auto Fill
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
