import dayjs, { extend } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import {
  DateFormattingPreset,
  TimeFormatting,
  datetimeFormattingSchema,
  defaultDatetimeFormatting,
  formatDateToString,
} from '../formatting';

extend(timezone);
extend(customParseFormat);
extend(utc);

export const dateFieldOptionsSchema = z.object({
  formatting: datetimeFormattingSchema,
  defaultValue: z
    .enum(['now'] as const)
    .optional()
    .openapi({
      description:
        'Whether the new row is automatically filled with the current time, caveat: the defaultValue is just a flag, it dose not effect the storing value of the record',
    }),
});

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

  cellValue2String(cellValue?: unknown) {
    if (cellValue == null) return '';
    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.map((v) => this.item2String(v)).join(', ');
    }

    return this.item2String(cellValue as string);
  }
  private defaultTzFormat(value: string) {
    try {
      const formatValue = dayjs.tz(value, this.options.formatting.timeZone);
      if (!formatValue.isValid()) return null;
      return formatValue.toISOString();
    } catch (e) {
      return null;
    }
  }

  convertStringToCellValue(value: string): string | null {
    if (this.isLookup) {
      return null;
    }

    if (value === '' || value == null) return null;

    if (value === 'now') {
      return dayjs().toISOString();
    }

    const hasTime = /\d{1,2}:\d{2}(?::\d{2})?/.test(value);

    const format = `${this.options.formatting.date}${hasTime && this.options.formatting.time !== TimeFormatting.None ? ' ' + this.options.formatting.time : ''}`;

    try {
      const formatValue = [DateFormattingPreset.European, DateFormattingPreset.US].includes(
        this.options.formatting.date as DateFormattingPreset
      )
        ? dayjs.tz(value, format, this.options.formatting.timeZone)
        : dayjs.tz(value, this.options.formatting.timeZone);
      if (!formatValue.isValid()) return null;
      return formatValue.toISOString();
    } catch (e) {
      return this.defaultTzFormat(value);
    }
  }

  item2String(item?: unknown) {
    return formatDateToString(item as string, this.options.formatting);
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

  validateCellValueLoose(cellValue: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(z.string()).nonempty().nullable().safeParse(cellValue);
    }
    return z.string().nullable().safeParse(cellValue);
  }
}
