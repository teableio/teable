import { CellValueType } from '../models';

export class TypedValue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public value: any, public type: CellValueType) {}
}

export class ArrayTypedValue extends TypedValue {
  constructor(public value: TypedValue[] | null, public elementType: CellValueType) {
    super(value, CellValueType.Array);
  }
}
