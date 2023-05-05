/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FieldCore } from '../models';
import { CellValueType } from '../models';

export class FlatTypedValue<T = any> implements IFlatTypedValue<T> {
  constructor(public value: T, public type: CellValueType, public field?: FieldCore) {}
}

export class ArrayTypedValue<T = any[]> implements IArrayTypedValue<T> {
  type: CellValueType.Array = CellValueType.Array;
  value: FlatTypedValue<T>[] | null;
  constructor(value: any, public elementType: CellValueType, public field?: FieldCore) {
    this.value = Array.isArray(value) ? value.map((v) => new FlatTypedValue(v, elementType)) : null;
  }
}

interface IArrayTypedValue<T> {
  field?: FieldCore;
  type: CellValueType.Array;
  elementType: CellValueType;
  value: FlatTypedValue<T>[] | null;
}

interface IFlatTypedValue<T> {
  field?: FieldCore;
  type: CellValueType;
  value: T;
}

export type ITypedValue<T = any> = IArrayTypedValue<T> | IFlatTypedValue<T>;
