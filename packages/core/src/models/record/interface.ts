import type { FieldKeyType } from './record';

export interface IRecord {
  id: string;
  fields: IRecordFields;
  createdTime?: number;
  lastModifiedTime?: number;
  createdBy?: string;
  lastModifiedBy?: string;
}

export interface IRecordFields {
  [fieldId: string]: unknown;
}

export interface IRecordSnapshot {
  record: IRecord;
  recordOrder: { [viewId: string]: number };
}

export interface ICreateRecordsRo {
  fieldKeyType?: FieldKeyType;

  records: {
    fields: { [fieldIdOrName: string]: unknown };
  }[];
}

export interface IUpdateRecordRo {
  fieldKeyType?: FieldKeyType;

  record: {
    fields: { [fieldIdOrName: string]: unknown };
  };
}

export interface IUpdateRecordByIndexRo extends IUpdateRecordRo {
  viewId: string;
  index: number;
}
