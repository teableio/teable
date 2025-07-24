import { z } from 'zod';
import { Colors } from '../colors';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export const buttonFieldOptionsSchema = z.object({
  label: z.string().openapi({ description: 'Button label' }),
  color: z.nativeEnum(Colors).openapi({ description: 'Button color' }),
  maxCount: z
    .number()
    .int()
    .positive()
    .optional()
    .openapi({ description: 'Max count of button clicks' }),
  workflowId: z.string().optional().openapi({ description: 'Workflow ID' }),
});

export type IButtonFieldOptions = z.infer<typeof buttonFieldOptionsSchema>;

export const buttonFieldCelValueSchema = z.object({
  count: z.number().int().positive().openapi({ description: 'clicked count' }),
});

export type IButtonFieldCellValue = z.infer<typeof buttonFieldCelValueSchema>;

export class ButtonFieldCore extends FieldCore {
  type!: FieldType.Button;

  options!: IButtonFieldOptions;

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
    return buttonFieldCelValueSchema.nullable().safeParse(value);
  }
}
