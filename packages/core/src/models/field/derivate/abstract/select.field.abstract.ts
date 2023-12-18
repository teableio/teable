import { keyBy } from 'lodash';
import { z } from 'zod';
import { Colors } from '../../colors';
import { FieldCore } from '../../field';

export const selectFieldChoiceSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color: z.nativeEnum(Colors),
});

export const selectFieldChoiceRoSchema = selectFieldChoiceSchema.partial({ id: true, color: true });

export type ISelectFieldChoice = z.infer<typeof selectFieldChoiceSchema>;

export const selectFieldOptionsSchema = z.object({
  choices: z.array(selectFieldChoiceSchema),
});

export const selectFieldOptionsRoSchema = z.object({
  choices: z.array(selectFieldChoiceRoSchema),
});

export type ISelectFieldOptions = z.infer<typeof selectFieldOptionsSchema>;

export type ISelectFieldOptionsRo = z.infer<typeof selectFieldOptionsRoSchema>;

export abstract class SelectFieldCore extends FieldCore {
  static defaultOptions(): ISelectFieldOptions {
    return {
      choices: [],
    };
  }

  options!: ISelectFieldOptions;

  // For validate cellValue,
  // avoiding choice and checking too many rows has a complexity of m(choice.length) x n(rows.length)
  get choicesMap() {
    return keyBy(this.options.choices, 'name');
  }

  validateOptions() {
    return selectFieldOptionsSchema.safeParse(this.options);
  }

  cellValue2String(cellValue?: unknown) {
    if (cellValue == null) {
      return '';
    }

    if (Array.isArray(cellValue)) {
      return cellValue.map((value) => this.item2String(value)).join(', ');
    }

    return cellValue as string;
  }

  item2String(value?: unknown): string {
    if (value == null) {
      return '';
    }

    const stringValue = String(value);

    if (this.isMultipleCellValue && stringValue.includes(',')) {
      return `"${stringValue}"`;
    }
    return stringValue;
  }

  validateCellValue(cellValue: unknown) {
    const nameSchema = z.string().refine(
      (value) => {
        return value == null || this.choicesMap[value];
      },
      { message: `${cellValue} is not one of the choice names` }
    );

    if (this.isMultipleCellValue) {
      return z.array(nameSchema).nonempty().nullable().safeParse(cellValue);
    }

    return nameSchema.nullable().safeParse(cellValue);
  }
}
