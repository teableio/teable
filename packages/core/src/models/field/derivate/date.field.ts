import dayjs, { extend } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import {
  TimeFormatting,
  datetimeFormattingSchema,
  defaultDatetimeFormatting,
  formatDateToString,
} from '../formatting';

extend(timezone);
extend(customParseFormat);
extend(utc);

export const dateFieldOptionsSchema = z
  .object({
    formatting: datetimeFormattingSchema,
    defaultValue: z
      .enum(['now'] as const)
      .optional()
      .openapi({
        description:
          'Whether the new row is automatically filled with the current time, caveat: the defaultValue is just a flag, it dose not effect the storing value of the record',
      }),
  })
  .describe('options for date fields');

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
      const formatValue = dayjs.utc(value);
      if (!formatValue.isValid()) return null;
      return formatValue.toISOString();
    } catch {
      return null;
    }
  }

  private parseUsingFieldFormatting(value: string): string | null {
    const hasTime = /\d{1,2}:\d{2}(?::\d{2})?/.test(value);
    const hasSeconds = /\d{1,2}:\d{2}:\d{2}/.test(value);
    const hasAmPm = /am|pm/i.test(value);

    const dateFormat = this.options.formatting.date.replace('MM', 'M').replace('DD', 'D');

    let timeFormat: string | null = null;
    if (hasTime) {
      if (this.options.formatting.time === TimeFormatting.Hour12 || hasAmPm) {
        timeFormat = hasSeconds ? 'hh:mm:ss A' : 'hh:mm A';
      } else {
        timeFormat = hasSeconds ? 'HH:mm:ss' : 'HH:mm';
      }
    }

    const format = timeFormat ? `${dateFormat} ${timeFormat}` : dateFormat;

    try {
      const formatValue = dayjs.tz(value, format, this.options.formatting.timeZone);
      if (!formatValue.isValid()) return null;
      const isoString = formatValue.toISOString();
      if (isoString.startsWith('-')) return null;
      return isoString;
    } catch {
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

    if (/^\d+$/.test(String(value))) {
      const num = Number(value);
      const ms = String(value).length >= 13 ? num : num * 1000;
      try {
        const d = dayjs(ms).tz(this.options.formatting.timeZone);
        if (d.isValid()) {
          const iso = d.toISOString();
          if (!iso.startsWith('-')) return iso;
        }
      } catch {
        // ignore
      }
    }

    const formatted = this.parseUsingFieldFormatting(value);
    if (formatted) return formatted;

    return this.defaultTzFormat(value);
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
