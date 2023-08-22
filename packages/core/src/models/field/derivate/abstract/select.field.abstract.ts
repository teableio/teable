import { z } from 'zod';
import { Colors } from '../../colors';
import { FieldCore } from '../../field';

export const selectFieldChoice = z.object({
  name: z.string(),
  color: z.nativeEnum(Colors),
});

export type ISelectFieldChoice = z.infer<typeof selectFieldChoice>;

export const selectFieldOptionsSchema = z
  .object({
    choices: z.array(selectFieldChoice),
  })
  .strict();

export type ISelectFieldOptions = z.infer<typeof selectFieldOptionsSchema>;

export abstract class SelectFieldCore extends FieldCore {
  static defaultOptions(): ISelectFieldOptions {
    return {
      choices: [],
    };
  }

  options!: ISelectFieldOptions;

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
    return value ? String(value) : '';
  }

  validateCellValue(cellValue: unknown) {
    const choiceNames = this.options.choices.map((v) => v.name);

    const nameSchema = z.string().refine(
      (value) => {
        return value == null || choiceNames.includes(value);
      },
      { message: `${cellValue} is not one of the choice names` }
    );

    if (this.isMultipleCellValue) {
      return z.array(nameSchema).nonempty().nullable().safeParse(cellValue);
    }

    return nameSchema.nullable().safeParse(cellValue);
  }
}
