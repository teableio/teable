import { extend } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import {
  datetimeFormattingSchema,
  defaultDatetimeFormatting,
  formatDateToString,
} from '../formatting';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';
import { dataFieldCellValueSchema } from './date.field';

extend(timezone);

export const lastModifiedTimeFieldOptionsSchema = z
  .object({
    expression: z.literal('LAST_MODIFIED_TIME()'),
    formatting: datetimeFormattingSchema,
  })
  .strict();

export type ILastModifiedTimeFieldOptions = z.infer<typeof lastModifiedTimeFieldOptionsSchema>;

export const lastModifiedTimeFieldOptionsRoSchema = lastModifiedTimeFieldOptionsSchema.partial({
  expression: true,
});

export class LastModifiedTimeFieldCore extends FormulaAbstractCore {
  type!: FieldType.LastModifiedTime;

  declare options: ILastModifiedTimeFieldOptions;

  declare cellValueType: CellValueType.DateTime;

  static defaultOptions(): ILastModifiedTimeFieldOptions {
    return {
      expression: 'LAST_MODIFIED_TIME()',
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

  item2String(item?: unknown) {
    return formatDateToString(item as string, this.options.formatting);
  }

  convertStringToCellValue(_value: string): null {
    return null;
  }

  repair(_value: unknown) {
    return null;
  }

  validateOptions() {
    return lastModifiedTimeFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(cellValue: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(dataFieldCellValueSchema).nonempty().nullable().safeParse(cellValue);
    }
    return dataFieldCellValueSchema.nullable().safeParse(cellValue);
  }
}
