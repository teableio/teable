import { z } from 'zod';
import { Colors } from '../colors';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVisitor } from '../field-visitor.interface';
import type { IButtonFieldOptions } from './button-option.schema';
import { buttonFieldOptionsSchema } from './button-option.schema';

export const buttonFieldCelValueSchema = z.object({
  count: z.number().int().openapi({ description: 'clicked count' }),
});

export type IButtonFieldCellValue = z.infer<typeof buttonFieldCelValueSchema>;

export class ButtonFieldCore extends FieldCore {
  type!: FieldType.Button;

  options!: IButtonFieldOptions;

  meta?: undefined;

  cellValueType!: CellValueType.String;

  static defaultOptions(): IButtonFieldOptions {
    return {
      label: 'Button',
      color: Colors.Teal,
    };
  }

  cellValue2String(_cellValue?: unknown) {
    return '';
  }

  item2String(_value?: unknown): string {
    return '';
  }

  convertStringToCellValue(_value: string): string | null {
    return null;
  }

  repair(_value: unknown) {
    return null;
  }

  validateOptions() {
    return buttonFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(buttonFieldCelValueSchema).nonempty().nullable().safeParse(value);
    }

    return buttonFieldCelValueSchema.nullable().safeParse(value);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitButtonField(this);
  }
}
