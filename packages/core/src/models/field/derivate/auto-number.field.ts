import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { FormulaAbstractCore } from './abstract/formula.field.abstract';
import {
  autoNumberFieldOptionsRoSchema,
  type IAutoNumberFieldOptions,
  type IAutoNumberFieldOptionsRo,
} from './auto-number-option.schema';
import type { IFormulaFieldMeta } from './formula-option.schema';

export const autoNumberCellValueSchema = z.number().int();

export class AutoNumberFieldCore extends FormulaAbstractCore {
  type!: FieldType.AutoNumber;

  declare options: IAutoNumberFieldOptions;

  declare meta?: IFormulaFieldMeta;

  declare cellValueType: CellValueType.Number;

  static defaultOptions(): IAutoNumberFieldOptionsRo {
    return {};
  }

  cellValue2String(cellValue?: unknown) {
    if (cellValue == null) {
      return '';
    }

    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.map((v) => this.item2String(v)).join(', ');
    }

    return this.item2String(cellValue as number);
  }

  item2String(value?: unknown): string {
    if (value == null) {
      return '';
    }
    return String(value);
  }

  validateOptions() {
    console.log('this.options', this.options);
    return autoNumberFieldOptionsRoSchema.safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(autoNumberCellValueSchema).nonempty().nullable().safeParse(value);
    }
    return autoNumberCellValueSchema.nullable().safeParse(value);
  }

  getIsPersistedAsGeneratedColumn() {
    return this.meta?.persistedAsGeneratedColumn || false;
  }
  getExpression() {
    return this.options.expression;
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitAutoNumberField(this);
  }
}
