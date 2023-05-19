import { z } from 'zod';
import { Colors } from '../colors';
import { FieldCore } from '../field';

export class SelectFieldChoices {
  name!: string;
  color!: Colors;
}

export class SelectFieldOptions {
  choices!: SelectFieldChoices[];
}

export abstract class SelectFieldCore extends FieldCore {
  static defaultOptions(): SelectFieldOptions {
    return {
      choices: [],
    };
  }

  options!: SelectFieldOptions;

  isComputed!: false;

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
}
