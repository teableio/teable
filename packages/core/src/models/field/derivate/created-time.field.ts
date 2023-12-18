import { extend } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import { datetimeFormattingSchema, defaultDatetimeFormatting } from '../formatting';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';

extend(timezone);

export const createdTimeFieldOptionsSchema = z.object({
  expression: z.literal('CREATED_TIME()'),
  formatting: datetimeFormattingSchema,
});

export type ICreatedTimeFieldOptions = z.infer<typeof createdTimeFieldOptionsSchema>;

export const createdTimeFieldOptionsRoSchema = createdTimeFieldOptionsSchema.omit({
  expression: true,
});

export type ICreatedTimeFieldOptionsRo = z.infer<typeof createdTimeFieldOptionsRoSchema>;

export class CreatedTimeFieldCore extends FormulaAbstractCore {
  type!: FieldType.CreatedTime;

  declare options: ICreatedTimeFieldOptions;

  declare cellValueType: CellValueType.DateTime;

  static defaultOptions(): ICreatedTimeFieldOptionsRo {
    return {
      formatting: defaultDatetimeFormatting,
    };
  }

  validateOptions() {
    return createdTimeFieldOptionsRoSchema.safeParse(this.options);
  }
}
