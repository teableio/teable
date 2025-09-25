import type { ICurrencyFormatting, INumberFormatting } from '@teable/core';
import { NumberFormattingType, defaultNumberFormatting } from '@teable/core';
import { Input } from '@teable/ui-lib/shadcn';
import { Label } from '@teable/ui-lib/shadcn/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn/ui/select';
import { useTranslation } from 'next-i18next';

interface IProps {
  formatting?: INumberFormatting;
  onChange?: (formatting: INumberFormatting) => void;
}

export const NumberFormatting: React.FC<IProps> = (props) => {
  const { formatting = defaultNumberFormatting, onChange } = props;
  const { type, precision } = formatting;
  const { t } = useTranslation(['table']);

  const onFormattingTypeChange = (type: NumberFormattingType) => {
    const newFormatting =
      type === NumberFormattingType.Currency && (formatting as ICurrencyFormatting).symbol == null
        ? {
            type,
            symbol: t('field.default.number.defaultSymbol'),
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

  const NUMBER_FORMATTING_TYPE = [
    {
      text: t('field.default.number.decimalExample'),
      value: NumberFormattingType.Decimal,
    },
    {
      text: t('field.default.number.currencyExample'),
      value: NumberFormattingType.Currency,
    },
    {
      text: t('field.default.number.percentExample'),
      value: NumberFormattingType.Percent,
    },
  ];

  const NUMBER_FIELD_PRECISION = [
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

  return (
    <div className="border-bordr flex w-full flex-col gap-4 border-t pt-4">
      <div className="flex w-full flex-col gap-2">
        <Label className="text-sm font-medium">{t('field.default.number.formatType')}</Label>
        <Select value={type} onValueChange={onFormattingTypeChange}>
          <SelectTrigger className="h-9 w-full">
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
            <Label className="text-sm font-medium">
              {t('field.default.number.currencySymbol')}
            </Label>
            <Input
              placeholder={t('field.default.number.currencySymbol')}
              className="h-9"
              value={formatting.symbol}
              onChange={onSymbolChange}
            />
          </div>
        )}
      </>
      <div className="flex w-full flex-col gap-2">
        <Label className="font-medium ">{t('field.default.number.precision')}</Label>
        <Select value={precision.toString()} onValueChange={onPrecisionChange}>
          <SelectTrigger className="h-9 w-full">
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
