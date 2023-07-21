import dayjs from 'dayjs';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import {
  datetimeFormattingSchema,
  defaultDatetimeFormatting,
  formatDateToString,
} from '../formatting';

export const dateFieldOptionsSchema = z
  .object({
    formatting: datetimeFormattingSchema,
    defaultValue: z.enum(['now'] as const).optional(),
  })
  .strict();

export type IDateFieldOptions = z.infer<typeof dateFieldOptionsSchema>;

export const dataFieldCellValueSchema = z.string().datetime({ precision: 3, offset: true });

export type IDateCellValue = z.infer<typeof dataFieldCellValueSchema>;

export class DateFieldCore extends FieldCore {
  type!: FieldType.Date;

  options!: IDateFieldOptions;

  cellValueType!: CellValueType.DateTime;

  static defaultOptions(): IDateFieldOptions {
    return {
      formatting: defaultDatetimeFormatting,
    };
  }

  cellValue2String(cellValue: string | string[] | undefined) {
    if (cellValue == null) return '';
    const formatting = this.options.formatting;

    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.map((v) => formatDateToString(v, formatting)).join(', ');
    }

    return formatDateToString(cellValue as string, formatting);
  }

  convertStringToCellValue(value: string): string | null {
    if (this.isLookup) {
      return null;
    }

    if (value === '' || value == null) return null;

    try {
      const formatValue = dayjs.tz(value, this.options.formatting.timeZone);
      if (!formatValue.isValid()) return null;
      return formatValue.toISOString();
    } catch (e) {
      return null;
    }
  }

  repair(value: unknown) {
    if (this.isLookup) {
      return null;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return this.convertStringToCellValue(value as string);
    }

    return null;
  }

  validateOptions() {
    return dateFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(cellValue: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(dataFieldCellValueSchema).nonempty().nullable().safeParse(cellValue);
    }
    return dataFieldCellValueSchema.nullable().safeParse(cellValue);
  }
}
