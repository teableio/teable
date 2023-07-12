import { z } from 'zod';
import { Colors } from '../colors';
import { FieldCore } from '../field';

export const selectFieldChoice = z.object({
  name: z.string(),
  color: z.nativeEnum(Colors),
});

export type ISelectFieldChoice = z.infer<typeof selectFieldChoice>;

export const selectFieldOptionsDef = z.object({
  choices: z.array(selectFieldChoice),
});

export type ISelectFieldOptions = z.infer<typeof selectFieldOptionsDef>;

export abstract class SelectFieldCore extends FieldCore {
  static defaultOptions(): ISelectFieldOptions {
    return {
      choices: [],
    };
  }

  options!: ISelectFieldOptions;

  validateOptions() {
    return selectFieldOptionsDef.safeParse(this.options);
  }
}
