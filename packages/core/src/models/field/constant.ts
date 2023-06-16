export enum FieldType {
  SingleLineText = 'singleLineText',
  LongText = 'longText',
  User = 'user',
  Attachment = 'attachment',
  Checkbox = 'checkbox',
  MultipleSelect = 'multipleSelect',
  SingleSelect = 'singleSelect',
  Date = 'date',
  PhoneNumber = 'phoneNumber',
  Email = 'email',
  URL = 'url',
  Number = 'number',
  Currency = 'currency',
  Percent = 'percent',
  Duration = 'duration',
  Rating = 'rating',
  Formula = 'formula',
  Rollup = 'rollup',
  Count = 'count',
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
}

export enum CellValueType {
  String = 'string',
  Number = 'number',
  Boolean = 'boolean',
  DateTime = 'dateTime',
}
