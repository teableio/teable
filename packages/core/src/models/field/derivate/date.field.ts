import dayjs, { extend } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVisitor } from '../field-visitor.interface';
import { TimeFormatting, defaultDatetimeFormatting, formatDateToString } from '../formatting';
import type { IDateFieldOptions } from './date-option.schema';
import { dateFieldOptionsSchema } from './date-option.schema';

extend(timezone);
extend(customParseFormat);
extend(utc);

export const dataFieldCellValueSchema = z.string().datetime({ precision: 3, offset: true });

export type IDateCellValue = z.infer<typeof dataFieldCellValueSchema>;

export class DateFieldCore extends FieldCore {
  type!: FieldType.Date;

  options!: IDateFieldOptions;

  meta?: undefined;

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
    } catch {
      return null;
    }
  }

  private parseUsingFieldFormatting(value: string): string | null {
    const hasTime = /\d{1,2}:\d{2}(?::\d{2})?/.test(value);
    const dateFormat = this.options.formatting.date;
    const timeFormat =
      hasTime && this.options.formatting.time !== TimeFormatting.None
        ? this.options.formatting.time
        : null;
    const format = timeFormat ? `${dateFormat} ${timeFormat}` : dateFormat;

    try {
      const check = dayjs(value, format, true).isValid();
      if (!check) return null;
      const formatValue = dayjs.tz(value, format, this.options.formatting.timeZone);
      if (!formatValue.isValid()) return null;
      const isoString = formatValue.toISOString();
      if (isoString.startsWith('-')) return null;
      return isoString;
    } catch {
      return null;
    }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  convertStringToCellValue(value: string): string | null {
    if (this.isLookup) {
      return null;
    }

    if (value === '' || value == null) return null;

    if (value === 'now') {
      return dayjs().toISOString();
    }

    const dayjsObj = dayjs(value);
    if (dayjsObj.isValid() && dayjsObj.toISOString() === value) {
      return value;
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

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitDateField(this);
  }
}
