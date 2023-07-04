import type { INumberFormatting } from '@teable-group/core';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable-group/ui-lib/shadcn/ui/select';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const NUMBER_FIELD_PRECISION = [
  {
    text: '1',
    value: 0,
  },
  {
    text: '1.0',
    value: 1,
  },
  {
    text: '1.00',
    value: 2,
  },
  {
    text: '1.000',
    value: 3,
  },
  {
    text: '1.0000',
    value: 4,
  },
];

interface IProps {
  formatting?: INumberFormatting;
  onChange?: (formatting: INumberFormatting) => void;
}

export const NumberFormatting: React.FC<IProps> = ({ formatting = { precision: 0 }, onChange }) => {
  const precision = formatting.precision;

  const onPrecisionChange = (value: string) => {
    const precision = Number(value) || 0;
    onChange?.({ precision: Number.isNaN(precision) ? 0 : precision });
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <Label className="font-normal">Precision</Label>
      <Select value={precision.toString()} onValueChange={onPrecisionChange}>
        <SelectTrigger className="w-full h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {NUMBER_FIELD_PRECISION.map(({ text, value }) => (
            <SelectItem key={value} value={value.toString()}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
