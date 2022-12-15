export enum DbFieldType {
  Text = 'TEXT',
  Integer = 'INTEGER',
  Real = 'REAL',
  Blob = 'BLOB',
}

export const preservedFieldName = new Set([
  '__id',
  '__autoNumber',
  '__createdTime',
  '__lastModifiedTime',
  '__createdBy',
  '__lastModifiedBy',
]);
