import { z } from 'zod';

export enum NumberFormattingType {
  Decimal = 'decimal',
  Percent = 'percent',
  Currency = 'currency',
}

const baseFormatting = z.object({
  precision: z.number().max(5).min(0),
});

export const decimalFormattingSchema = baseFormatting
  .extend({
    type: z.literal(NumberFormattingType.Decimal),
  })
  .strict();

export const percentFormattingSchema = baseFormatting
  .extend({
    type: z.literal(NumberFormattingType.Percent),
  })
  .strict();

export const currencyFormattingSchema = baseFormatting
  .extend({
    type: z.literal(NumberFormattingType.Currency),
    symbol: z.string(),
  })
  .strict();

export const numberFormattingSchema = z
  .discriminatedUnion('type', [
    decimalFormattingSchema,
    percentFormattingSchema,
    currencyFormattingSchema,
  ])
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

// Past MAX_SAFE_INTEGER toFixed prints the double's full binary expansion, digits the API never returns.
const toFixedDigits = (value: number, precision: number): string => {
  if (!Number.isFinite(value) || Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
    return value.toFixed(precision);
  }
  const digits = String(value);
  const zeros = digits.includes('e') ? '' : '0'.repeat(precision);
  return zeros ? `${digits}.${zeros}` : digits;
};

export const formatNumberToString = (value: number | undefined, formatting?: INumberFormatting) => {
  if (value == null) {
    return '';
  }

  const cellValue = Number(value);
  const resolvedFormatting = formatting ?? defaultNumberFormatting;
  const { type, precision } = resolvedFormatting;

  if (type === NumberFormattingType.Currency) {
    const symbol = resolvedFormatting.symbol ?? '$';
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
    const formattedNumber = toFixedDigits(cellValue * 100, precision);
    return `${formattedNumber}%`;
  }

  if (precision != null) {
    return toFixedDigits(cellValue, precision);
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
  const num = Number.parseFloat(numStr);

  if (Number.isNaN(num)) {
    return null;
  }
  return isPercent ? num / 100 : num;
};
