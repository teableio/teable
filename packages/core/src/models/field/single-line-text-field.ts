import { Field } from './field';
import type { ISingleLineTextField } from './interface';

export class SingleLineTextField extends Field {
  constructor(public readonly field: ISingleLineTextField) {
    super(field);
  }

  get type() {
    return this.field.type;
  }

  get defaultValue() {
    return this.field.defaultValue;
  }
}

// const t = new SingleLineTextField();

// t.type
