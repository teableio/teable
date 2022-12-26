export interface IRecord {
  id: string;
  createdTime: number;
  lastModifiedTime: number;
  createdBy: string;
  lastModifiedBy: string;
  fields: IRecordFields;
}

export interface IRecordFields {
  [fieldId: string]: unknown;
}
