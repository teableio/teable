/* eslint-disable @typescript-eslint/naming-convention */
import type { ICurrencyFormatting, INumberFormatting } from '@teable-group/core';
import {
  DEFAULT_CURRENCY_SYMBOL,
  NumberFormattingType,
  defaultNumberFormatting,
} from '@teable-group/core';
import { Input } from '@teable-group/ui-lib/shadcn';
import { Label } from '@teable-group/ui-lib/shadcn/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable-group/ui-lib/shadcn/ui/select';

export const NUMBER_FORMATTING_TYPE = [
  {
    text: 'Decimal (1.0)',
    value: NumberFormattingType.Decimal,
  },
  {
    text: 'Currency ($100)',
    value: NumberFormattingType.Currency,
  },
  {
    text: 'Percent (20%)',
    value: NumberFormattingType.Percent,
  },
];

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

export const NumberFormatting: React.FC<IProps> = (props) => {
  const { formatting = defaultNumberFormatting, onChange } = props;
  const { type, precision } = formatting;

  const onFormattingTypeChange = (type: NumberFormattingType) => {
    const newFormatting =
      type === NumberFormattingType.Currency && (formatting as ICurrencyFormatting).symbol == null
        ? {
            type,
            symbol: DEFAULT_CURRENCY_SYMBOL,
          }
        : { type };
    onChange?.({ ...formatting, ...newFormatting } as INumberFormatting);
  };

  const onPrecisionChange = (value: string) => {
    const precision = Number(value);
    onChange?.({
      ...formatting,
      precision: Number.isNaN(precision) ? defaultNumberFormatting.precision : precision,
    });
  };

  const onSymbolChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const symbol = e.target.value;
    onChange?.({
      ...formatting,
      symbol,
    } as ICurrencyFormatting);
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full flex-col gap-2">
        <Label className="font-normal">Format type</Label>
        <Select value={type} onValueChange={onFormattingTypeChange}>
          <SelectTrigger className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NUMBER_FORMATTING_TYPE.map(({ text, value }) => (
              <SelectItem key={value} value={value}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <>
        {type === NumberFormattingType.Currency && (
          <div className="flex w-full flex-col gap-2">
            <Label className="font-normal">Currency symbol</Label>
            <Input
              placeholder="Currency symbol"
              className="h-8"
              value={formatting.symbol}
              onChange={onSymbolChange}
            />
          </div>
        )}
      </>
      <div className="flex w-full flex-col gap-2">
        <Label className="font-normal">Precision</Label>
        <Select value={precision.toString()} onValueChange={onPrecisionChange}>
          <SelectTrigger className="h-8 w-full">
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
    </div>
  );
};
