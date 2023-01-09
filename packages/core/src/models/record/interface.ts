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
