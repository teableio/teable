import { z } from 'zod';

export const numberFormattingSchema = z.object({
  precision: z.number().max(5).min(0),
});

export type INumberFormatting = z.infer<typeof numberFormattingSchema>;

export const formatNumberToString = (cellValue: number, formatting: INumberFormatting) => {
  if (cellValue == null) {
    return '';
  }

  const { precision } = formatting;

  if (precision != null) {
    return cellValue.toFixed(precision);
  }

  return String(cellValue);
};

export const defaultNumberFormatting: INumberFormatting = {
  precision: 2,
};
