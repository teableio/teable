/* eslint-disable @typescript-eslint/naming-convention */
export enum FieldType {
  SingleLineText = 'singleLineText',
  LongText = 'longText',
  User = 'user',
  Attachment = 'attachment',
  Checkbox = 'checkbox',
  MultipleSelect = 'multipleSelect',
  SingleSelect = 'singleSelect',
  Date = 'date',
  Number = 'number',
  Rating = 'rating',
  Formula = 'formula',
  Rollup = 'rollup',
  Link = 'link',
  CreatedTime = 'createdTime',
  LastModifiedTime = 'lastModifiedTime',
  CreatedBy = 'createdBy',
  LastModifiedBy = 'lastModifiedBy',
  AutoNumber = 'autoNumber',
  Button = 'button',
}

export enum DbFieldType {
  Text = 'TEXT',
  Integer = 'INTEGER',
  DateTime = 'DATETIME',
  Real = 'REAL',
  Blob = 'BLOB',
  Json = 'JSON',
  Boolean = 'BOOLEAN',
}

export enum CellValueType {
  String = 'string',
  Number = 'number',
  Boolean = 'boolean',
  DateTime = 'dateTime',
}

export enum Relationship {
  OneOne = 'oneOne',
  ManyMany = 'manyMany',
  OneMany = 'oneMany',
  ManyOne = 'manyOne',
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const RelationshipRevert = {
  [Relationship.OneMany]: Relationship.ManyOne,
  [Relationship.ManyOne]: Relationship.OneMany,
  [Relationship.ManyMany]: Relationship.ManyMany,
  [Relationship.OneOne]: Relationship.OneOne,
};

export const isMultiValueLink = (relationship: Relationship): boolean =>
  relationship === Relationship.ManyMany || relationship === Relationship.OneMany;

export const PRIMARY_SUPPORTED_TYPES = new Set([
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.User,
  FieldType.MultipleSelect,
  FieldType.SingleSelect,
  FieldType.Date,
  FieldType.Number,
  FieldType.Rating,
  FieldType.Formula,
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
  FieldType.AutoNumber,
]);

export const IMPORT_SUPPORTED_TYPES = [
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.Date,
  FieldType.Number,
  FieldType.Attachment,
  FieldType.Checkbox,
  FieldType.MultipleSelect,
  FieldType.SingleSelect,
  FieldType.User,
];

export const UNIQUE_VALIDATION_FIELD_TYPES = new Set([
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.Number,
  FieldType.Date,
]);

export const NOT_NULL_VALIDATION_FIELD_TYPES = new Set([
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultipleSelect,
  FieldType.User,
  FieldType.Date,
  FieldType.Rating,
  FieldType.Attachment,
  FieldType.Link,
]);
