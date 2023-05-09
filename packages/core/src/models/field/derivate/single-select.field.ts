import { z } from 'zod';
import { Colors } from '../colors';
import type { FieldType, DbFieldType } from '../constant';
import type { CellValueType } from '../field';
import { FieldCore } from '../field';

export class SingleSelectFieldChoices {
  name!: string;
  color!: Colors;
}

export class SingleSelectFieldOptions {
  choices!: SingleSelectFieldChoices[];
}

export class SingleSelectFieldCore extends FieldCore {
  type!: FieldType.SingleSelect;

  dbFieldType!: DbFieldType.Text;

  options!: SingleSelectFieldOptions;

  defaultValue: string | null = null;

  calculatedType!: FieldType.SingleSelect;

  cellValueType!: CellValueType.String;

  isComputed!: false;

  static defaultOptions(): SingleSelectFieldOptions {
    return {
      choices: [],
    };
  }

  cellValue2String(cellValue: string) {
    return cellValue;
  }

  convertStringToCellValue(value: string): string | null {
    if (value === '' || value == null) {
      return null;
    }

    if (this.options.choices.find((c) => c.name === value)) {
      return value;
    }

    return null;
  }

  repair(value: unknown) {
    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }

    throw new Error(`invalid value: ${value} for field: ${this.name}`);
  }

  validateOptions() {
    return z
      .object({
        choices: z.array(
          z.object({
            name: z.string(),
            color: z.nativeEnum(Colors),
          })
        ),
      })
      .safeParse(this.options);
  }

  validateDefaultValue() {
    const choiceNames = this.options.choices.map((v) => v.name);
    return z
      .string()
      .nullable()
      .optional()
      .refine(
        (value) => {
          return value == null || choiceNames.includes(value);
        },
        { message: `${this.defaultValue} is not one of the choice names` }
      )
      .safeParse(this.defaultValue);
  }
}
