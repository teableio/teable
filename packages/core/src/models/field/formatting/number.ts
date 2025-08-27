import { z } from 'zod';

export enum NumberFormattingType {
  Decimal = 'decimal',
  Percent = 'percent',
  Currency = 'currency',
}

const baseFormatting = z.object({
  precision: z.number().max(5).min(0),
});

export const decimalFormattingSchema = baseFormatting.extend({
  type: z.literal(NumberFormattingType.Decimal),
});

export const percentFormattingSchema = baseFormatting.extend({
  type: z.literal(NumberFormattingType.Percent),
});

export const currencyFormattingSchema = baseFormatting.extend({
  type: z.literal(NumberFormattingType.Currency),
  symbol: z.string(),
});

export const numberFormattingSchema = z
  .union([decimalFormattingSchema, percentFormattingSchema, currencyFormattingSchema])
  .describe(
    'Only be used in number field (number field or formula / rollup field with cellValueType equals Number'
  );

export type IDecimalFormatting = z.infer<typeof decimalFormattingSchema>;

export type IPercentFormatting = z.infer<typeof percentFormattingSchema>;

export type ICurrencyFormatting = z.infer<typeof currencyFormattingSchema>;

export type INumberFormatting = z.infer<typeof numberFormattingSchema>;

export const defaultNumberFormatting: INumberFormatting = {
  type: NumberFormattingType.Decimal,
  precision: 2,
};

export const formatNumberToString = (value: number | undefined, formatting: INumberFormatting) => {
  if (value == null) {
    return '';
  }

  const cellValue = Number(value);
  const { type, precision } = formatting;

  if (type === NumberFormattingType.Currency) {
    const symbol = formatting.symbol ?? '$';
    const sign = cellValue < 0 ? '-' : '';
    const options =
      precision != null
        ? {
            minimumFractionDigits: precision,
            maximumFractionDigits: precision,
          }
        : undefined;

    const formattedValue = Math.abs(cellValue).toLocaleString('en-US', options);
    return sign + symbol + formattedValue;
  }

  if (type === NumberFormattingType.Percent) {
    const formattedNumber = (cellValue * 100).toFixed(precision);
    return `${formattedNumber}%`;
  }

  if (precision != null) {
    return cellValue.toFixed(precision);
  }

  return String(cellValue);
};

export const parseStringToNumber = (value: string | null, formatting?: INumberFormatting) => {
  if (value == null || value === '') return null;

  const originStr = String(value);
  const isPercent = formatting?.type === NumberFormattingType.Percent || originStr.includes('%');
  const numberReg = /[^\d.+-]/g;
  const symbolReg = /([+\-.])+/g;
  const numStr = originStr.replace(numberReg, '').replace(symbolReg, '$1');
  const num = parseFloat(numStr);

  if (Number.isNaN(num)) {
    return null;
  }
  return isPercent ? num / 100 : num;
};
