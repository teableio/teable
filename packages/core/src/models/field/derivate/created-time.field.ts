import { extend } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import type { FieldType, CellValueType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { defaultDatetimeFormatting } from '../formatting';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';
import {
  createdTimeFieldOptionsRoSchema,
  type ICreatedTimeFieldOptions,
  type ICreatedTimeFieldOptionsRo,
} from './created-time-option.schema';

extend(timezone);

export class CreatedTimeFieldCore extends FormulaAbstractCore {
  type!: FieldType.CreatedTime;

  declare options: ICreatedTimeFieldOptions;

  meta?: undefined;

  declare cellValueType: CellValueType.DateTime;

  getExpression() {
    return this.options.expression;
  }

  static defaultOptions(): ICreatedTimeFieldOptionsRo {
    return {
      formatting: defaultDatetimeFormatting,
    };
  }

  validateOptions() {
    return createdTimeFieldOptionsRoSchema.safeParse(this.options);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitCreatedTimeField(this);
  }
}
