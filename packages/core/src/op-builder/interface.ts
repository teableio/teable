import type { IOtOperation } from '../models';
import type { OpName } from './common';

export interface IOpContextBase {
  name: OpName;
}

export interface IOpBuilder {
  name: OpName;
  // Create an atomic operation
  build(...params: unknown[]): IOtOperation;
  // Detect an operation if it is belongs to a specific purpose
  detect(op: IOtOperation): IOpContextBase | null;
}

export interface ICreateOpBuilder {
  name: OpName;
  // Create an atomic operation
  build(...params: unknown[]): unknown;
}
