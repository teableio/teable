import type { IFieldBase } from './interface';

export abstract class Field {
  constructor(public readonly fieldData: IFieldBase) {}

  get name() {
    return this.fieldData.name;
  }

  get isPrimaryField() {
    return this.fieldData.isPrimaryField;
  }

  abstract get type(): unknown;

  abstract get defaultValue(): unknown;
}
