/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CellValueType } from '../models/field/constant';
import type { FieldCore } from '../models/field/field';

export class TypedValue<T = any> {
  constructor(
    public value: T,
    public type: CellValueType,
    public isMultiple?: boolean,
    public field?: FieldCore,
    public isBlank?: boolean
  ) {}

  toPlain(): any {
    return this.value === false ? null : this.value;
  }
}
