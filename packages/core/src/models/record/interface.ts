import type { FieldKeyType } from './record';
import type { IRecord } from './record.def';

export interface IRecordFields {
  [fieldId: string]: unknown;
}

export interface IRecordSnapshot {
  record: IRecord;
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
