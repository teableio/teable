export enum DbFieldType {
  Text = 'TEXT',
  Integer = 'INTEGER',
  Real = 'REAL',
  Blob = 'BLOB',
}

export const preservedFieldName = new Set([
  '__id',
  '__auto_number',
  '__row_default',
  '__created_time',
  '__last_modified_time',
  '__created_by',
  '__last_modified_by',
]);
