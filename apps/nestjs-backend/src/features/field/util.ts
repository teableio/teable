import { assertNever, DbFieldType } from '@teable-group/core';

export function dbType2knexFormat(dbFieldType: DbFieldType) {
  switch (dbFieldType) {
    case DbFieldType.Blob:
      return 'binary';
    case DbFieldType.Integer:
      return 'integer';
    case DbFieldType.Json:
      return 'text'; // use text in sqlite
    case DbFieldType.Real:
      return 'float';
    case DbFieldType.Text:
      return 'text';
    case DbFieldType.DateTime:
      return 'datetime';
    default:
      assertNever(dbFieldType);
  }
}
