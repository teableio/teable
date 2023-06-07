import type { FieldCore } from '../field';
import type { IRecordFields } from './interface';

export enum FieldKeyType {
  Id = 'id',
  Name = 'name',
}

export enum CellFormat {
  Json = 'json',
  Text = 'text',
}

export class RecordCore {
  constructor(protected fieldMap: { [fieldId: string]: FieldCore }) {}

  private _name?: string;

  commentCount!: number;

  createdTime!: Date;

  id!: string;

  isDeleted = false;

  get name() {
    if (!this._name) {
      const primaryField = Object.values(this.fieldMap).find((field) => field.isPrimary);
      if (!primaryField) {
        throw new Error('Record must have a primary field');
      }
      this._name = this.getCellValueAsString(primaryField.id);
    }
    return this._name;
  }

  fields!: IRecordFields;

  getCellValue(fieldId: string): unknown {
    return this.fields[fieldId];
  }

  getCellValueAsString(fieldId: string) {
    return this.fieldMap[fieldId].cellValue2String(this.fields[fieldId]);
  }
}
