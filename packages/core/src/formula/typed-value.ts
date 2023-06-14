/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FieldCore, CellValueType } from '../models';

export class TypedValue<T = any> {
  constructor(
    public value: T,
    public type: CellValueType,
    public isMultiple?: boolean,
    public field?: FieldCore
  ) {}

  toPlain(): any {
    return this.value;
  }
}
