import dayjs from 'dayjs';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import { datetimeFormattingSchema, defaultDatetimeFormatting, TimeFormatting } from '../formatting';

export const dateFieldOptionsSchema = z.object({
  formatting: datetimeFormattingSchema,
  defaultValue: z.enum(['now'] as const).optional(),
});

export type IDateFieldOptions = z.infer<typeof dateFieldOptionsSchema>;

export const dataFieldCellValueSchema = z.string().datetime({ offset: true });

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
    const { date, time } = this.options.formatting;
    const format = time === TimeFormatting.None ? date : `${date} ${time}`;
    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.map((v) => dayjs(v).format(format)).join(', ');
    }

    return dayjs(cellValue as string).format(format);
  }

  convertStringToCellValue(value: string): string | null {
    if (this.isLookup) {
      return null;
    }

    if (value === '' || value == null) return null;
    const formatValue = dayjs(value);
    if (!formatValue.isValid()) return null;
    return formatValue.toISOString();
  }

  repair(value: unknown) {
    if (this.isLookup) {
      return null;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return this.convertStringToCellValue(value as string);
    }

    throw null;
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
